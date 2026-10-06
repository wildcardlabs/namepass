// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ENSV2RenewalHelper} from "../contracts/ENSV2RenewalHelper.sol";
import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {RenewalHelperPointer} from "../contracts/RenewalHelperPointer.sol";

interface IRotationBaseRegistrar {
    function controllers(address) external view returns (bool);
    function nameExpires(uint256) external view returns (uint256);
}

interface IRotationTimelock {
    function getMinDelay() external view returns (uint256);
    function hashOperation(address, uint256, bytes calldata, bytes32, bytes32) external pure returns (bytes32);
    function schedule(address, uint256, bytes calldata, bytes32, bytes32, uint256) external;
    function execute(address, uint256, bytes calldata, bytes32, bytes32) external payable;
}

/// A read-only fork of the user's funded canary, including the real timelock rotation.
contract HelperRotationForkTest is Test {
    address constant factory = 0x2dCB5CA6b21372b43e37C35Da8D5D15160423150;
    address constant gateway = 0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f;
    address constant usdc = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant registrar = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
    address constant v1 = 0xf2ece44980778966b8a0FccB3A9E339440f6e045;
    address constant owner = 0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6;
    address constant executor = 0xd3f6f8F45F1cc6DcA75B918311302E852d268d9C;

    function testFork_octoberEnsRotationPreservesFundedWalletAndRenews() public {
        string memory rpc = vm.envOr("NAMEPASS_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        vm.createSelectFork(rpc, 11_857_705);
        vm.setEvmVersion("cancun");
        RenewalHelperPointer pointer = RenewalHelperPointer(0x774f942194d612e126A05Ce40a3A4D88AfBB6ae6);
        IRotationTimelock timelock = IRotationTimelock(pointer.ensGovernanceExecutor());
        IRotationBaseRegistrar base = IRotationBaseRegistrar(0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85);
        assertFalse(base.controllers(0xd06e726e9bD8ac0f33A2a45F4Cc28fe10d656a36));
        assertTrue(base.controllers(v1));
        address wallet = NamepassFactory(payable(factory)).predictWallet("farcaster");
        assertEq(wallet, 0x16CfEB29157376F55e7976562a850d04435C171d);
        assertEq(IERC20(usdc).balanceOf(wallet), 500_000);
        vm.prank(executor);
        (bool oldWorks,) = factory.call(abi.encodeCall(NamepassFactory.renew, ("farcaster")));
        assertFalse(oldWorks);
        ENSV2RenewalHelper helper = new ENSV2RenewalHelper(gateway, factory, usdc, registrar, v1, bytes32(uint256(uint160(owner))));
        (uint64 duration, uint256 charge) = helper.quote("farcaster", 400_000);
        assertGt(duration, 0);
        assertLe(charge, 400_000);
        bytes memory data = abi.encodeCall(RenewalHelperPointer.setHelper, (address(helper)));
        bytes32 salt = keccak256("namepass-october-rotation-fork");
        uint256 delay = timelock.getMinDelay();
        vm.prank(owner);
        timelock.schedule(address(pointer), 0, data, bytes32(0), salt, delay);
        vm.warp(block.timestamp + delay + 1);
        vm.prank(owner);
        timelock.execute(address(pointer), 0, data, bytes32(0), salt);
        assertEq(pointer.currentHelper(), address(helper));
        uint256 expiry = base.nameExpires(uint256(keccak256("farcaster")));
        uint256 executorBefore = IERC20(usdc).balanceOf(executor);
        vm.prank(executor);
        NamepassFactory(payable(factory)).renew("farcaster");
        assertEq(base.nameExpires(uint256(keccak256("farcaster"))), expiry + duration);
        assertEq(IERC20(usdc).balanceOf(wallet), 0);
        assertEq(IERC20(usdc).balanceOf(executor), executorBefore + 100_000);
        assertEq(IERC20(usdc).allowance(gateway, address(helper)), 0);
        assertEq(IERC20(usdc).allowance(address(helper), v1), 0);
    }
}
