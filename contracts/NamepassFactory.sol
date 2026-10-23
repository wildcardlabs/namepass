// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {INamepassRenewalAdapter} from "./interfaces/INamepassRenewalAdapter.sol";

/*//////////////////////////////////////////////////////////////
                            INTERFACES
//////////////////////////////////////////////////////////////*/

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);
}

interface ITokenMessengerV2 {
    /**
     * @dev CCTP **V2** returns nothing here. Declaring a return value
     * makes Solidity enforce a returndata size and revert on every
     * burn. Extra returndata, if a future version emits any, is
     * ignored by a void declaration — so this is the safe shape
     * either way.
     */
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;

    /**
     * @dev Circle's TokenMinter for this chain, which is where the
     * per-message burn limit actually lives.
     */
    function localMinter() external view returns (ITokenMinterV2);
}

interface ITokenMinterV2 {
    function burnLimitsPerMessage(address token) external view returns (uint256);
}

interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

/// @dev Everything an L2 wallet needs for a burn, as one calldata struct.
struct BurnParams {
    uint256 amount;
    uint16 maxFeeBps;
    address usdc;
    address messenger;
    uint32 minFinalityThreshold;
}

/// @dev Figures of one settlement, kept in memory so the events can be emitted without stack pressure.
struct Settlement {
    bytes32 labelKey;
    address wallet;
    address executor;
    address adapter;
    uint64 duration;
    uint256 amount;
    uint256 price;
    bool fromCCTP;
}

interface INamepassWallet {
    function executeHub(string calldata label, uint256 amount, address executor, address usdcAddress, address adapter)
        external
        returns (address renewer, uint64 duration, uint256 price);

    function executeL2(string calldata label, BurnParams calldata burn) external;
}

/*//////////////////////////////////////////////////////////////
                    ERC-1167 MINIMAL PROXY
//////////////////////////////////////////////////////////////*/

