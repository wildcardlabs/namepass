import { decodeEventLog, encodeFunctionData, parseAbi, type Address, type Hex, type Transaction, type TransactionReceipt } from "viem";

export const tokenAbi = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export const canaryAmount = 500000n;
export function checkedTransfer(tx: Pick<Transaction, "hash" | "from" | "to" | "input" | "value">, receipt: TransactionReceipt, sender: Address, token: Address, destination: Address): number {
  const same = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();
  if (receipt.status !== "success" || tx.hash !== receipt.transactionHash || !same(tx.from, sender) || !same(tx.to, token)
    || tx.value !== 0n || tx.input !== encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [destination, canaryAmount] })) throw Error("The submitted transaction is not the expected 0.50-USDC transfer.");
  const positions: number[] = [];
  for (const log of receipt.logs) {
    if (!same(log.address, token)) continue;
    try {
      const event = decodeEventLog({ abi: tokenAbi, eventName: "Transfer", data: log.data, topics: log.topics });
      if (same(event.args.from, sender) && same(event.args.to, destination) && event.args.value === canaryAmount) {
        if (log.logIndex === null) throw Error("A credit has no log position."); positions.push(log.logIndex);
      }
    } catch { /* Nonmatching token events are not evidence for this credit. */ }
  }
  if (positions.length !== 1) throw Error("The receipt must contain exactly one matching 0.50-USDC credit.");
  return positions[0];
}

export function transactionHash(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw Error("Use the complete submitted transaction hash.");
  return value as Hex;
}
