// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";

import {NamepassFactory, INamepassWallet} from "../contracts/NamepassFactory.sol";
import {ENSV2RenewalAdapter} from "../contracts/ENSV2RenewalAdapter.sol";
import {IETHRenewer} from "../contracts/interfaces/IENSRenewal.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HubSetup} from "./HubSetup.sol";
import {MockUSDC} from "./mocks/Mocks.sol";

/**
 * @notice The direct hub path: settlement runs inside the deposit
 * wallet, pays ENS exactly the plan's price, pays the executor the rest,
 * and reports through the factory's events.
 */
contract RenewalTest is HubSetup {
    bytes32 constant HELPER_USED = keccak256("HelperUsed(address,bytes32,address)");
    bytes32 constant RENEWED = keccak256("Renewed(bytes32,address,address,string,uint64,uint256,uint256,uint256,uint256,bool)");
    bytes32 constant PROCESSED = keccak256("DepositProcessed(bytes32,address,uint256,uint256)");

    /*//////////////////////////////////////////////////////////////
                           THE GAS ALLOWANCE
    //////////////////////////////////////////////////////////////*/

    /// @dev The executor receives the allowance plus rounding dust; nothing stays behind.
    function test_executorIsPaidTheAllowanceAndTheDust() public {
        _fund(27_110_000);
        _renewAs(EXECUTOR);

        uint256 charged = usdc.balanceOf(ethRegistrar.beneficiary());
        assertEq(usdc.balanceOf(EXECUTOR), 27_110_000 - charged, "executor was not paid the remainder");
        assertGe(usdc.balanceOf(EXECUTOR), factory.GAS_ALLOWANCE(), "executor was paid less than the allowance");
    }

    /**
     * @dev The allowance comes off *before* pricing. The UI solves
     * durations from `budget - allowance`, so if this stopped being
     * true the UI would quote a duration the chain does not deliver.
     */
    function test_allowanceIsDeductedBeforePricing() public {
        uint256 sent = 27_110_000;
        _fund(sent);

        (uint64 expected,) = factory.quote(LABEL, sent - factory.GAS_ALLOWANCE());

        _renewAs(EXECUTOR);

        assertEq(ethRegistrar.lastDuration(), expected, "duration was not solved from the post-allowance amount");
    }

    function test_rejectsPaymentAtOrBelowTheAllowance() public {
        _fund(factory.GAS_ALLOWANCE());

        vm.prank(EXECUTOR);
        vm.expectRevert(NamepassFactory.InsufficientAmount.selector);
        factory.renew(LABEL);

        assertEq(usdc.balanceOf(wallet), factory.GAS_ALLOWANCE());
    }

    /*//////////////////////////////////////////////////////////////
                              ACCOUNTING
    //////////////////////////////////////////////////////////////*/

    /// @dev Everything sent is accounted for: charged + paid, nothing left anywhere.
    function testFuzz_everySentUnitIsAccountedFor(uint256 rawAmount) public {
        uint256 sent = bound(rawAmount, factory.GAS_ALLOWANCE() + 1_000, 1e12);
        _fund(sent);
        _renewAs(EXECUTOR);

        uint256 charged = usdc.balanceOf(ethRegistrar.beneficiary());
        uint256 paidExecutor = usdc.balanceOf(EXECUTOR);

        assertEq(charged + paidExecutor, sent, "funds went missing");
        assertGe(paidExecutor, factory.GAS_ALLOWANCE(), "wrong allowance paid");
        assertEq(usdc.balanceOf(wallet), 0, "wallet was not fully drained");
        assertEq(usdc.balanceOf(address(factory)), 0, "the factory kept funds");
        assertEq(usdc.balanceOf(address(adapter)), 0, "the adapter received funds");
    }

    /// @dev The remainder is sub-second rounding, not a meaningful sum.
    function test_remainderIsRoundingDustOnly() public {
        _fund(27_110_000);
        _renewAs(EXECUTOR);

        assertLt(usdc.balanceOf(EXECUTOR) - factory.GAS_ALLOWANCE(), 25, "remainder is larger than rounding");
    }

    /// @dev Nothing may be left approved to a renewer after settlement.
    function test_noStandingAllowanceIsLeft() public {
        _fund(27_110_000);
        _renewAs(EXECUTOR);

        assertEq(usdc.allowance(wallet, address(ethRegistrar)), 0, "a standing allowance survived the renewal");
        assertEq(usdc.allowance(wallet, address(adapter)), 0);
    }

    /// @dev ENS is paid by the wallet itself; there is no intermediate custodian.
    function test_walletPaysEnsDirectly() public {
        _fund(27_110_000);
        _renewAs(EXECUTOR);

        assertEq(ethRegistrar.lastPayer(), wallet, "ENS was not paid by the deposit wallet");
    }

    /// @dev Funds held by the factory or the adapter are never part of a wallet's flow.
    function test_donationsStayOutsideSettlement() public {
        usdc.mint(address(factory), 5_000_000);
        usdc.mint(address(adapter), 7_000_000);
        _fund(27_110_000);
        _renewAs(EXECUTOR);

        uint256 charged = usdc.balanceOf(ethRegistrar.beneficiary());
        assertEq(usdc.balanceOf(address(factory)), 5_000_000, "the factory's balance changed");
        assertEq(usdc.balanceOf(address(adapter)), 7_000_000, "the adapter's balance changed");
        assertEq(usdc.balanceOf(EXECUTOR), 27_110_000 - charged, "the executor was paid from the wrong balance");
    }

    function test_failedRenewalLeavesWalletFundsUnchanged() public {
        ethRegistrar.setRenewable(false);
        ethRenewerV1.setRenewable(false);
        _fund(27_110_000);

        vm.prank(EXECUTOR);
        vm.expectRevert(ENSV2RenewalAdapter.NameNotRenewable.selector);
        factory.renew(LABEL);

        assertEq(usdc.balanceOf(wallet), 27_110_000);
        assertEq(usdc.balanceOf(EXECUTOR), 0);
        assertEq(usdc.allowance(wallet, address(ethRegistrar)), 0);
    }

    /*//////////////////////////////////////////////////////////////
                           PLAN CONSTRAINTS
    //////////////////////////////////////////////////////////////*/

    /// @dev Governance can select arbitrary code. These are the factory's limits on what a plan may do.
    function test_rejectsAdversarialPlans() public {
        _fund(27_110_000);
        uint256 budget = 27_110_000 - factory.GAS_ALLOWANCE();
        Thief thief = new Thief(usdc);

        uint256[10] memory modes = [uint256(0), 1, 2, 3, 4, 5, 6, 8, 9, 10];
        bytes4[10] memory expected = [
            NamepassFactory.InvalidPlan.selector, // price above the budget
            NamepassFactory.InvalidPlan.selector, // zero duration
            NamepassFactory.InvalidPlanTarget.selector, // target is the token
            NamepassFactory.InvalidPlanTarget.selector, // target is the factory
            NamepassFactory.InvalidPlanTarget.selector, // target is the wallet itself
            NamepassFactory.InvalidSettlement.selector, // target pulls less than the price
            bytes4(0), // target pulls more than approved: the token reverts
            NamepassFactory.InvalidPlanTarget.selector, // spender is the token
            NamepassFactory.InvalidPlanTarget.selector, // spender is the wallet itself
            NamepassFactory.InvalidPlanTarget.selector // spender is the factory
        ];

        for (uint256 i; i < modes.length; ++i) {
            AdversarialAdapter bad = new AdversarialAdapter(factory, usdc, address(thief), wallet, modes[i]);
            _activate(address(bad));

            vm.prank(EXECUTOR);
            if (expected[i] == bytes4(0)) vm.expectRevert();
            else vm.expectRevert(expected[i]);
            factory.renew(LABEL);

            assertEq(usdc.balanceOf(wallet), 27_110_000, "wallet funds moved");
            assertEq(usdc.balanceOf(EXECUTOR), 0, "executor was paid");
            assertEq(usdc.balanceOf(address(thief)), 0, "the target kept funds");
            assertEq(usdc.allowance(wallet, address(thief)), 0, "an allowance survived");
        }

        budget; // documented above
    }

    /// @dev A plan that re-enters the factory is refused and rolled back.
    function test_rejectsReentrantPlanAndRollsBack() public {
        _fund(27_110_000);
        Reentrant target = new Reentrant(factory);
        AdversarialAdapter bad = new AdversarialAdapter(factory, usdc, address(target), wallet, 7);
        _activate(address(bad));

        vm.prank(EXECUTOR);
        vm.expectRevert(NamepassFactory.Reentrancy.selector);
        factory.renew(LABEL);

        assertEq(usdc.balanceOf(wallet), 27_110_000);
        assertEq(usdc.allowance(wallet, address(target)), 0);
    }

    /// @dev A plan may name a spender other than the target; the approval goes to the spender.
    function test_spenderMayDifferFromTarget() public {
        _fund(27_110_000);
        Spender spender = new Spender(usdc, address(0xB4));
        Router router = new Router(spender);
        SplitAdapter split = new SplitAdapter(factory, usdc, address(router), address(spender));
        _activate(address(split));

        _renewAs(EXECUTOR);

        uint256 price = (27_110_000 - factory.GAS_ALLOWANCE()) / 2;
        assertEq(usdc.balanceOf(address(0xB4)), price, "the spender did not pull the price");
        assertEq(usdc.balanceOf(EXECUTOR), 27_110_000 - price);
        assertEq(usdc.balanceOf(wallet), 0);
        assertEq(usdc.allowance(wallet, address(spender)), 0, "an allowance to the spender survived");
        assertEq(usdc.allowance(wallet, address(router)), 0, "the target was approved");
    }

    function test_referrerIsPassedThrough() public {
        _fund(27_110_000);
        _renewAs(EXECUTOR);

        assertEq(ethRegistrar.lastReferrer(), adapter.referrer(), "referrer was not forwarded");
    }

    /// @dev The plan is exactly the quote plus ENS's own `renew` calldata.
    function test_planMatchesQuoteAndEncodesRenewCall() public view {
        uint256 budget = 27_010_000;
        (uint64 quotedDuration, uint256 quotedPrice) = adapter.quote(LABEL, budget);
        (address renewer, address spender, uint64 duration, uint256 price, bytes memory data) = adapter.plan(LABEL, budget);

        assertEq(renewer, address(ethRegistrar));
        assertEq(spender, address(ethRegistrar));
        assertEq(duration, quotedDuration);
        assertEq(price, quotedPrice);
        assertEq(
            data,
            abi.encodeCall(IETHRenewer.renew, (IETHRenewer.RenewData(LABEL, duration, REFERRER), IERC20(address(usdc))))
        );
    }

    /*//////////////////////////////////////////////////////////////
                          RENEWER SELECTION
    //////////////////////////////////////////////////////////////*/

    function test_selectsEthRegistrarForMigratedNames() public {
        _fund(27_110_000);
        _renewAs(EXECUTOR);

        assertGt(ethRegistrar.lastDuration(), 0, "ETHRegistrar was not used");
        assertEq(ethRenewerV1.lastDuration(), 0, "ETHRenewerV1 should not have been touched");
    }

    function test_selectsRenewerV1ForPremigratedNames() public {
        ethRegistrar.setRenewable(false);
        ethRenewerV1.setRenewable(true);

        _fund(27_110_000);
        _renewAs(EXECUTOR);

        assertGt(ethRenewerV1.lastDuration(), 0, "ETHRenewerV1 was not used");
        assertEq(ethRegistrar.lastDuration(), 0, "ETHRegistrar should not have been touched");
    }

    /// @dev Migration mid-flight needs no Namepass action; selection is per renewal.
    function test_selectionFollowsMigrationWithoutIntervention() public {
        ethRegistrar.setRenewable(false);
        ethRenewerV1.setRenewable(true);

        _fund(27_110_000);
        _renewAs(EXECUTOR);
        assertGt(ethRenewerV1.lastDuration(), 0, "pre-migration renewal used the wrong path");

        ethRenewerV1.setRenewable(false);
        ethRegistrar.setRenewable(true);

        _fund(27_110_000);
        _renewAs(EXECUTOR);
        assertGt(ethRegistrar.lastDuration(), 0, "post-migration renewal used the wrong path");
    }

    /// @dev A retired `ETHRenewerV1` (address zero) must not be called.
    function test_toleratesRetiredRenewerV1() public {
        adapter = new ENSV2RenewalAdapter(address(factory), address(usdc), address(ethRegistrar), address(0), REFERRER);
        _activate(address(adapter));

        _fund(27_110_000);
        _renewAs(EXECUTOR);

        assertGt(ethRegistrar.lastDuration(), 0, "renewal failed with V1 retired");
    }

    /*//////////////////////////////////////////////////////////////
                         WALLET AND EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @dev Only the factory may enter a wallet; the wallet keeps no state and the same code.
    function test_walletRejectsDirectExecutionAndIsReused() public {
        _fund(27_110_000);
        _renewAs(EXECUTOR);
        bytes32 codeHash = wallet.codehash;

        _fund(27_110_000);
        vm.prank(address(0xBAD));
        vm.expectRevert(NamepassFactory.WrongExecutionContext.selector);
        INamepassWallet(wallet).executeHub(LABEL, 27_110_000, address(0xBAD), address(usdc), address(adapter));

        _renewAs(EXECUTOR);
        assertEq(wallet.codehash, codeHash);
        assertEq(factory.predictWallet(LABEL), wallet);
    }

    /// @dev `HelperUsed`, then `Renewed`, then `DepositProcessed`, all from the factory, with exact figures.
    function test_eventOrderAndFigures() public {
        uint256 sent = 27_110_000;
        _fund(sent);

        vm.recordLogs();
        _renewAs(EXECUTOR);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 n;
        bytes32[3] memory order;
        Vm.Log memory renewed;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(factory)) continue;
            bytes32 sig = logs[i].topics[0];
            if (sig != HELPER_USED && sig != RENEWED && sig != PROCESSED) continue;
            order[n++] = sig;
            if (sig == RENEWED) renewed = logs[i];
        }
        assertEq(n, 3, "expected three settlement events from the factory");
        assertEq(order[0], HELPER_USED);
        assertEq(order[1], RENEWED);
        assertEq(order[2], PROCESSED);

        assertEq(renewed.topics[1], keccak256(bytes(LABEL)));
        assertEq(renewed.topics[2], bytes32(uint256(uint160(wallet))));
        assertEq(renewed.topics[3], bytes32(uint256(uint160(EXECUTOR))));
        _assertRenewedData(renewed.data, sent, usdc.balanceOf(ethRegistrar.beneficiary()));
    }

    function _assertRenewedData(bytes memory data, uint256 sent, uint256 charged) private view {
        (
            string memory label,
            uint64 duration,
            uint256 amountReceived,
            uint256 gasAllowance,
            uint256 amountApplied,
            uint256 remainder,
            bool fromCCTP
        ) = abi.decode(data, (string, uint64, uint256, uint256, uint256, uint256, bool));
        assertEq(label, LABEL);
        assertEq(duration, ethRegistrar.lastDuration());
        assertEq(amountReceived, sent);
        assertEq(gasAllowance, factory.GAS_ALLOWANCE());
        assertEq(amountApplied, charged);
        assertEq(remainder, sent - gasAllowance - charged);
        assertFalse(fromCCTP);
    }
}

/// @dev Receives an approval and pulls a chosen amount, standing in for a misbehaving renewer.
contract Thief {
    MockUSDC private immutable usdc;

    constructor(MockUSDC usdc_) {
        usdc = usdc_;
    }

    function take(uint256 amount) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "pull failed");
    }
}

/// @dev A target whose calldata re-enters the factory.
contract Reentrant {
    NamepassFactory private immutable factory;

    constructor(NamepassFactory factory_) {
        factory = factory_;
    }

    function run(string calldata label) external {
        factory.renew(label);
    }
}

/// @dev Governance can select arbitrary code. Each mode produces one bad plan.
contract AdversarialAdapter {
    uint256 public constant interfaceVersion = 2;
    address public immutable gateway;
    address public immutable factory;
    address public immutable paymentToken;
    address private immutable thief;
    address private immutable wallet;
    uint256 private immutable mode;

    constructor(NamepassFactory factory_, MockUSDC usdc_, address thief_, address wallet_, uint256 mode_) {
        gateway = address(factory_);
        factory = address(factory_);
        paymentToken = address(usdc_);
        thief = thief_;
        wallet = wallet_;
        mode = mode_;
    }

    function plan(string calldata label, uint256 budget)
        external
        view
        returns (address renewer, address spender, uint64 duration, uint256 price, bytes memory data)
    {
        uint256 half = budget / 2;
        if (mode == 0) return (thief, thief, 1, budget + 1, abi.encodeCall(Thief.take, (budget + 1)));
        if (mode == 1) return (thief, thief, 0, half, abi.encodeCall(Thief.take, (half)));
        if (mode == 2) return (paymentToken, paymentToken, 1, half, abi.encodeCall(MockUSDC.transfer, (thief, half)));
        if (mode == 3) return (factory, factory, 1, half, abi.encodeCall(NamepassFactory.renew, (label)));
        if (mode == 4) return (wallet, wallet, 1, half, "");
        if (mode == 5) return (thief, thief, 1, half, abi.encodeCall(Thief.take, (half - 1)));
        if (mode == 6) return (thief, thief, 1, half, abi.encodeCall(Thief.take, (half + 1)));
        if (mode == 7) return (thief, thief, 1, half, abi.encodeCall(Reentrant.run, (label)));
        if (mode == 8) return (thief, paymentToken, 1, half, abi.encodeCall(Thief.take, (half)));
        if (mode == 9) return (thief, wallet, 1, half, abi.encodeCall(Thief.take, (half)));
        return (thief, factory, 1, half, abi.encodeCall(Thief.take, (half)));
    }
}

/// @dev Pulls a payment on behalf of a caller, standing in for a separate ENS payment contract.
contract Spender {
    MockUSDC private immutable usdc;
    address private immutable beneficiary;

    constructor(MockUSDC usdc_, address beneficiary_) {
        usdc = usdc_;
        beneficiary = beneficiary_;
    }

    function pull(address from, uint256 amount) external {
        require(usdc.transferFrom(from, beneficiary, amount), "pull failed");
    }
}

/// @dev A renewer that routes payment through a separate spender.
contract Router {
    Spender private immutable spender;

    constructor(Spender spender_) {
        spender = spender_;
    }

    function renew(uint256 amount) external {
        spender.pull(msg.sender, amount);
    }
}

/// @dev A plan whose spender differs from its target.
contract SplitAdapter {
    uint256 public constant interfaceVersion = 2;
    address public immutable gateway;
    address public immutable factory;
    address public immutable paymentToken;
    address private immutable router;
    address private immutable spender;

    constructor(NamepassFactory factory_, MockUSDC usdc_, address router_, address spender_) {
        gateway = address(factory_);
        factory = address(factory_);
        paymentToken = address(usdc_);
        router = router_;
        spender = spender_;
    }

    function plan(string calldata, uint256 budget)
        external
        view
        returns (address, address, uint64, uint256, bytes memory)
    {
        return (router, spender, 1, budget / 2, abi.encodeCall(Router.renew, (budget / 2)));
    }
}
