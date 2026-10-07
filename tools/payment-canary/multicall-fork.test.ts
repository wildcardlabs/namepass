import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { HUB_CHAIN } from "../../src/lib/chains";
import { depositAddress } from "../../src/lib/namepass";
import { batchCreditPositions, batchData, multicallAbi, multicallAddress, multicallCodeHash } from "./batch";

// Explicit local Anvil fork only. Never impersonate an account on a hosted RPC.
test("a normal Sepolia transaction spends exactly 1 USDC as two credits and rolls back both if either call fails", { skip: !process.env.NAMEPASS_CANARY_FORK_URL }, async () => {
  const url = new URL(process.env.NAMEPASS_CANARY_FORK_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const client = createPublicClient({ chain: sepolia, transport: http(url.href, { retryCount: 0 }) });
  const rpc = (method: string, params: unknown[] = []) => (client as unknown as { request(arg: { method: string; params: unknown[] }): Promise<unknown> }).request({ method, params });
  assert.match(String(await rpc("web3_clientVersion")), /anvil/i);
  assert.equal(await client.getChainId(), sepolia.id);
  const snapshot = await rpc("evm_snapshot");
  const sender = "0x1111111111111111111111111111111111111111" as Address;
  const funder = "0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6" as Address;
  const token = HUB_CHAIN.usdcAddress as Address;
  const destination = depositAddress("farcaster") as Address;
  const abi = parseAbi(["function transfer(address,uint256) returns(bool)", "function approve(address,uint256) returns(bool)",
    "function allowance(address,address) view returns(uint256)", "function balanceOf(address) view returns(uint256)",
    "function transferFrom(address,address,uint256) returns(bool)"]);
  const wallet = createWalletClient({ chain: sepolia, transport: http(url.href) });
  async function send(from: Address, to: Address, data: Hex) {
    const hash = await wallet.sendTransaction({ account: from, to, data, gas: 300000n });
    return client.waitForTransactionReceipt({ hash });
  }
  try {
    assert.equal(keccak256((await client.getCode({ address: multicallAddress }))!), multicallCodeHash);
    for (const address of [sender, funder]) {
      await rpc("anvil_impersonateAccount", [address]);
      await rpc("anvil_setBalance", [address, "0xde0b6b3a7640000"]);
    }
    assert.equal((await send(funder, token, encodeFunctionData({ abi, functionName: "transfer", args: [sender, 2000000n] }))).status, "success");
    assert.equal((await send(sender, token, encodeFunctionData({ abi, functionName: "approve", args: [multicallAddress, 1000000n] }))).status, "success");
    const before = await client.readContract({ address: token, abi, functionName: "balanceOf", args: [destination] });
    const badData = encodeFunctionData({ abi: multicallAbi, functionName: "aggregate3", args: [[500000n, 1000000n].map(value => ({
      target: token, allowFailure: false, callData: encodeFunctionData({ abi, functionName: "transferFrom", args: [sender, destination, value] }),
    }))] });
    const reverted = await send(sender, multicallAddress, badData);
    assert.equal(reverted.status, "reverted");
    assert.equal(await client.readContract({ address: token, abi, functionName: "balanceOf", args: [destination] }), before);
    assert.equal(await client.readContract({ address: token, abi, functionName: "allowance", args: [sender, multicallAddress] }), 1000000n);
    const receipt = await send(sender, multicallAddress, batchData(token, sender, destination));
    assert.equal(receipt.status, "success");
    assert.equal(batchCreditPositions(receipt, token, sender, destination).length, 2);
    assert.equal(await client.readContract({ address: token, abi, functionName: "balanceOf", args: [destination] }), before + 1000000n);
    assert.equal(await client.readContract({ address: token, abi, functionName: "allowance", args: [sender, multicallAddress] }), 0n);
    console.log(JSON.stringify({ forkOnly: true, chainId: sepolia.id, blockNumber: receipt.blockNumber.toString(), credits: 2, allowance: "0", failedSecondCallRevertsBoth: true }));
  } finally { assert.equal(await rpc("evm_revert", [snapshot]), true); }
});