library MinimalProxy {
    error DeploymentFailed();

    /**
     * @notice Deploys a standard ERC-1167 minimal proxy with CREATE2.
     *
     * Runtime bytecode: 45 bytes.
     * Creation bytecode: 55 bytes.
     * Storage slots: none.
     */
    function cloneUniversal(address implementation, bytes32 salt) internal returns (address instance) {
        assembly ("memory-safe") {
            /*
             * Packs the first portion of the ERC-1167 creation code
             * and the first three bytes of the implementation.
             */
            mstore(0x00, or(shr(232, shl(96, implementation)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))

            /*
             * Packs the remaining seventeen bytes of the
             * implementation and the proxy suffix.
             */
            mstore(0x20, or(shl(120, implementation), 0x5af43d82803e903d91602b57fd5bf3))

            instance := create2(0, 0x09, 0x37, salt)
        }

        if (instance == address(0)) {
            revert DeploymentFailed();
        }
    }

    /**
     * @notice Predicts the CREATE2 address of the minimal proxy.
     */
    function predictUniversalAddress(address implementation, bytes32 salt, address deployer)
        internal
        pure
        returns (address predicted)
    {
        assembly ("memory-safe") {
            let ptr := mload(0x40)

            mstore(add(ptr, 0x38), deployer)

            mstore(add(ptr, 0x24), 0x5af43d82803e903d91602b57fd5bf3ff)

            mstore(add(ptr, 0x14), implementation)

            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73)

            mstore(add(ptr, 0x58), salt)

            mstore(add(ptr, 0x78), keccak256(add(ptr, 0x0c), 0x37))

            predicted := and(keccak256(add(ptr, 0x43), 0x55), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }
}

/*//////////////////////////////////////////////////////////////
                       NAMEPASS FACTORY
//////////////////////////////////////////////////////////////*/

/**
 * @title NamepassFactory
 *
 * @notice Creates universal USDC deposit wallets for normalized ENS
 * labels, processes their balances, receives CCTP mints on the hub,
 * and settles renewals through a governance-selected adapter.
 *
 * @dev A **label** is the single name component with no TLD and no
 * dots — `vitalik`, never `vitalik.eth`. Dots are rejected on chain
 * so an off-chain caller that passes a full name fails loudly at
 * prediction time instead of quietly deriving an address nobody can
 * ever process.
 *
 * Each deposit wallet is a storage-free ERC-1167 proxy that
 * permanently delegates to this factory.
 *
 * To produce the same deposit address across chains:
 *
 * 1. This factory must be deployed at the same address.
 * 2. The factory runtime bytecode must be identical.
 * 3. The same normalized ENS label bytes must be used.
 * 4. The same salt namespace must be used.
 *
 * Constructor arguments are part of the creation code, so
 * `initialOwner` and `hubChainId` must be identical on every chain
 * in a deployment set. Everything chain-*specific* lives in storage
 * and does not affect universal wallet addresses.
 *
 * ## Roles
 *
 * The factory has one address on every chain, and that address is
 * also the CCTP mint recipient and destination caller recorded in
 * every L2 burn. There is nothing to configure about where bridged
 * funds land and therefore nothing to get wrong.
 *
 * On the hub, a renewal runs inside the deposit wallet: the wallet
 * asks the active adapter for a plan, approves the ENS renewer for
 * exactly the quoted price, executes the plan, verifies that exactly
 * the price left, and pays whatever remains to the executor. A CCTP
 * claim runs the same routine from the factory's own balance,
 * spending only the amount Circle authenticated.
 *
 * The adapter is view-only and is selected by the ENS governance
 * executor. It can direct at most the quoted price of one payment,
 * and only after governance activates it.
 *
 * ## Custody
 *
 * After `initialize`, the owner cannot move a single deposited
 * dollar. The token, the CCTP messenger, and the transmitter are
 * frozen. One setting remains: the CCTP finality tier. The per-burn
 * maximum is read live from Circle's own TokenMinter.
 *
 * There is deliberately **no sweep** and no residue account. Rounding
 * dust goes to the executor with the fixed allowance. Non-USDC tokens
 * sent to a deposit address are permanently lost, and the UI is
 * responsible for saying so plainly.
 */
contract NamepassFactory {
    error UnsupportedNativeDeposit();

    /// @notice Accept native USDC through deposit wallets on Arc testnet.
    /// @dev No token movement or execution is authorized by this entrypoint.
    receive() external payable {
        if (address(this) == SELF || block.chainid != 5042002 || HUB_CHAIN_ID != 11155111) {
            revert UnsupportedNativeDeposit();
        }
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Flat allowance paid to whoever executes a renewal, in
     * USDC base units. $0.10.
     */
    uint256 public constant GAS_ALLOWANCE = 100_000;

    /// @dev Required adapter interface version.
    uint256 private constant ADAPTER_INTERFACE_VERSION = 2;

    /**
     * @dev Circle's CCTP domain for the hub. Zero for both Ethereum
     * mainnet and Sepolia.
     */
    uint32 private constant HUB_CCTP_DOMAIN = 0;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    /**
     * @dev Standard transfers — what an L2 starts on. Circle documents
     * <= 1000 as Fast/Confirmed and > 1000 as Standard/Finalized.
     */
    uint32 private constant FINALITY_FINALIZED = 2000;

    /// @dev Ethereum mainnet — the hub for a production set.
    uint256 private constant MAINNET_CHAIN_ID = 1;

    /// @dev Sepolia — the hub for a testnet set.
    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;

    /**
     * @dev Longest label ENS will price, in raw UTF-8 bytes.
     */
    uint256 private constant MAX_LABEL_BYTES = 255;

    bytes32 private constant WALLET_SALT_NAMESPACE = keccak256("NAMEPASS_DEPOSIT_WALLET_V1");

    /**
     * @notice Smallest amount worth bridging, in USDC base units.
     *
     * @dev $0.11 — the gas allowance plus a margin for the dearest
     * second ENS sells. Below this a burn produces a CCTP message that
     * can never be claimed. At present rates the dearest second is 21
     * base units against a margin of 10,000.
     */
    uint256 private constant MIN_BURN_AMOUNT = 110_000;

    /* CCTP V2 message layout. */
    uint256 private constant MESSAGE_SOURCE_DOMAIN_OFFSET = 4;
    uint256 private constant MESSAGE_DESTINATION_DOMAIN_OFFSET = 8;
    uint256 private constant MESSAGE_NONCE_OFFSET = 12;
    uint256 private constant MESSAGE_RECIPIENT_OFFSET = 76;
    uint256 private constant MESSAGE_DESTINATION_CALLER_OFFSET = 108;
    uint256 private constant BURN_BODY_VERSION_OFFSET = 148;
    uint256 private constant BURN_MINT_RECIPIENT_OFFSET = 184;
    uint256 private constant BURN_AMOUNT_OFFSET = 216;
    uint256 private constant BURN_MESSAGE_SENDER_OFFSET = 248;
    uint256 private constant BURN_FEE_EXECUTED_OFFSET = 312;
    uint256 private constant BURN_HOOK_DATA_OFFSET = 376;

    /// @dev Transient storage slot of the reentrancy guard. Costs no persistent state.
    bytes32 private constant REENTRANCY_SLOT = keccak256("namepass.factory.reentrancy");

    /*//////////////////////////////////////////////////////////////
                              IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev The real factory address remains embedded in the
     * implementation bytecode during delegatecall.
     *
     * Direct factory execution:   address(this) == SELF
     * Wallet delegatecall:        address(this) == wallet, SELF == factory
     */
    address private immutable SELF;

    /**
     * @dev The chain ENS renewal happens on: 1 for mainnet,
     * 11155111 for a Sepolia-based testnet deployment. Part of the
     * creation code, so identical across every chain in one set.
     */
    uint256 private immutable HUB_CHAIN_ID;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address private _owner;

    /// @dev Set by `transferOwnership`, cleared by `acceptOwnership`.
    address private _pendingOwner;

    /// @dev Native USDC on this chain. Frozen at initialization. Doubles as the initialization flag.
    address private _usdc;

    /// @dev CCTP finality threshold. Owner-adjustable on an L2.
    uint32 private _minFinalityThreshold;

    /// @dev Circle TokenMessengerV2 on this chain. Burns from an L2; the expected recipient of a hub message. Frozen.
    address private _tokenMessenger;

    /// @dev Circle MessageTransmitterV2 on the hub. Zero on an L2. Frozen.
    address private _messageTransmitter;

    /// @dev The active ENS adapter on the hub. Selected by governance.
    address private _adapter;

    /// @dev The ENS governance executor on the hub. Must be the ENS Timelock on mainnet.
    address private _governanceExecutor;

    address private _pendingGovernanceExecutor;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotOwner();
    error NotPendingOwner();
    error NotGovernance();
    error NotPendingGovernance();
    error WrongExecutionContext();
    error Reentrancy();

    error ZeroAddress();
    error InvalidHubChainId();
    error EmptyLabel();
    error DottedLabel();
    error LabelTooLong();
    error NoUSDC();

    error ApprovalFailed();
    error TransferFailed();
    error NotAContract();
    error PredictionMismatch();

    error NotInitialized();
    error AlreadyInitialized();
    error NotHub();
    error UnexpectedHubConfiguration();
    error InvalidFinalityThreshold();
    error BelowMinimumBurn();
    error BurnsDisabled();

    error NoActiveHelper();
    error IncompatibleHelper();
    error InsufficientAmount();
    error InvalidPlan();
    error InvalidPlanTarget();
    error RenewalFailed();
    error InvalidSettlement();

    error InvalidCCTPMessage();
    error InvalidWallet();
    error CCTPReceiveFailed();
    error UnexpectedMintAmount();

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Emitted exactly once in the lifetime of the factory. The
     * absence of a second one of these is the on-chain proof that no
     * payment route was ever redirected.
     */
    event Initialized(
        address indexed usdc, address indexed tokenMessenger, address indexed messageTransmitter, address governance
    );

    event FinalityUpdated(uint32 minFinalityThreshold);

    event HelperUpdated(address indexed previousHelper, address indexed newHelper, bytes32 codeHash);

    event GovernanceTransferStarted(address indexed previousExecutor, address indexed newExecutor);

    event GovernanceExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);

    /**
     * @dev The only on-chain record of the label a wallet belongs
     * to. `labelKey` is a keccak hash and cannot be reversed, so the
     * label ships as data for the indexer to store once.
     */
    event WalletDeployed(bytes32 indexed labelKey, address indexed wallet, string label);

    /**
     * @dev One per processed deposit. On the hub, `HelperUsed` and
     * `Renewed` fire *before* this, in that order. On an L2 it marks
     * the burn; the CCTP nonce is in TokenMessengerV2's
     * `DepositForBurn` in the same transaction.
     *
     * `remaining` is what is still at the deposit address afterwards.
     * It is non-zero when the balance exceeded the per-burn cap.
     */
    event DepositProcessed(bytes32 indexed labelKey, address indexed wallet, uint256 amount, uint256 remaining);

    event CCTPClaimed(
        bytes32 indexed nonce,
        address indexed wallet,
        uint32 sourceDomain,
        uint256 burnAmount,
        uint256 feeExecuted,
        uint256 mintedAmount
    );

    event HelperUsed(address indexed helper, bytes32 indexed labelHash, address indexed wallet);

    event Renewed(
        bytes32 indexed labelHash,
        address indexed wallet,
        address indexed executor,
        string label,
        uint64 duration,
        uint256 amountReceived,
        uint256 gasAllowance,
        uint256 amountApplied,
        uint256 remainder,
        bool fromCCTP
    );

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address initialOwner, uint256 hubChainId) {
        if (initialOwner == address(0)) {
            revert ZeroAddress();
        }

        /*
         * Only the hubs this bytecode was written for. A wrong value
         * is not a misconfiguration to be corrected but a whole
         * deployment set at wrong addresses.
         */
        if (hubChainId != MAINNET_CHAIN_ID && hubChainId != SEPOLIA_CHAIN_ID) {
            revert InvalidHubChainId();
        }

        SELF = address(this);
        HUB_CHAIN_ID = hubChainId;
        _owner = initialOwner;

        emit OwnershipTransferred(address(0), initialOwner);
    }

    /*//////////////////////////////////////////////////////////////
                              MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Requires execution directly on the real factory. It only
     * prevents factory selectors from being executed through a
     * deposit wallet proxy.
     */
    modifier onlyFactoryContext() {
        if (address(this) == SELF) {
            _;
        } else {
            revert WrongExecutionContext();
        }
    }

    /**
     * @dev Requires execution through a universal wallet with the
     * real factory as its immediate caller.
     */
    modifier onlyWalletContext() {
        if (address(this) == SELF || msg.sender != SELF) {
            revert WrongExecutionContext();
        }
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != _owner) {
            revert NotOwner();
        }
        _;
    }

    modifier onlyGovernance() {
        if (_governanceExecutor == address(0) || msg.sender != _governanceExecutor) {
            revert NotGovernance();
        }
        _;
    }

    /**
     * @dev One guard in the factory's transient storage covers every
     * payment entrypoint. A wallet can only be entered by the factory,
     * and the factory's payment entrypoints are guarded, so plan
     * calldata aimed back at either cannot start a second settlement.
     * Transient storage clears at the end of the transaction and is
     * not subject to state-write pricing.
     */
    modifier nonReentrant() {
        bytes32 slot = REENTRANCY_SLOT;
        assembly ("memory-safe") {
            if tload(slot) {
                mstore(0x00, 0xab143c06) // Reentrancy()
                revert(0x1c, 0x04)
            }
            tstore(slot, 1)
        }
        _;
        assembly ("memory-safe") {
            tstore(slot, 0)
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function owner() external view onlyFactoryContext returns (address) {
        return _owner;
    }

    function pendingOwner() external view onlyFactoryContext returns (address) {
        return _pendingOwner;
    }

    function usdc() external view onlyFactoryContext returns (address) {
        return _usdc;
    }

    /// @notice The payment token. Same value as `usdc()`, under the name the adapter interface uses.
    function paymentToken() external view onlyFactoryContext returns (address) {
        return _usdc;
    }

    function tokenMessenger() external view onlyFactoryContext returns (address) {
        return _tokenMessenger;
    }

    function messageTransmitter() external view onlyFactoryContext returns (address) {
        return _messageTransmitter;
    }

    /// @notice The hub settlement address recorded in every burn: this factory, on every chain.
    function l1Helper() external view onlyFactoryContext returns (address) {
        return SELF;
    }

    /// @notice Compatibility shim: the factory is its own gateway.
    function gateway() external view onlyFactoryContext returns (address) {
        return SELF;
    }

    /// @notice Compatibility shim: the factory is its own pointer.
    function pointer() external view onlyFactoryContext returns (address) {
        return SELF;
    }

    function factory() external view onlyFactoryContext returns (address) {
        return SELF;
    }

    function finality() external view onlyFactoryContext returns (uint32) {
        return _minFinalityThreshold;
    }

    function currentHelper() external view onlyFactoryContext returns (address) {
        return _adapter;
    }

    function ensGovernanceExecutor() external view onlyFactoryContext returns (address) {
        return _governanceExecutor;
    }

    function pendingGovernanceExecutor() external view onlyFactoryContext returns (address) {
        return _pendingGovernanceExecutor;
    }

    /// @notice Quote a budget after the fixed executor allowance has been removed.
    function quote(string calldata label, uint256 budget)
        external
        view
        onlyFactoryContext
        returns (uint64 duration, uint256 needed)
    {
        address adapter = _adapter;
        if (adapter == address(0)) revert NoActiveHelper();
        return INamepassRenewalAdapter(adapter).quote(label, budget);
    }

    /**
     * @notice Predicts the deposit address for an ENS label.
     *
     * @dev The supplied label must already be ENSIP-15 normalized
     * and must not include the TLD.
     */
    function predictWallet(string calldata label) external view onlyFactoryContext returns (address) {
        return _predict(_walletSalt(_labelKey(label)));
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN WRITES
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Freezes every payment route. Callable once, ever.
     *
     * Hub:
     *   usdcAddress   = hub USDC
     *   messenger     = hub TokenMessengerV2 (the expected recipient of every claimed message)
     *   transmitter   = hub MessageTransmitterV2
     *   governance    = ENS governance executor (the ENS Timelock on mainnet)
     *
     * L2:
     *   usdcAddress   = local native USDC
     *   messenger     = local TokenMessengerV2
     *   transmitter   = address(0)
     *   governance    = address(0)
     *
     * @dev The trust window is the gap between deployment and this
     * call. After it, the owner cannot move deposited funds at all.
     * The mint recipient of every burn is this contract's own
     * address, so there is no hub address to verify off chain.
     */
    function initialize(address usdcAddress, address messenger, address transmitter, address governance)
        external
        onlyFactoryContext
        onlyOwner
    {
        if (_usdc != address(0)) {
            revert AlreadyInitialized();
        }

        if (usdcAddress == address(0) || messenger == address(0)) {
            revert ZeroAddress();
        }

        if (usdcAddress.code.length == 0 || messenger.code.length == 0) {
            revert NotAContract();
        }

        if (block.chainid == HUB_CHAIN_ID) {
            if (transmitter == address(0) || governance == address(0)) {
                revert ZeroAddress();
            }
            if (transmitter.code.length == 0 || governance.code.length == 0) {
                revert NotAContract();
            }
            _messageTransmitter = transmitter;
            _governanceExecutor = governance;
            emit GovernanceExecutorUpdated(address(0), governance);
        } else {
            if (transmitter != address(0) || governance != address(0)) {
                revert UnexpectedHubConfiguration();
            }
            /*
             * Standard transfers, no fee, until told otherwise.
             */
            _minFinalityThreshold = FINALITY_FINALIZED;
        }

        _usdc = usdcAddress;
        _tokenMessenger = messenger;

        emit Initialized(usdcAddress, messenger, transmitter, governance);
        emit FinalityUpdated(_minFinalityThreshold);
    }

    /**
     * @notice Chooses the CCTP tier for this chain.
     *
     * @dev Speed only. The fee ceiling is *not* stored — it is
     * supplied per call, so no setting here can price a transfer.
     */
    function setFinality(uint32 minFinalityThreshold) external onlyFactoryContext onlyOwner {
        if (_usdc == address(0)) {
            revert NotInitialized();
        }

        /*
         * There is no CCTP leg on the hub. Storing a value that
         * nothing reads invites a later reader to trust it.
         */
        if (block.chainid == HUB_CHAIN_ID && minFinalityThreshold != 0) {
            revert InvalidFinalityThreshold();
        }

        _minFinalityThreshold = minFinalityThreshold;

        emit FinalityUpdated(minFinalityThreshold);
    }

    /**
     * @notice Nominates a new owner. Two-step: they must accept.
     */
    function transferOwnership(address newOwner) external onlyFactoryContext onlyOwner {
        if (newOwner == address(0)) {
            revert ZeroAddress();
        }

        _pendingOwner = newOwner;

        emit OwnershipTransferStarted(_owner, newOwner);
    }

    /**
     * @notice Completes a transfer started by `transferOwnership`.
     */
    function acceptOwnership() external onlyFactoryContext {
        if (msg.sender != _pendingOwner) {
            revert NotPendingOwner();
        }

        address previousOwner = _owner;
        _owner = msg.sender;
        delete _pendingOwner;

        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                             GOVERNANCE
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Activates an ENS adapter. Hub only; the executor is the
     * ENS governance timelock.
     *
     * @dev The adapter must report interface version 2 and name this
     * factory as its payer and `_usdc` as its token. There is no
     * Namepass bypass and no immediate rollback role.
     */
    function setHelper(address next) external onlyFactoryContext onlyGovernance {
        if (next.code.length == 0) revert ZeroAddress();

        INamepassRenewalAdapter adapter = INamepassRenewalAdapter(next);
        if (
            adapter.interfaceVersion() != ADAPTER_INTERFACE_VERSION || adapter.factory() != SELF
                || adapter.gateway() != SELF || adapter.paymentToken() != _usdc
        ) {
            revert IncompatibleHelper();
        }

        address previous = _adapter;
        _adapter = next;

        emit HelperUpdated(previous, next, next.codehash);
    }

    function transferGovernance(address next) external onlyFactoryContext onlyGovernance {
        if (next.code.length == 0 || next == SELF) revert ZeroAddress();

        _pendingGovernanceExecutor = next;

        emit GovernanceTransferStarted(_governanceExecutor, next);
    }

    function cancelGovernanceTransfer() external onlyFactoryContext onlyGovernance {
        delete _pendingGovernanceExecutor;

        emit GovernanceTransferStarted(_governanceExecutor, address(0));
    }

    function acceptGovernance() external onlyFactoryContext {
        if (_pendingGovernanceExecutor == address(0) || msg.sender != _pendingGovernanceExecutor) {
            revert NotPendingGovernance();
        }

        address previous = _governanceExecutor;
        _governanceExecutor = msg.sender;
        delete _pendingGovernanceExecutor;

        emit GovernanceExecutorUpdated(previous, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                    UNIVERSAL ADDRESS LOGIC
    //////////////////////////////////////////////////////////////*/

    function _labelKey(string calldata label) private pure returns (bytes32) {
        bytes calldata raw = bytes(label);

        if (raw.length == 0) {
            revert EmptyLabel();
        }

        /*
         * ENS's pricing path rejects labels beyond this length
         * outright, so a longer one derives an address that is
         * provably useless. This is **not** normalization; ENSIP-15
         * belongs to off-chain tooling.
         */
        if (raw.length > MAX_LABEL_BYTES) {
            revert LabelTooLong();
        }

        /*
         * A label is one component. A caller passing "vitalik.eth"
         * would otherwise derive a perfectly valid address that no
         * renewal can ever be executed against.
         */
        for (uint256 i; i < raw.length; ++i) {
            if (raw[i] == 0x2e) {
                revert DottedLabel();
            }
        }

        return keccak256(raw);
    }

    function _walletSalt(bytes32 labelKey) private pure returns (bytes32 salt) {
        bytes32 namespace = WALLET_SALT_NAMESPACE;

        assembly ("memory-safe") {
            mstore(0x00, namespace)
            mstore(0x20, labelKey)

            salt := keccak256(0x00, 0x40)
        }
    }

    function _predict(bytes32 salt) private view returns (address) {
        return MinimalProxy.predictUniversalAddress(SELF, salt, SELF);
    }

    /*//////////////////////////////////////////////////////////////
                          API ENTRYPOINTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Processes all native USDC currently held by the
     * universal wallet for `label`.
     *
     * @dev Permissionless, and authorizes **no** CCTP fee. Every
     * destination is frozen, so the caller chooses nothing except to
     * spend their own gas pushing a deposit along the one path it can
     * take. On the hub the caller is paid the gas allowance plus
     * rounding dust.
     */
    function renew(string calldata label) external onlyFactoryContext nonReentrant {
        _renew(label, 0, msg.sender);
    }

    /**
     * @notice Same, but authorizes Circle to charge up to
     * `maxFeeBps` of the transfer on an L2.
     *
     * @dev The escape hatch for the day Circle prices the tier this
     * chain is set to. Anyone can authorize Circle's fee on someone
     * else's deposit; they cannot receive it, redirect anything, or
     * make Circle take more than its actual fee.
     */
    function renewWithFee(string calldata label, uint16 maxFeeBps) external onlyFactoryContext nonReentrant {
        _renew(label, maxFeeBps, msg.sender);
    }

    /**
     * @notice Receives an attested CCTP V2 burn and renews the ENS
     * label encoded in its hook data. Hub only.
     *
     * @dev Accounting is based only on `burn.amount - burn.feeExecuted`
     * from the authenticated message. The factory's existing balance
     * is never used to decide how much this renewal may spend, and it
     * is unchanged after the claim.
     *
     * Permissionless by design: the label is bound to the wallet that
     * burned, so a caller cannot redirect the payment. Whoever submits
     * it is paid the gas allowance plus rounding dust.
     */
    function completeCCTP(bytes calldata message, bytes calldata attestation)
        external
        onlyFactoryContext
        nonReentrant
    {
        if (_messageTransmitter == address(0)) {
            revert NotHub();
        }

        if (message.length < BURN_HOOK_DATA_OFFSET) {
            revert InvalidCCTPMessage();
        }

        _validateRoute(message);

        /*
         * The L2 factory sends raw bytes(label), not abi.encode(label).
         */
        string calldata label = string(message[BURN_HOOK_DATA_OFFSET:]);
        bytes32 labelKey = _labelKey(label);
        address wallet = _predict(_walletSalt(labelKey));

        /*
         * BurnMessageV2.messageSender is the universal source wallet
         * that called TokenMessengerV2. Reject a noncanonical encoding
         * before comparing addresses.
         */
        bytes32 sender = _readBytes32(message, BURN_MESSAGE_SENDER_OFFSET);
        if (sender != _addressToBytes32(address(uint160(uint256(sender))))) {
            revert InvalidCCTPMessage();
        }
        if (sender != _addressToBytes32(wallet)) {
            revert InvalidWallet();
        }

        address adapter = _adapter;
        if (adapter == address(0)) revert NoActiveHelper();

        uint256 minted = _claim(message, attestation, wallet);

        _settleAndReport(label, labelKey, wallet, minted, msg.sender, adapter, true);
    }

    /*//////////////////////////////////////////////////////////////
                           DEPOSIT PROCESSING
    //////////////////////////////////////////////////////////////*/

    function _renew(string calldata label, uint16 maxFeeBps, address executor) private {
        address usdcAddress = _usdc;
        if (usdcAddress == address(0)) {
            revert NotInitialized();
        }

        bytes32 labelKey = _labelKey(label);
        bytes32 salt = _walletSalt(labelKey);
        address wallet = _predict(salt);

        /*
         * Read before deploying. An empty wallet would otherwise be
         * created and then rolled back by the revert below.
         */
        uint256 balance = IERC20(usdcAddress).balanceOf(wallet);
        if (balance == 0) {
            revert NoUSDC();
        }

        uint256 amount = balance;

        if (block.chainid == HUB_CHAIN_ID) {
            _renewHub(label, labelKey, salt, wallet, amount, executor, usdcAddress);
        } else {
            amount = _renewL2(label, labelKey, salt, wallet, amount, maxFeeBps, usdcAddress);
        }

        emit DepositProcessed(labelKey, wallet, amount, balance - amount);
    }

    function _renewHub(
        string calldata label,
        bytes32 labelKey,
        bytes32 salt,
        address wallet,
        uint256 amount,
        address executor,
        address usdcAddress
    ) private {
        address adapter = _adapter;
        if (adapter == address(0)) revert NoActiveHelper();

        _deployIfNeeded(wallet, salt, labelKey, label);

        Settlement memory settled = Settlement({
            labelKey: labelKey,
            wallet: wallet,
            executor: executor,
            adapter: adapter,
            duration: 0,
            amount: amount,
            price: 0,
            fromCCTP: false
        });

        (, settled.duration, settled.price) =
            INamepassWallet(wallet).executeHub(label, amount, executor, usdcAddress, adapter);

        _report(label, settled);
    }

    function _renewL2(
        string calldata label,
        bytes32 labelKey,
        bytes32 salt,
        address wallet,
        uint256 amount,
        uint16 maxFeeBps,
        address usdcAddress
    ) private returns (uint256) {
        amount = _capBurn(usdcAddress, amount, maxFeeBps);

        _deployIfNeeded(wallet, salt, labelKey, label);

        INamepassWallet(wallet).executeL2(
            label,
            BurnParams({
                amount: amount,
                maxFeeBps: maxFeeBps,
                usdc: usdcAddress,
                messenger: _tokenMessenger,
                minFinalityThreshold: _minFinalityThreshold
            })
        );

        return amount;
    }

    /**
     * @dev Circle rejects a burn above its per-transaction limit, so
     * an over-limit balance is processed in slices across calls. The
     * limit is read from Circle's own TokenMinter so no Namepass key
     * decides how much travels. A zero limit means burns are disabled.
     *
     * Off the hub, also refuse to burn what the hub could never spend:
     * the allowance plus one second of the dearest name, checked
     * against what would arrive after the authorized fee ceiling.
     */
    function _capBurn(address usdcAddress, uint256 amount, uint16 maxFeeBps) private view returns (uint256) {
        uint256 burnLimit = ITokenMessengerV2(_tokenMessenger).localMinter().burnLimitsPerMessage(usdcAddress);

        if (burnLimit == 0) {
            revert BurnsDisabled();
        }

        if (amount > burnLimit) {
            amount = burnLimit;
        }

        uint256 worstCaseFee = (amount * uint256(maxFeeBps) + BPS_DENOMINATOR - 1) / BPS_DENOMINATOR;

        if (worstCaseFee >= amount || amount - worstCaseFee < MIN_BURN_AMOUNT) {
            revert BelowMinimumBurn();
        }

        return amount;
    }

    function _deployIfNeeded(address wallet, bytes32 salt, bytes32 labelKey, string calldata label) private {
        if (wallet.code.length != 0) {
            return;
        }

        address deployed = MinimalProxy.cloneUniversal(SELF, salt);

        /*
         * Prediction and deployment are two separate assembly blocks
         * that must agree. One comparison, once per wallet, closes
         * off a silent and unrecoverable divergence.
         */
        if (deployed != wallet) {
            revert PredictionMismatch();
        }

        emit WalletDeployed(labelKey, wallet, label);
    }

    /*//////////////////////////////////////////////////////////////
                 LOGIC EXECUTED INSIDE EACH WALLET
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Runs through delegatecall inside the universal wallet on
     * the hub. The wallet stores nothing; every input is calldata from
     * the factory, which guarantees `amount` is the wallet's live USDC
     * balance and non-zero.
     */
    function executeHub(string calldata label, uint256 amount, address executor, address usdcAddress, address adapter)
        external
        onlyWalletContext
        returns (address renewer, uint64 duration, uint256 price)
    {
        return _settle(label, amount, executor, usdcAddress, adapter);
    }

    /**
     * @notice Runs through delegatecall inside the universal wallet on
     * an L2. Burns `burn.amount` to this factory's own address on the hub.
     */
    function executeL2(string calldata label, BurnParams calldata burn) external onlyWalletContext {
        /*
         * TokenMessengerV2 pulls exactly `amount` from this wallet. A
         * successful burn consumes the allowance; a reverted burn
         * reverts the approval with it.
         */
        _safeApprove(burn.usdc, burn.messenger, burn.amount);

        /*
         * Raw label bytes, not abi.encode — the hub reads this as
         * string(hookData). Mint recipient and destination caller are
         * this factory's own address, identical on every chain.
         */
        ITokenMessengerV2(burn.messenger).depositForBurnWithHook(
            burn.amount,
            HUB_CCTP_DOMAIN,
            _addressToBytes32(SELF),
            burn.usdc,
            _addressToBytes32(SELF),
            _maxFee(burn.amount, burn.maxFeeBps),
            burn.minFinalityThreshold,
            bytes(label)
        );
    }

    /**
     * @dev Converts the fee ceiling into USDC subunits, rounding up,
     * and always leaves at least one subunit to mint on the hub.
     */
    function _maxFee(uint256 amount, uint16 maxFeeBps) private pure returns (uint256 maxFee) {
        maxFee = (amount * uint256(maxFeeBps) + BPS_DENOMINATOR - 1) / BPS_DENOMINATOR;

        if (maxFee >= amount) {
            unchecked {
                maxFee = amount - 1;
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                              SETTLEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev The one settlement routine. Runs inside a wallet on the
     * direct path and inside the factory on the CCTP path. `amount` is
     * the authenticated payment: the wallet balance the factory read,
     * or the amount Circle minted. Nothing else held by the payer is
     * ever spent.
     *
     * Invariants:
     *  - `0 < price <= amount - GAS_ALLOWANCE`, `duration > 0`;
     *  - the target and the spender are contracts, and neither is the payer, the factory, or the token;
     *  - the payer's balance decreases by exactly `price`;
     *  - no allowance remains afterwards;
     *  - the executor receives exactly `amount - price`.
     */
    function _settle(string calldata label, uint256 amount, address executor, address usdcAddress, address adapter)
        private
        returns (address renewer, uint64 duration, uint256 price)
    {
        if (amount <= GAS_ALLOWANCE) revert InsufficientAmount();

        address spender;
        bytes memory data;
        (renewer, spender, duration, price, data) = INamepassRenewalAdapter(adapter).plan(label, amount - GAS_ALLOWANCE);

        if (duration == 0 || price == 0 || price > amount - GAS_ALLOWANCE) revert InvalidPlan();

        if (!_acceptableTarget(renewer, usdcAddress) || !_acceptableTarget(spender, usdcAddress)) {
            revert InvalidPlanTarget();
        }

        uint256 before = IERC20(usdcAddress).balanceOf(address(this));
        if (before < amount) revert InsufficientAmount();

        /*
         * Approve the spender for exactly the price, execute the plan
         * against the target, and require that exactly the price left.
         * ENS prices the renewal itself inside `renew`, so a plan that
         * disagrees with ENS fails here on the allowance or on the delta.
         */
        _safeApprove(usdcAddress, spender, price);

        (bool ok, bytes memory returned) = renewer.call(data);
        if (!ok) {
            if (returned.length == 0) revert RenewalFailed();
            assembly ("memory-safe") {
                revert(add(returned, 0x20), mload(returned))
            }
        }

        if (IERC20(usdcAddress).balanceOf(address(this)) + price != before) revert InvalidSettlement();

        if (IERC20(usdcAddress).allowance(address(this), spender) != 0) {
            _safeApprove(usdcAddress, spender, 0);
        }

        _safeTransfer(usdcAddress, executor, amount - price);
    }

    /// @dev A plan may name a contract, never the payer, the factory, or the token.
    function _acceptableTarget(address target, address usdcAddress) private view returns (bool) {
        return target != address(this) && target != SELF && target != usdcAddress && target.code.length != 0;
    }

    function _settleAndReport(
        string calldata label,
        bytes32 labelKey,
        address wallet,
        uint256 amount,
        address executor,
        address adapter,
        bool fromCCTP
    ) private {
        Settlement memory settled = Settlement({
            labelKey: labelKey,
            wallet: wallet,
            executor: executor,
            adapter: adapter,
            duration: 0,
            amount: amount,
            price: 0,
            fromCCTP: fromCCTP
        });

        (, settled.duration, settled.price) = _settle(label, amount, executor, _usdc, adapter);

        _report(label, settled);
    }

    /// @dev `HelperUsed` immediately before `Renewed`, both from the factory address.
    function _report(string calldata label, Settlement memory s) private {
        emit HelperUsed(s.adapter, s.labelKey, s.wallet);
        emit Renewed(
            s.labelKey,
            s.wallet,
            s.executor,
            label,
            s.duration,
            s.amount,
            GAS_ALLOWANCE,
            s.price,
            s.amount - GAS_ALLOWANCE - s.price,
            s.fromCCTP
        );
    }

    /*//////////////////////////////////////////////////////////////
                              CCTP CLAIM
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Requires a genuine Namepass-shaped CCTP route: message and
     * burn-body version 1, hub destination domain, a non-hub source
     * domain, Circle's TokenMessenger as recipient, and this factory
     * as both destination caller and mint recipient.
     */
    function _validateRoute(bytes calldata message) private view {
        if (
            _readUint32(message, 0) != 1 || _readUint32(message, BURN_BODY_VERSION_OFFSET) != 1
                || _readUint32(message, MESSAGE_DESTINATION_DOMAIN_OFFSET) != HUB_CCTP_DOMAIN
                || _readUint32(message, MESSAGE_SOURCE_DOMAIN_OFFSET) == 0
        ) revert InvalidCCTPMessage();

        bytes32 self = _addressToBytes32(SELF);

        if (
            _readBytes32(message, MESSAGE_RECIPIENT_OFFSET) != _addressToBytes32(_tokenMessenger)
                || _readBytes32(message, MESSAGE_DESTINATION_CALLER_OFFSET) != self
                || _readBytes32(message, BURN_MINT_RECIPIENT_OFFSET) != self
        ) {
            revert InvalidCCTPMessage();
        }
    }

    /**
     * @dev Claims the message and returns the amount Circle actually
     * minted, which is the only figure the renewal may spend against.
     * The balance reads are an assertion around the mint, not an
     * input to the renewal.
     */
    function _claim(bytes calldata message, bytes calldata attestation, address wallet)
        private
        returns (uint256 mintedAmount)
    {
        uint256 burnAmount = uint256(_readBytes32(message, BURN_AMOUNT_OFFSET));
        uint256 feeExecuted = uint256(_readBytes32(message, BURN_FEE_EXECUTED_OFFSET));

        if (feeExecuted > burnAmount) {
            revert InvalidCCTPMessage();
        }

        unchecked {
            mintedAmount = burnAmount - feeExecuted;
        }

        if (mintedAmount == 0) {
            revert InsufficientAmount();
        }

        uint256 beforeBalance = IERC20(_usdc).balanceOf(SELF);

        if (!IMessageTransmitterV2(_messageTransmitter).receiveMessage(message, attestation)) {
            revert CCTPReceiveFailed();
        }

        if (IERC20(_usdc).balanceOf(SELF) != beforeBalance + mintedAmount) {
            revert UnexpectedMintAmount();
        }

        emit CCTPClaimed(
            _readBytes32(message, MESSAGE_NONCE_OFFSET),
            wallet,
            _readUint32(message, MESSAGE_SOURCE_DOMAIN_OFFSET),
            burnAmount,
            feeExecuted,
            mintedAmount
        );
    }

    /*//////////////////////////////////////////////////////////////
                          TOKEN HELPERS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Tolerates a token that returns nothing instead of a bool.
     * Native USDC returns one on all four target chains.
     */
    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.approve, (spender, amount)));

        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert ApprovalFailed();
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));

        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function _readBytes32(bytes calldata data, uint256 offset) private pure returns (bytes32 value) {
        assembly ("memory-safe") {
            value := calldataload(add(data.offset, offset))
        }
    }

    function _readUint32(bytes calldata data, uint256 offset) private pure returns (uint32 value) {
        assembly ("memory-safe") {
            value := shr(224, calldataload(add(data.offset, offset)))
        }
    }

    function _addressToBytes32(address value) private pure returns (bytes32) {
        return bytes32(uint256(uint160(value)));
    }
}
