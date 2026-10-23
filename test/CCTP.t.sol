// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {ENSV2RenewalAdapter} from "../contracts/ENSV2RenewalAdapter.sol";

import {HubSetup} from "./HubSetup.sol";
import {MockRenewer, Dummy} from "./mocks/Mocks.sol";

/**
 * @notice CCTP v2 message parsing, the route checks around it, and the
 * claim settling from the factory's own balance.
 *
 * The offsets are the part of the factory that cannot be reasoned
 * about from the outside — a wrong one reads a plausible-looking value
 * from the wrong field and the failure is silent. `_encode` below builds
 * messages to the published layout so the constants are exercised
 * against a real encoding rather than against themselves.
 */
contract CCTPTest is HubSetup {
    bytes32 constant CLAIMED = keccak256("CCTPClaimed(bytes32,address,uint32,uint256,uint256,uint256)");
    bytes32 constant HELPER_USED = keccak256("HelperUsed(address,bytes32,address)");
    bytes32 constant RENEWED = keccak256("Renewed(bytes32,address,address,string,uint64,uint256,uint256,uint256,uint256,bool)");

    /*//////////////////////////////////////////////////////////////
                          MESSAGE ENCODING
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Builds a CCTP v2 message to the published layout.
     *
     * MessageV2 header: version(4) sourceDomain(4) destinationDomain(4)
     * nonce(32) sender(32) recipient(32) destinationCaller(32)
     * minFinality(4) finalityExecuted(4) = 148 bytes.
     *
     * BurnMessageV2 body: version(4) burnToken(32) mintRecipient(32)
     * amount(32) messageSender(32) maxFee(32) feeExecuted(32)
     * expirationBlock(32) then hookData.
     */
    function _encode(
        uint32 sourceDomain,
        bytes32 nonce,
        address recipient,
        address destinationCaller,
        address mintRecipient,
        uint256 amount,
        address messageSender,
        uint256 feeExecuted,
        bytes memory hookData
    ) internal pure returns (bytes memory) {
        bytes memory header = abi.encodePacked(
            uint32(1),
            sourceDomain,
            uint32(0),
            nonce,
            bytes32(0),
            bytes32(uint256(uint160(recipient))),
            bytes32(uint256(uint160(destinationCaller))),
            uint32(2000),
            uint32(2000)
        );

        bytes memory body = abi.encodePacked(
            uint32(1),
            bytes32(uint256(uint160(address(0)))),
            bytes32(uint256(uint160(mintRecipient))),
            amount,
            bytes32(uint256(uint160(messageSender))),
            uint256(0),
            feeExecuted,
            uint256(0),
            hookData
        );

        return abi.encodePacked(header, body);
    }

    function _validMessage(uint256 amount, uint256 fee) internal view returns (bytes memory) {
        return _encode(
            6, bytes32(uint256(0xC0FFEE)), TOKEN_MESSENGER, address(factory), address(factory), amount, wallet, fee, bytes(LABEL)
        );
    }

    function _claimAs(address executor, bytes memory message) internal {
        vm.prank(executor);
        factory.completeCCTP(message, hex"1234");
    }

    /*//////////////////////////////////////////////////////////////
                            HAPPY PATH
    //////////////////////////////////////////////////////////////*/

    function test_claimsAndRenews() public {
        _claimAs(EXECUTOR, _validMessage(27_110_000, 0));

        uint256 charged = usdc.balanceOf(ethRegistrar.beneficiary());
        assertGt(ethRegistrar.lastDuration(), 0, "no renewal happened");
        assertEq(usdc.balanceOf(EXECUTOR), 27_110_000 - charged, "executor was not paid the remainder");
        assertGe(usdc.balanceOf(EXECUTOR), factory.GAS_ALLOWANCE(), "executor unpaid");
        assertEq(ethRegistrar.lastPayer(), address(factory), "ENS was not paid by the factory");
        assertEq(usdc.balanceOf(address(factory)), 0, "the factory kept funds");
        assertEq(usdc.allowance(address(factory), address(ethRegistrar)), 0, "a standing allowance survived");
    }

    /// @dev Whoever submits the claim is paid, not the source wallet.
    function test_submitterIsPaidNotTheWallet() public {
        _claimAs(EXECUTOR, _validMessage(27_110_000, 0));

        assertEq(usdc.balanceOf(wallet), 0, "the deposit wallet was paid its own money back");
    }

    /// @dev Only `burn.amount - burn.feeExecuted` may be spent.
    function test_feeIsSubtractedFromTheSpendableAmount() public {
        uint256 fee = 1_000_000;
        _claimAs(EXECUTOR, _validMessage(27_110_000 + fee, fee));

        (uint64 expected,) = factory.quote(LABEL, 27_110_000 - factory.GAS_ALLOWANCE());
        assertEq(ethRegistrar.lastDuration(), expected, "the CCTP fee was not deducted");
    }

    /// @dev `CCTPClaimed` before ENS executes, then `HelperUsed`, then `Renewed` with the CCTP flag.
    function test_eventOrder() public {
        vm.recordLogs();
        _claimAs(EXECUTOR, _validMessage(27_110_000, 0));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 n;
        bytes32[3] memory order;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(factory)) continue;
            bytes32 sig = logs[i].topics[0];
            if (sig != CLAIMED && sig != HELPER_USED && sig != RENEWED) continue;
            order[n++] = sig;
            if (sig == RENEWED) {
                (,,,,,, bool fromCCTP) =
                    abi.decode(logs[i].data, (string, uint64, uint256, uint256, uint256, uint256, bool));
                assertTrue(fromCCTP);
            }
        }
        assertEq(n, 3);
        assertEq(order[0], CLAIMED);
        assertEq(order[1], HELPER_USED);
        assertEq(order[2], RENEWED);
    }

    /*//////////////////////////////////////////////////////////////
                            ROUTE CHECKS
    //////////////////////////////////////////////////////////////*/

    function test_rejectsMessageNotAddressedToTokenMessenger() public {
        bytes memory m = _encode(
            6, bytes32(0), address(0xBAD), address(factory), address(factory), 27_110_000, wallet, 0, bytes(LABEL)
        );

        vm.expectRevert(NamepassFactory.InvalidCCTPMessage.selector);
        factory.completeCCTP(m, hex"1234");
    }

    function test_rejectsForeignDestinationCaller() public {
        bytes memory m = _encode(
            6, bytes32(0), TOKEN_MESSENGER, address(0xBAD), address(factory), 27_110_000, wallet, 0, bytes(LABEL)
        );

        vm.expectRevert(NamepassFactory.InvalidCCTPMessage.selector);
        factory.completeCCTP(m, hex"1234");
    }

    function test_rejectsForeignMintRecipient() public {
        bytes memory m = _encode(
            6, bytes32(0), TOKEN_MESSENGER, address(factory), address(0xBAD), 27_110_000, wallet, 0, bytes(LABEL)
        );

        vm.expectRevert(NamepassFactory.InvalidCCTPMessage.selector);
        factory.completeCCTP(m, hex"1234");
    }

    function test_rejectsTruncatedMessage() public {
        vm.expectRevert(NamepassFactory.InvalidCCTPMessage.selector);
        factory.completeCCTP(new bytes(375), hex"1234");
    }

    function test_rejectsFeeExceedingBurnAmount() public {
        bytes memory m = _validMessage(1_000_000, 2_000_000);

        vm.expectRevert(NamepassFactory.InvalidCCTPMessage.selector);
        factory.completeCCTP(m, hex"1234");
    }

    function test_rejectsWrongVersionsAndDomain() public {
        bytes memory message = _validMessage(27_110_000, 0);
        message[3] = 0x02;
        vm.expectRevert(NamepassFactory.InvalidCCTPMessage.selector);
        factory.completeCCTP(message, hex"1234");
        message[3] = 0x01;
        message[151] = 0x02;
        vm.expectRevert(NamepassFactory.InvalidCCTPMessage.selector);
        factory.completeCCTP(message, hex"1234");
        message[151] = 0x01;
        message[11] = 0x06;
        vm.expectRevert(NamepassFactory.InvalidCCTPMessage.selector);
        factory.completeCCTP(message, hex"1234");
    }

    /*//////////////////////////////////////////////////////////////
                        LABEL / WALLET BINDING
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev The label in the hook is bound to the wallet that burned.
     * This is what makes `completeCCTP` safe to leave permissionless.
     */
    function test_rejectsHookLabelThatDoesNotMatchTheBurner() public {
        bytes memory m = _encode(
            6, bytes32(0), TOKEN_MESSENGER, address(factory), address(factory), 27_110_000, address(0xBAD), 0, bytes(LABEL)
        );

        vm.expectRevert(NamepassFactory.InvalidWallet.selector);
        factory.completeCCTP(m, hex"1234");
    }

    function test_rejectsSubstitutedLabel() public {
        bytes memory m = _encode(
            6, bytes32(0), TOKEN_MESSENGER, address(factory), address(factory), 27_110_000, wallet, 0, bytes("someoneelse")
        );

        vm.expectRevert(NamepassFactory.InvalidWallet.selector);
        factory.completeCCTP(m, hex"1234");
    }

    function test_rejectsNonCanonicalSenderAndEmptyLabel() public {
        bytes memory message = _validMessage(27_110_000, 0);
        message[248] = 0x01;
        vm.expectRevert(NamepassFactory.InvalidCCTPMessage.selector);
        factory.completeCCTP(message, hex"1234");
        message = _encode(6, bytes32(0), TOKEN_MESSENGER, address(factory), address(factory), 27_110_000, wallet, 0, bytes(""));
        vm.expectRevert(NamepassFactory.EmptyLabel.selector);
        factory.completeCCTP(message, hex"1234");
    }

    /*//////////////////////////////////////////////////////////////
                          THE MINT ASSERTION
    //////////////////////////////////////////////////////////////*/

    /// @dev A mint that disagrees with the authenticated burn is refused.
    function test_rejectsMintSmallerThanTheAuthenticatedAmount() public {
        transmitter.setMint(address(factory), 1_000_000);

        vm.expectRevert(NamepassFactory.UnexpectedMintAmount.selector);
        factory.completeCCTP(_validMessage(27_110_000, 0), hex"1234");
    }

    /**
     * @dev Anyone can send USDC to the factory. A claim spends only the
     * minted amount, and the factory's balance is unchanged afterwards.
     */
    function test_existingBalanceIsNotCountedIntoTheFlow() public {
        usdc.mint(address(factory), 5_000_000);

        _claimAs(EXECUTOR, _validMessage(27_110_000, 0));

        (uint64 expected,) = factory.quote(LABEL, 27_110_000 - factory.GAS_ALLOWANCE());
        assertEq(ethRegistrar.lastDuration(), expected, "pre-existing balance leaked into the flow");
        assertEq(usdc.balanceOf(address(factory)), 5_000_000, "the factory's pre-claim balance changed");
        uint256 charged = usdc.balanceOf(ethRegistrar.beneficiary());
        assertEq(usdc.balanceOf(EXECUTOR), 27_110_000 - charged, "the executor was paid from the wrong balance");
    }

    function test_revertsWhenReceiveMessageFails() public {
        transmitter.setSucceed(false);

        vm.expectRevert(NamepassFactory.CCTPReceiveFailed.selector);
        factory.completeCCTP(_validMessage(27_110_000, 0), hex"1234");
    }

    /*//////////////////////////////////////////////////////////////
                        REPLACEMENT AND RETRY
    //////////////////////////////////////////////////////////////*/

    /// @dev A burn addressed to the factory settles through whichever adapter is active when claimed.
    function test_messageUsesReplacementAdapterAndCannotReplay() public {
        address[] memory actors = new address[](1);
        actors[0] = address(this);
        TimelockController timelock = new TimelockController(1 days, actors, actors, address(0));
        vm.prank(GOVERNANCE);
        factory.transferGovernance(address(timelock));
        bytes memory accept = abi.encodeCall(factory.acceptGovernance, ());
        timelock.schedule(address(factory), 0, accept, bytes32(0), bytes32(0), 1 days);
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(factory), 0, accept, bytes32(0), bytes32(0));

        bytes memory message = _validMessage(27_110_000, 0);
        MockRenewer nextRenewer = new MockRenewer(ethRegistrar.rentPriceOracle(), address(0xB3));
        ENSV2RenewalAdapter next =
            new ENSV2RenewalAdapter(address(factory), address(usdc), address(nextRenewer), address(0), REFERRER);
        bytes memory update = abi.encodeCall(factory.setHelper, (address(next)));
        timelock.schedule(address(factory), 0, update, bytes32(0), bytes32(0), 1 days);
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(factory), 0, update, bytes32(0), bytes32(0));

        _claimAs(EXECUTOR, message);
        assertEq(ethRegistrar.lastDuration(), 0);
        assertGt(nextRenewer.lastDuration(), 0);
        assertEq(usdc.allowance(address(factory), address(nextRenewer)), 0);

        vm.expectRevert(bytes("nonce used"));
        factory.completeCCTP(message, hex"1234");
    }

    function test_failedClaimRollsBackMintAndNonceThenRetriesSameMessage() public {
        bytes memory message = _validMessage(27_110_000, 0);
        ethRegistrar.setRenewable(false);
        vm.expectRevert(ENSV2RenewalAdapter.NameNotRenewable.selector);
        factory.completeCCTP(message, hex"1234");
        assertFalse(transmitter.usedNonces(bytes32(uint256(0xC0FFEE))));
        assertEq(usdc.balanceOf(address(factory)), 0);
        assertEq(usdc.allowance(address(factory), address(ethRegistrar)), 0);

        ethRegistrar.setRenewable(true);
        factory.completeCCTP(message, hex"1234");
        assertTrue(transmitter.usedNonces(bytes32(uint256(0xC0FFEE))));
    }

    /// @dev An L2 factory has no transmitter and refuses claims outright.
    function test_l2FactoryRejectsClaims() public {
        vm.chainId(84532);
        NamepassFactory l2 = new NamepassFactory(address(this), 11155111);
        l2.initialize(address(usdc), address(new Dummy()), address(0), address(0));

        vm.expectRevert(NamepassFactory.NotHub.selector);
        l2.completeCCTP(_validMessage(27_110_000, 0), hex"1234");
    }
}
