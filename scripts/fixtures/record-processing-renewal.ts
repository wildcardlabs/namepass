/**
 * Records processing-to-renewal captures for `test/fixtures/public-processing-renewal/receipts.json`.
 *
 * Runs the real verifier against live providers and Circle's sandbox Iris, records every read it
 * makes in the fixture's replay shape, and deduplicates contract code by Keccak-256. Read-only.
 *
 *   ETHEREUM_SEPOLIA_RPC_URL=… ARC_TESTNET_RPC_URL=… node --import tsx \
 *     scripts/fixtures/record-processing-renewal.ts <out.json> <chainId>:<label>:<processingTx>:<processingLogIndex>:<renewalTx>:<renewalLogIndex> …
 */
import { writeFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import { HUB_CHAIN, SERVER_CHAINS } from "../../src/lib/chains";
import { inspectProcessingRenewal, type ProcessingRenewalTransport } from "../../server/processing-renewal-evidence";

const [out, ...specs] = process.argv.slice(2);
if (!out || !specs.length) throw new Error("usage: <out.json> <chainId>:<label>:<processingTx>:<processingLogIndex>:<renewalTx>:<renewalLogIndex> …");
const codes: Record<string, string> = {};
const cases = [];
for (const spec of specs) {
	const [chainId, label, processingTransactionHash, processingLogIndex, renewalTransactionHash, renewalLogIndex] = spec.split(":");
	const origin = SERVER_CHAINS.find((c) => String(c.chainId) === chainId);
	if (!origin) throw new Error(`unknown chain ${chainId}`);
	const urls = new Map([origin, HUB_CHAIN].map((c) => [c.chainId, process.env[c.rpcEnv]]));
	for (const [id, url] of urls) if (!url) throw new Error(`missing RPC for chain ${id}`);
	const reads: Record<string, unknown>[] = [];
	let requestId = 0;
	const transport: ProcessingRenewalTransport = {
		async rpc(id, method, params, signal) {
			const response = await fetch(urls.get(id)!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }), signal });
			const body = await response.json();
			if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
			const read: Record<string, unknown> = { kind: "rpc", chainId: id, method, params };
			if (method === "eth_getCode" && typeof body.result === "string" && body.result.length > 2) {
				const hash = keccak256(body.result as Hex);
				codes[hash] = body.result;
				read.resultCodeHash = hash;
			} else read.result = body.result;
			reads.push(read);
			return body.result;
		},
		async messages(domain, hash, signal) {
			const response = await fetch(`https://iris-api-sandbox.circle.com/v2/messages/${domain}?transactionHash=${hash}`, { signal });
			const result = await response.json();
			reads.push({ kind: "iris", result });
			return result;
		},
	};
	const input = { chainId, label, processingTransactionHash, processingLogIndex, renewalTransactionHash, renewalLogIndex };
	const evidence = await inspectProcessingRenewal(input, transport);
	console.log(JSON.stringify({ input, expiry: evidence.expiry, ensLogIndex: evidence.ensLogIndex, secondsAdded: evidence.secondsAdded, amountApplied: evidence.amountApplied, rpcCalls: evidence.rpcCalls, irisReads: evidence.irisReads, providerFinalized: evidence.providerFinalized }));
	cases.push({ input, reads });
}
writeFileSync(out, `${JSON.stringify({ capturedAt: new Date().toISOString(), cases, codes }, null, 2)}\n`);
console.log(`wrote ${out}: ${cases.length} cases, ${Object.keys(codes).length} code blobs`);
