import assert from "node:assert/strict";
import test from "node:test";
import { encodeEventTopics, encodeFunctionData, type Address, type Transaction, type TransactionReceipt } from "viem";
import { canaryAmount, checkedTransfer, tokenAbi } from "./receipt";

const sender = "0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6" as Address;
const token = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const destination = "0xbb23c9991e390722533b41137A8A91Ae055383Df" as Address;
const hash = `0x${"ab".repeat(32)}` as const;
const transfer = (to = destination, amount = canaryAmount) => encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [to, amount] });
const transaction = { hash, from: sender, to: token, value: 0n, input: transfer() } as Transaction;
const log = { address: token, topics: encodeEventTopics({ abi: tokenAbi, eventName: "Transfer", args: { from: sender, to: destination } }), data: `0x${canaryAmount.toString(16).padStart(64, "0")}`, logIndex: 41 };
const receipt = { transactionHash: hash, status: "success", logs: [log] } as TransactionReceipt;

test("the actual receipt guard returns the one exact signed credit", () => {
  assert.equal(checkedTransfer(transaction, receipt, sender, token, destination), 41);
});
test("another transaction, reverted transfer or ambiguous credit cannot confirm this payment", () => {
  for (const patch of [{ from: destination }, { to: destination }, { value: 1n }, { input: transfer(sender) }, { input: transfer(destination, 1000000n) }, { hash: `0x${"cd".repeat(32)}` }]) {
    assert.throws(() => checkedTransfer({ ...transaction, ...patch } as Transaction, receipt, sender, token, destination));
  }
  for (const patch of [{ status: "reverted" }, { logs: [] }, { logs: [{ ...log, address: destination }] }, { logs: [{ ...log, logIndex: null }] }, { logs: [log, { ...log, logIndex: 42 }] }]) {
    assert.throws(() => checkedTransfer(transaction, { ...receipt, ...patch } as TransactionReceipt, sender, token, destination));
  }
});
