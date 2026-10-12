// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {ENSV2RenewalAdapter} from "../contracts/ENSV2RenewalAdapter.sol";
import {IETHRenewer} from "../contracts/interfaces/IENSRenewal.sol";

interface ILiveRegistry {
    function findExpiry(string calldata label) external view returns (uint64);
}

interface ILiveBaseRegistrar {
    function nameExpires(uint256 id) external view returns (uint256);
}

/**
 * @notice Opt-in tests against real ENS code on a Sepolia fork. No
 * transactions are broadcast. Set `NAMEPASS_FORK_RPC`; set
 * `NAMEPASS_FORK_BLOCK` to pin a block the node still serves, otherwise
 * the latest block is used. The October ENS deployment is assumed.
 */
contract SepoliaForkTest is Test {
    address constant REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
    address constant V1 = 0xf2ece44980778966b8a0FccB3A9E339440f6e045;
    address constant V1_BASE_REGISTRAR = 0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    address constant MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    NamepassFactory internal factory;
    ENSV2RenewalAdapter internal adapter;
    bool internal enabled;

    function setUp() public {
        string memory rpc = vm.envOr("NAMEPASS_FORK_RPC", string(""));
        enabled = bytes(rpc).length != 0;
        if (!enabled) return;
        uint256 forkBlock = vm.envOr("NAMEPASS_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        // Execute deployed ENS Cancun opcodes without changing our pinned Shanghai compilation.
        vm.setEvmVersion("cancun");
        factory = new NamepassFactory(address(this), 11155111);
        address executor = address(new Governance());
        factory.initialize(USDC, MESSENGER, TRANSMITTER, executor);
        adapter = new ENSV2RenewalAdapter(address(factory), USDC, REGISTRAR, V1, bytes32(uint256(0x1208)));
        vm.prank(executor);
        factory.setHelper(address(adapter));
    }

    uint256 constant AMOUNT = 27_110_000;

    /// @dev Quote, plan and state reads agree with ENS before any funds move.
    function _checkQuote(string memory label, address renewer) private view returns (uint64 duration, uint256 charge) {
        assertEq(adapter.renewableBy(label), renewer);
        uint256 budget = AMOUNT - factory.GAS_ALLOWANCE();
        (duration, charge) = adapter.quote(label, budget);
        assertEq(IETHRenewer(renewer).getRenewPrice(label, duration, IERC20(USDC)), charge);
        (address plannedRenewer, uint64 plannedDuration, uint256 plannedPrice,) = adapter.plan(label, budget);
        assertEq(plannedRenewer, renewer);
        assertEq(plannedDuration, duration);
        assertEq(plannedPrice, charge);
        (uint64 reportedExpiry, address selected) = adapter.nameState(label);
        assertEq(reportedExpiry, _registry(renewer).findExpiry(label));
        assertEq(selected, renewer);
    }

    function _registry(address renewer) private view returns (ILiveRegistry) {
        return ILiveRegistry(address(IETHRenewer(renewer).ETH_REGISTRY()));
    }

    function _v1Expiry(string memory label) private view returns (uint256) {
        return ILiveBaseRegistrar(V1_BASE_REGISTRAR).nameExpires(uint256(keccak256(bytes(label))));
    }

    function _renewAndCheck(string memory label, address renewer) private {
        (uint64 duration, uint256 charge) = _checkQuote(label, renewer);
        uint64 expiryBefore = _registry(renewer).findExpiry(label);
        uint256 v1Before = _v1Expiry(label);
        address wallet = factory.predictWallet(label);
        deal(USDC, wallet, AMOUNT);
        uint256 executorBefore = IERC20(USDC).balanceOf(address(this));

        factory.renew(label);

        assertEq(_registry(renewer).findExpiry(label), expiryBefore + duration);
        if (renewer == V1) assertEq(_v1Expiry(label), v1Before + duration);
        assertEq(IERC20(USDC).balanceOf(wallet), 0);
        assertEq(IERC20(USDC).balanceOf(address(this)), executorBefore + AMOUNT - charge);
        assertGe(AMOUNT - charge, factory.GAS_ALLOWANCE());
        assertEq(IERC20(USDC).balanceOf(address(adapter)), 0);
        assertEq(IERC20(USDC).balanceOf(address(factory)), 0);
        assertEq(IERC20(USDC).allowance(wallet, renewer), 0);
    }

    /// @dev The live premigrated reservation renews through the V1 renewer, with the V1 registration extended.
    function testFork_premigratedV1Renewal() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        _renewAndCheck("vitalik", V1);
    }

    /// @dev A second renewal reuses the deployed wallet and settles identically.
    function testFork_secondRenewalReusesWallet() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        _renewAndCheck("vitalik", V1);
        address wallet = factory.predictWallet("vitalik");
        bytes32 codeHash = wallet.codehash;
        _renewAndCheck("vitalik", V1);
        assertEq(wallet.codehash, codeHash);
    }
}

/// @dev A governance executor with code, for the fork's activation.
contract Governance {}
