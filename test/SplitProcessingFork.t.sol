// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NamepassFactory} from "../contracts/NamepassFactory.sol";

interface ISplitMessenger {
    function localMinter() external view returns (address);
}

interface ISplitMinter {
    function burnLimitsPerMessage(address token) external view returns (uint256);
}

/// Executes the deployed Base factory and Circle contracts on a fixed local fork.
/// Only the fork's wallet balance is seeded. No transactions are broadcast.
contract SplitProcessingForkTest is Test {
    address constant FACTORY = 0x2dCB5CA6b21372b43e37C35Da8D5D15160423150;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    uint256 constant FORK_BLOCK = 47_803_956;
    bytes32 constant PROCESSED = keccak256("DepositProcessed(bytes32,address,uint256,uint256)");

    function testFork_deployedFactorySplitsAtCircleLimitAndDrainsRemainder() public {
        string memory rpc = vm.envOr("NAMEPASS_BASE_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        vm.createSelectFork(rpc, FORK_BLOCK);
        vm.setEvmVersion("cancun");
        assertEq(block.chainid, 84532);
        NamepassFactory factory = NamepassFactory(payable(FACTORY));
        assertEq(factory.usdc(), USDC);
        address messenger = factory.tokenMessenger();
        uint256 limit = ISplitMinter(ISplitMessenger(messenger).localMinter()).burnLimitsPerMessage(USDC);
        assertEq(limit, 10_000_000 * 1e6);
        address wallet = factory.predictWallet("farcaster");
        assertEq(wallet, 0x16CfEB29157376F55e7976562a850d04435C171d);
        uint256 remainder = 500_000;
        deal(USDC, wallet, limit + remainder, true);
        uint256 supply = IERC20(USDC).totalSupply();

        vm.recordLogs();
        factory.renew("farcaster");
        _assertProcessing(vm.getRecordedLogs(), wallet, limit, remainder);
        assertEq(IERC20(USDC).balanceOf(wallet), remainder);
        assertEq(IERC20(USDC).totalSupply(), supply - limit);
        assertEq(IERC20(USDC).allowance(wallet, messenger), 0);
        bytes32 walletCode = wallet.codehash;

        vm.recordLogs();
        factory.renew("farcaster");
        _assertProcessing(vm.getRecordedLogs(), wallet, remainder, 0);
        assertEq(IERC20(USDC).balanceOf(wallet), 0);
        assertEq(IERC20(USDC).totalSupply(), supply - limit - remainder);
        assertEq(IERC20(USDC).allowance(wallet, messenger), 0);
        assertEq(factory.predictWallet("farcaster"), wallet);
        assertEq(wallet.codehash, walletCode);
        vm.expectRevert(NamepassFactory.NoUSDC.selector);
        factory.renew("farcaster");
    }

    function _assertProcessing(Vm.Log[] memory logs, address wallet, uint256 amount, uint256 remaining) private pure {
        uint256 matches;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != FACTORY || logs[i].topics[0] != PROCESSED) continue;
            ++matches;
            assertEq(logs[i].topics.length, 3);
            assertEq(logs[i].topics[1], keccak256("farcaster"));
            assertEq(logs[i].topics[2], bytes32(uint256(uint160(wallet))));
            (uint256 processed, uint256 retained) = abi.decode(logs[i].data, (uint256, uint256));
            assertEq(processed, amount);
            assertEq(retained, remaining);
        }
        assertEq(matches, 1);
    }
}
