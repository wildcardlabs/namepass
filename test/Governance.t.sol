// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {ENSV2RenewalAdapter} from "../contracts/ENSV2RenewalAdapter.sol";
import {MockUSDC, Dummy} from "./mocks/Mocks.sol";

/**
 * @notice Initialization, the governance slot, and the owner's remaining
 * powers. Governance selects the adapter through a timelock; the owner
 * can only retune CCTP finality.
 */
contract GovernanceTest is Test {
    TimelockController internal timelock;
    NamepassFactory internal factory;
    MockUSDC internal usdc;
    ENSV2RenewalAdapter internal adapter;
    address internal dummy;

    function setUp() public {
        vm.chainId(11155111);
        factory = new NamepassFactory(address(this), 11155111);
        usdc = new MockUSDC();
        dummy = address(new Dummy());
        timelock = _timelock();
        factory.initialize(address(usdc), dummy, dummy, address(timelock));
        adapter = _adapter(address(factory), address(usdc));
    }

    function _timelock() private returns (TimelockController) {
        address[] memory actors = new address[](1);
        actors[0] = address(this);
        return new TimelockController(1 days, actors, actors, address(0));
    }

    function _adapter(address factory_, address token) private returns (ENSV2RenewalAdapter) {
        return new ENSV2RenewalAdapter(factory_, token, dummy, address(0), bytes32(0));
    }

    function _execute(TimelockController executor, bytes memory callData) private {
        executor.schedule(address(factory), 0, callData, bytes32(0), bytes32(0), 1 days);
        vm.warp(block.timestamp + 1 days);
        executor.execute(address(factory), 0, callData, bytes32(0), bytes32(0));
    }

    /*//////////////////////////////////////////////////////////////
                             ACTIVATION
    //////////////////////////////////////////////////////////////*/

    function test_requiresTimelockAndHonorsDelay() public {
        vm.expectRevert(NamepassFactory.NotGovernance.selector);
        factory.setHelper(address(adapter));

        bytes memory callData = abi.encodeCall(factory.setHelper, (address(adapter)));
        timelock.schedule(address(factory), 0, callData, bytes32(0), bytes32(0), 1 days);
        vm.expectRevert();
        timelock.execute(address(factory), 0, callData, bytes32(0), bytes32(0));
        assertEq(factory.currentHelper(), address(0));

        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(factory), 0, callData, bytes32(0), bytes32(0));
        assertEq(factory.currentHelper(), address(adapter));
        assertEq(factory.gateway(), address(factory));
        assertEq(factory.pointer(), address(factory));
        assertEq(adapter.gateway(), address(factory));
    }

    function test_cancelledActivationCannotExecute() public {
        bytes memory callData = abi.encodeCall(factory.setHelper, (address(adapter)));
        timelock.schedule(address(factory), 0, callData, bytes32(0), bytes32(0), 1 days);
        timelock.cancel(timelock.hashOperation(address(factory), 0, callData, bytes32(0), bytes32(0)));
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert();
        timelock.execute(address(factory), 0, callData, bytes32(0), bytes32(0));
    }

    /// @dev Replacing the adapter never moves a deposit address or the hub settlement address.
    function test_replacementAndRollbackKeepWalletAndDestination() public {
        address wallet = factory.predictWallet("vitalik");
        _execute(timelock, abi.encodeCall(factory.setHelper, (address(adapter))));
        ENSV2RenewalAdapter next = _adapter(address(factory), address(usdc));
        _execute(timelock, abi.encodeCall(factory.setHelper, (address(next))));
        assertEq(factory.predictWallet("vitalik"), wallet);
        assertEq(factory.l1Helper(), address(factory));
        assertEq(factory.currentHelper(), address(next));

        bytes memory callData = abi.encodeCall(factory.setHelper, (address(adapter)));
        timelock.schedule(address(factory), 0, callData, bytes32(0), bytes32(uint256(1)), 1 days);
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(factory), 0, callData, bytes32(0), bytes32(uint256(1)));
        assertEq(factory.currentHelper(), address(adapter));
        assertEq(factory.predictWallet("vitalik"), wallet);
    }

    function test_rejectsIncompatibleAdapters() public {
        ENSV2RenewalAdapter wrongFactory = _adapter(dummy, address(usdc));
        ENSV2RenewalAdapter wrongToken = _adapter(address(factory), dummy);
        VersionOneAdapter oldVersion = new VersionOneAdapter(address(factory), address(usdc));

        vm.startPrank(address(timelock));
        vm.expectRevert(NamepassFactory.IncompatibleHelper.selector);
        factory.setHelper(address(wrongFactory));
        vm.expectRevert(NamepassFactory.IncompatibleHelper.selector);
        factory.setHelper(address(wrongToken));
        vm.expectRevert(NamepassFactory.IncompatibleHelper.selector);
        factory.setHelper(address(oldVersion));
        vm.expectRevert(NamepassFactory.ZeroAddress.selector);
        factory.setHelper(address(0));
        vm.expectRevert(NamepassFactory.ZeroAddress.selector);
        factory.setHelper(address(0xBAD));
        vm.stopPrank();
    }

    function test_executorHandoverRequiresBothTimelocksAndCanBeCancelled() public {
        TimelockController next = _timelock();
        _execute(timelock, abi.encodeCall(factory.transferGovernance, (address(next))));
        assertEq(factory.ensGovernanceExecutor(), address(timelock));
        assertEq(factory.pendingGovernanceExecutor(), address(next));

        vm.expectRevert(NamepassFactory.NotPendingGovernance.selector);
        factory.acceptGovernance();

        bytes memory cancel = abi.encodeCall(factory.cancelGovernanceTransfer, ());
        timelock.schedule(address(factory), 0, cancel, bytes32(0), bytes32(uint256(2)), 1 days);
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(factory), 0, cancel, bytes32(0), bytes32(uint256(2)));
        assertEq(factory.pendingGovernanceExecutor(), address(0));
        vm.prank(address(next));
        vm.expectRevert(NamepassFactory.NotPendingGovernance.selector);
        factory.acceptGovernance();

        bytes memory transfer = abi.encodeCall(factory.transferGovernance, (address(next)));
        timelock.schedule(address(factory), 0, transfer, bytes32(0), bytes32(uint256(3)), 1 days);
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(factory), 0, transfer, bytes32(0), bytes32(uint256(3)));
        _execute(next, abi.encodeCall(factory.acceptGovernance, ()));
        assertEq(factory.ensGovernanceExecutor(), address(next));

        vm.prank(address(timelock));
        vm.expectRevert(NamepassFactory.NotGovernance.selector);
        factory.setHelper(address(adapter));
        _execute(next, abi.encodeCall(factory.setHelper, (address(adapter))));
        assertEq(factory.currentHelper(), address(adapter));
    }

    function test_inactiveAdapterLeavesWalletFundsInPlace() public {
        address wallet = factory.predictWallet("vitalik");
        usdc.mint(wallet, 8_110_000);
        vm.expectRevert(NamepassFactory.NoActiveHelper.selector);
        factory.renew("vitalik");
        vm.expectRevert(NamepassFactory.NoActiveHelper.selector);
        factory.quote("vitalik", 8_000_000);
        assertEq(usdc.balanceOf(wallet), 8_110_000);
        assertEq(wallet.code.length, 0, "a wallet was deployed for a renewal that could not run");
    }

    /*//////////////////////////////////////////////////////////////
                           INITIALIZATION
    //////////////////////////////////////////////////////////////*/

    function test_initializesOnceAndFreezesRoutes() public {
        assertEq(factory.usdc(), address(usdc));
        assertEq(factory.paymentToken(), address(usdc));
        assertEq(factory.tokenMessenger(), dummy);
        assertEq(factory.messageTransmitter(), dummy);
        assertEq(factory.ensGovernanceExecutor(), address(timelock));
        vm.expectRevert(NamepassFactory.AlreadyInitialized.selector);
        factory.initialize(address(usdc), dummy, dummy, address(timelock));
    }

    function test_hubRequiresTransmitterAndGovernance() public {
        NamepassFactory fresh = new NamepassFactory(address(this), 11155111);
        vm.expectRevert(NamepassFactory.ZeroAddress.selector);
        fresh.initialize(address(usdc), dummy, address(0), address(timelock));
        vm.expectRevert(NamepassFactory.ZeroAddress.selector);
        fresh.initialize(address(usdc), dummy, dummy, address(0));
        vm.expectRevert(NamepassFactory.NotAContract.selector);
        fresh.initialize(address(usdc), dummy, dummy, address(0xBAD));
        vm.expectRevert(NamepassFactory.NotInitialized.selector);
        fresh.renew("vitalik");
    }

    function test_l2RejectsHubConfigurationAndGovernance() public {
        vm.chainId(84532);
        NamepassFactory l2 = new NamepassFactory(address(this), 11155111);
        vm.expectRevert(NamepassFactory.UnexpectedHubConfiguration.selector);
        l2.initialize(address(usdc), dummy, dummy, address(0));
        vm.expectRevert(NamepassFactory.UnexpectedHubConfiguration.selector);
        l2.initialize(address(usdc), dummy, address(0), address(timelock));
        l2.initialize(address(usdc), dummy, address(0), address(0));
        assertEq(l2.finality(), 2000);
        assertEq(l2.ensGovernanceExecutor(), address(0));
        vm.prank(address(timelock));
        vm.expectRevert(NamepassFactory.NotGovernance.selector);
        l2.setHelper(address(adapter));
        vm.expectRevert(NamepassFactory.NotPendingGovernance.selector);
        l2.acceptGovernance();
    }

    /*//////////////////////////////////////////////////////////////
                               OWNER
    //////////////////////////////////////////////////////////////*/

    function test_ownerCanOnlyRetuneFinality() public {
        vm.expectRevert(NamepassFactory.InvalidFinalityThreshold.selector);
        factory.setFinality(1000);
        factory.setFinality(0);

        vm.chainId(84532);
        NamepassFactory l2 = new NamepassFactory(address(this), 11155111);
        l2.initialize(address(usdc), dummy, address(0), address(0));
        l2.setFinality(1000);
        assertEq(l2.finality(), 1000);
        vm.prank(address(0xBAD));
        vm.expectRevert(NamepassFactory.NotOwner.selector);
        l2.setFinality(2000);

        l2.transferOwnership(address(0xA));
        vm.expectRevert(NamepassFactory.NotPendingOwner.selector);
        l2.acceptOwnership();
        vm.prank(address(0xA));
        l2.acceptOwnership();
        assertEq(l2.owner(), address(0xA));
    }
}

/// @dev An adapter that still reports the version-1 execution interface.
contract VersionOneAdapter {
    uint256 public constant interfaceVersion = 1;
    address public immutable gateway;
    address public immutable factory;
    address public immutable paymentToken;

    constructor(address factory_, address token) {
        gateway = factory_;
        factory = factory_;
        paymentToken = token;
    }
}
