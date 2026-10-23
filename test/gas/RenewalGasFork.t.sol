// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NamepassFactory} from "../../contracts/NamepassFactory.sol";
import {ENSV2RenewalAdapter} from "../../contracts/ENSV2RenewalAdapter.sol";

/// @notice Opt-in gas measurement of the two-contract direct path against live Sepolia ENS.
/// @dev Set NAMEPASS_FORK_RPC and optionally NAMEPASS_FORK_BLOCK. Prints warm-state execution gas
/// inside one test; see test/gas/README.md for receipt-level figures and what a real transaction adds.
contract RenewalGasForkTest is Test {
    address constant REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
    address constant V1 = 0xf2ece44980778966b8a0FccB3A9E339440f6e045;
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
        vm.setEvmVersion("cancun");
        factory = new NamepassFactory(address(this), 11155111);
        address executor = address(new GasGovernance());
        factory.initialize(USDC, MESSENGER, TRANSMITTER, executor);
        adapter = new ENSV2RenewalAdapter(address(factory), USDC, REGISTRAR, V1, bytes32(uint256(0x1208)));
        vm.prank(executor);
        factory.setHelper(address(adapter));
    }

    function _renew(string memory label, string memory tag) internal {
        address wallet = factory.predictWallet(label);
        deal(USDC, wallet, 27_110_000);
        uint256 before = gasleft();
        factory.renew(label);
        console2.log(tag, before - gasleft());
    }

    function testForkGas_directPathV1() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        assertEq(adapter.renewableBy("vitalik"), V1);
        _renew("vitalik", "merged#1 first use: wallet deploy, executor slot cold");
        _renew("vitalik", "merged#2 steady state");
        _renew("vitalik", "merged#3 steady state");
    }

    function testForkGas_directPathV2() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        assertEq(adapter.renewableBy("skellat"), REGISTRAR);
        _renew("skellat", "merged V2 #1 first use: wallet deploy, executor slot cold");
        _renew("skellat", "merged V2 #2 steady state");
        _renew("skellat", "merged V2 #3 steady state");
    }
}

contract GasGovernance {}
