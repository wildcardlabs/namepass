import { decodeEventLog, getAddress, parseAbi, toEventSelector, type Address, type Hex, type TransactionReceipt } from "viem";

const transfer = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
export const batchDepositAmount = 500000n;

export function batchCapability(result: unknown, chainId: number): string {
  if (!result || typeof result !== "object") return "unsupported";
  const entries = Object.entries(result);
  const value = entries.find(([key]) => Number(key) === chainId)?.[1]
    ?? entries.find(([key]) => key === "0x0")?.[1];
  const status = (value as { atomic?: { status?: unknown } } | undefined)?.atomic?.status;
  return typeof status === "string" ? status : "unsupported";
}

export function confirmedBatchHash(value: unknown, chainId: number, id: string): Hex | null {
  const result = value as { id?: string; chainId?: string; status?: number; atomic?: boolean; receipts?: { transactionHash?: string; status?: string }[] };
  if (!result || result.id !== id || Number(result.chainId) !== chainId || !Number.isInteger(result.status))
    throw Error("Wallet returned a different or invalid batch identity.");
  if (result.status! >= 100 && result.status! < 200) return null;
  if (result.status !== 200 || result.atomic !== true || result.receipts?.length !== 1
    || result.receipts[0].status !== "0x1" || !/^0x[0-9a-f]{64}$/i.test(result.receipts[0].transactionHash ?? ""))
    throw Error("This test requires two successful transfers in one atomic transaction.");
  return result.receipts[0].transactionHash as Hex;
}

/** Check the full public-RPC receipt, independently of the wallet's filtered logs. */
export function batchCreditPositions(receipt: TransactionReceipt, token: Address, sender: Address, destination: Address): number[] {
  if (receipt.status !== "success") throw Error("Batch transaction reverted.");
  const credits = receipt.logs.flatMap(log => {
    if (getAddress(log.address) !== getAddress(token)) return [];
    if (log.topics[0]?.toLowerCase() !== toEventSelector(transfer[0])) return [];
    let event;
    try { event = decodeEventLog({ abi: transfer, data: log.data, topics: log.topics }); }
    catch { throw Error("The receipt contains an invalid USDC transfer log."); }
    if (getAddress(event.args.to) !== getAddress(destination)) return [];
    if (getAddress(event.args.from) !== getAddress(sender) || event.args.value !== batchDepositAmount
      || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || log.removed)
      throw Error("The receipt contains a different deposit from this test.");
    return [log.logIndex];
  });
  if (credits.length !== 2 || new Set(credits).size !== 2)
    throw Error("The full receipt must contain exactly two distinct 0.50-USDC credits.");
  return credits.sort((a, b) => a - b);
}
