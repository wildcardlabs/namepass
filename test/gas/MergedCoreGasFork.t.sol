// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MergedCoreAdapter} from "./MergedCoreAdapter.sol";
import {Dummy} from "../mocks/Mocks.sol";

/// @notice Stand-in for the merged design's settlement routine, as measured for the proposal.
/// @dev Plan from a view-only adapter, approve the renewer for the exact price, execute, verify the
/// balance delta, pay the executor `amount - price`, emit the three events. It omits the factory's
/// label hashing and the proxy dispatch. It is a measurement harness, not the proposed contract.
contract MergedCorePath is ReentrancyGuard {
    uint256 public constant GAS_ALLOWANCE = 100_000;
    IERC20 private immutable USDC;
    address public currentHelper;

    error Rejected();

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
    event DepositProcessed(bytes32 indexed labelKey, address indexed wallet, uint256 amount, uint256 remaining);

    constructor(address usdc_, address helper_) {
        USDC = IERC20(usdc_);
        currentHelper = helper_;
    }

    function renew(string calldata label) external nonReentrant {
        uint256 amount = USDC.balanceOf(address(this));
        if (amount <= GAS_ALLOWANCE) revert Rejected();
        address helper = currentHelper;
        (address renewer, uint64 duration, uint256 needed, bytes memory data) =
            MergedCoreAdapter(helper).plan(label, amount - GAS_ALLOWANCE);
        if (!USDC.approve(renewer, needed)) revert Rejected();
        (bool ok,) = renewer.call(data);
        if (!ok) revert Rejected();
        if (amount - USDC.balanceOf(address(this)) != needed) revert Rejected();
        if (USDC.allowance(address(this), renewer) != 0 && !USDC.approve(renewer, 0)) revert Rejected();
        uint256 payout = amount - needed;
        if (!USDC.transfer(msg.sender, payout)) revert Rejected();
        bytes32 labelHash = keccak256(bytes(label));
        emit HelperUsed(helper, labelHash, address(this));
        emit Renewed(labelHash, address(this), msg.sender, label, duration, amount, GAS_ALLOWANCE, needed, payout - GAS_ALLOWANCE, false);
        emit DepositProcessed(labelHash, address(this), amount, 0);
    }
}

/// @notice Opt-in gas measurement of the merged design's core path against live Sepolia ENS.
/// @dev Set NAMEPASS_FORK_RPC and optionally NAMEPASS_FORK_BLOCK. Run together with
/// CurrentPathGasForkTest at the same block for a like-for-like comparison.
contract MergedCoreGasForkTest is Test {
    address constant REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
    address constant V1 = 0xf2ece44980778966b8a0FccB3A9E339440f6e045;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    MergedCorePath internal path;
    bool internal enabled;

    function setUp() public {
        string memory rpc = vm.envOr("NAMEPASS_FORK_RPC", string(""));
        enabled = bytes(rpc).length != 0;
        if (!enabled) return;
        uint256 forkBlock = vm.envOr("NAMEPASS_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        vm.setEvmVersion("cancun");
        address standIn = address(new Dummy());
        MergedCoreAdapter adapter =
            new MergedCoreAdapter(standIn, standIn, USDC, REGISTRAR, V1, bytes32(uint256(0x1208)));
        path = new MergedCorePath(USDC, address(adapter));
    }

    function _renew(string memory tag) internal {
        deal(USDC, address(path), 27_110_000);
        uint256 before = gasleft();
        path.renew("vitalik");
        console2.log(tag, before - gasleft());
        assertEq(IERC20(USDC).balanceOf(address(path)), 0);
        assertEq(IERC20(USDC).allowance(address(path), V1), 0);
    }

    function testForkGas_mergedCoreV1() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        uint256 executorBefore = IERC20(USDC).balanceOf(address(this));
        _renew("merged#1 first use: executor slot cold, no wallet deploy in this harness");
        _renew("merged#2 steady state");
        _renew("merged#3 steady state");
        assertGe(IERC20(USDC).balanceOf(address(this)), executorBefore + 3 * 100_000);
    }
}
