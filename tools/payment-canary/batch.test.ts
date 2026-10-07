import assert from "node:assert/strict";
import test from "node:test";
import { type Address, type TransactionReceipt } from "viem";
import { batchCreditPositions } from "./batch";

test("the canary accepts two exact credits in one transaction and rejects receipt shortcuts", () => {
  const sender = "0x1111111111111111111111111111111111111111" as Address;
  const destination = "0x2222222222222222222222222222222222222222" as Address;
  const token = "0x3333333333333333333333333333333333333333" as Address;
  // Independent ERC-20 receipt vector: Transfer(address,address,uint256), 500000 = 0x7a120.
  const log = { address: token, data: `0x${"7a120".padStart(64, "0")}`, topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    `0x${sender.slice(2).padStart(64, "0")}`, `0x${destination.slice(2).padStart(64, "0")}`,
  ], removed: false };
  const receipt = { status: "success", logs: [{ ...log, logIndex: 4 }, { ...log, logIndex: 7 }] } as unknown as TransactionReceipt;
  assert.deepEqual(batchCreditPositions(receipt, token, sender, destination), [4, 7]);
  for (const wrong of [
    { ...receipt, status: "reverted" }, { ...receipt, logs: receipt.logs.slice(0, 1) },
    { ...receipt, logs: [receipt.logs[0], { ...receipt.logs[1], logIndex: 4 }] },
    { ...receipt, logs: [receipt.logs[0], { ...receipt.logs[1], data: `0x${"7a121".padStart(64, "0")}` }] },
    { ...receipt, logs: [receipt.logs[0], { ...receipt.logs[1], address: destination }] },
    { ...receipt, logs: [receipt.logs[0], { ...receipt.logs[1], removed: true }] },
    { ...receipt, logs: [...receipt.logs, { ...receipt.logs[1], logIndex: 9 }] },
    { ...receipt, logs: [...receipt.logs, { ...receipt.logs[1], data: "0x", logIndex: 9 }] },
  ]) assert.throws(() => batchCreditPositions(wrong as TransactionReceipt, token, sender, destination));
});
