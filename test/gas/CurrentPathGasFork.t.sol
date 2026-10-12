// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NamepassFactory} from "../../contracts/NamepassFactory.sol";
import {NamepassL1Gateway} from "../../contracts/NamepassL1Gateway.sol";
import {RenewalHelperPointer} from "../../contracts/RenewalHelperPointer.sol";
import {ENSV2RenewalHelper} from "../../contracts/ENSV2RenewalHelper.sol";
import {Dummy} from "../mocks/Mocks.sol";

/// @notice Opt-in gas measurement of the current five-contract direct path against live Sepolia ENS.
/// @dev Set NAMEPASS_FORK_RPC and optionally NAMEPASS_FORK_BLOCK. Prints warm-state execution gas
/// inside one test; see docs/GAS_REDESIGN_PROPOSAL.md for what a real transaction adds.
contract CurrentPathGasForkTest is Test {
    address constant REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
    address constant V1 = 0xf2ece44980778966b8a0FccB3A9E339440f6e045;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    address constant MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    NamepassFactory internal factory;
    ENSV2RenewalHelper internal helper;
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
        address executor = address(new Dummy());
        RenewalHelperPointer pointer = new RenewalHelperPointer(address(factory), USDC, executor);
        NamepassL1Gateway gateway =
            new NamepassL1Gateway(address(factory), USDC, TRANSMITTER, MESSENGER, address(pointer), address(0xD57));
        helper = new ENSV2RenewalHelper(address(gateway), address(factory), USDC, REGISTRAR, V1, bytes32(uint256(0x1208)));
        vm.prank(executor);
        pointer.setHelper(address(helper));
        factory.initialize(USDC, address(0), address(gateway));
    }

    function _renew(string memory label, string memory tag) internal {
        address wallet = factory.predictWallet(label);
        deal(USDC, wallet, 27_110_000);
        uint256 before = gasleft();
        factory.renew(label);
        console2.log(tag, before - gasleft());
    }

    function testForkGas_currentPathV1() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        assertEq(helper.renewableBy("vitalik"), V1);
        _renew("vitalik", "current#1 first use: wallet deploy, executor and residue slots cold");
        _renew("vitalik", "current#2 steady state");
        _renew("vitalik", "current#3 steady state");
    }
}
