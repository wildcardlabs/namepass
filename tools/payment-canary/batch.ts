import { decodeEventLog, encodeFunctionData, getAddress, parseAbi, toEventSelector, type Address,  type TransactionReceipt } from "viem";

const transfer = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
export const batchDepositAmount = 500000n;
export const multicallAddress = getAddress("0xcA11bde05977b3631167028862bE2a173976CA11");
export const multicallCodeHash = "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891";
export const multicallAbi = parseAbi(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])"]);
const tokenAbi = parseAbi(["function transferFrom(address,address,uint256) returns (bool)"]);
export function batchData(token: Address, sender: Address, destination: Address) {
  return encodeFunctionData({ abi: multicallAbi, functionName: "aggregate3", args: [[0, 1].map(() => ({ target: token, allowFailure: false,
    callData: encodeFunctionData({ abi: tokenAbi, functionName: "transferFrom", args: [sender, destination, batchDepositAmount] }) }))] });
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
