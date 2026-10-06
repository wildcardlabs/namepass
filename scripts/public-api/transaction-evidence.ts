/** Private read-only operator. Candidate identities are hints, never completion evidence. */
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { HUB_CHAIN, SERVER_CHAINS } from "../../src/lib/chains";
import { inspectAllocation } from "../../server/allocation-evidence";
import { inspectProcessingRenewal } from "../../server/processing-renewal-evidence";
import {
	joinTransactionEvidence,
	type SourceInspection,
	type AllocationInspection,
	type RenewalInspection,
} from "../../server/transaction-evidence";
import type { SourceBlock } from "../../server/source-deposit-evidence";

let stage = "arguments";

async function inspect() {
	const [manifestPath, ...extra] = process.argv.slice(2);
	if (
		!manifestPath ||
		extra.length ||
		statSync(manifestPath).size > 1024 * 1024
	)
		throw new Error("invalid_manifest");
	const input = JSON.parse(readFileSync(manifestPath, "utf8")) as {
		chainId: string;
		transactionHash: string;
		throughBlock: string;
		rangeMode?: "short" | "extended";
		renewals: { processingId: string; renewalId: string }[];
	};
	const chain = SERVER_CHAINS.find((c) => String(c.chainId) === input.chainId);
	const eventId = /^[1-9][0-9]*:0x[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$/;
	if (
		!chain ||
		!/^0x[0-9a-f]{64}$/.test(input.transactionHash) ||
		!/^(0|[1-9][0-9]*)$/.test(input.throughBlock) ||
		(input.rangeMode !== undefined &&
			!["short", "extended"].includes(input.rangeMode)) ||
		!Array.isArray(input.renewals) ||
		input.renewals.length > 16 ||
		input.renewals.some(
			(r) =>
				!eventId.test(r.processingId) ||
				!eventId.test(r.renewalId) ||
				!r.processingId.startsWith(`${input.chainId}:`) ||
				!r.renewalId.startsWith(`${HUB_CHAIN.chainId}:`),
		) ||
		new Set(input.renewals.map((r) => r.processingId)).size !==
			input.renewals.length
	)
		throw new Error("invalid_manifest");
	const limits = {
		rpcCalls: 256,
		circleReads: 16,
		deadlineMs: 90000,
		members: 16,
		wallets: 8,
		blockRechecks: 64,
		responseBytes: 1024 * 1024,
	};
	const signal = AbortSignal.timeout(limits.deadlineMs);
	let rpcCalls = 0,
		circleReads = 0,
		requestId = 0;
	function reserve(n: number) {
		signal.throwIfAborted();
		if (rpcCalls + n > limits.rpcCalls)
			throw new Error("transaction_request_budget");
	}
	async function json(url: string, init: RequestInit) {
		const response = await fetch(url, {
			...init,
			redirect: "error",
			signal: init.signal ?? signal,
		});
		if (!response.ok) throw new Error("provider_unavailable");
		const reader = response.body?.getReader();
		if (!reader) throw new Error("provider_unavailable");
		let size = 0;
		const parts: Uint8Array[] = [];
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > limits.responseBytes) throw new Error("response_limit");
				parts.push(value);
			}
		} finally {
			await reader.cancel();
		}
		return JSON.parse(Buffer.concat(parts).toString("utf8"));
	}
	const methods = [
		"eth_chainId",
		"eth_getBlockByNumber",
		"eth_getTransactionReceipt",
		"eth_getLogs",
		"eth_call",
		"eth_getCode",
	];
	async function rpc(
		chainId: number,
		method: string,
		params: unknown[],
		cancellation = signal,
	) {
		reserve(1);
		if (!methods.includes(method)) throw new Error("unsupported_rpc_method");
		rpcCalls++;
		const network = SERVER_CHAINS.find((c) => c.chainId === chainId),
			url = network && process.env[network.rpcEnv];
		if (!url) throw new Error("missing_provider");
		const id = ++requestId;
		const payload = await json(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
			signal: cancellation,
		});
		if (
			payload.jsonrpc !== "2.0" ||
			payload.id !== id ||
			payload.error ||
			payload.result === null ||
			payload.result === undefined
		)
			throw new Error("provider_unavailable");
		return payload.result;
	}
	async function source(): Promise<SourceInspection> {
		reserve(7);
		const env = {
			PATH: process.env.PATH,
			DATABASE_URL: process.env.DATABASE_URL,
			[chain!.rpcEnv]: process.env[chain!.rpcEnv],
		};
		const text = await new Promise<string>((resolve, reject) => {
			execFile(
				process.execPath,
				[
					"--import",
					createRequire(import.meta.url).resolve("tsx"),
					fileURLToPath(new URL("./source-deposits.ts", import.meta.url)),
					input.chainId,
					input.transactionHash,
				],
				{ env, signal, maxBuffer: limits.responseBytes },
				(error, stdout) =>
					error ? reject(new Error("source_unavailable")) : resolve(stdout),
			);
		});
		const result = JSON.parse(text) as SourceInspection;
		if (
			!result.readOnly ||
			result.rpcCalls !== 7 ||
			result.evidence.chainId !== input.chainId ||
			result.evidence.transactionHash !== input.transactionHash
		)
			throw new Error("invalid_source_evidence");
		rpcCalls += result.rpcCalls;
		return result;
	}
	stage = "source";
	const initial = await source(),
		members = initial.evidence.members;
	const names = [...new Set(members.map((m) => m.name))];
	if (members.length > limits.members || names.length > limits.wallets)
		throw new Error("transaction_member_budget");
	const allocations: AllocationInspection[] = [],
		renewals: RenewalInspection[] = [];
	if (
		initial.evidence.receiptSetClosed &&
		initial.sourceFinality.providerFinalized &&
		members.every((m) => m.allocationLogIndex !== null)
	) {
		for (const name of names) {
			stage = "allocation";
			reserve(input.rangeMode === "extended" ? 192 : 64);
			allocations.push(
				await inspectAllocation(
					{
						chainId: input.chainId,
						label: name.slice(0, -4),
						transactionHash: input.transactionHash,
						throughBlock: input.throughBlock,
						rangeMode: input.rangeMode,
					},
					(method, params, s) => rpc(chain!.chainId, method, params, s),
					signal,
				),
			);
		}
		const needed = new Set(
			allocations.flatMap((a) =>
				a.deposits.flatMap((d) => d.processingCallIds),
			),
		);
		if (needed.size > 16) throw new Error("transaction_renewal_budget");
		for (const id of needed) {
			stage = "renewal";
			const hint = input.renewals.find((r) => r.processingId === id);
			if (!hint) continue;
			const allocation = allocations.find((a) =>
				a.processingCalls.some((c) => c.processingId === id),
			)!;
			const [, processingTransactionHash, processingLogIndex] = id.split(":"),
				[, renewalTransactionHash, renewalLogIndex] = hint.renewalId.split(":");
			reserve(24);
			renewals.push(
				await inspectProcessingRenewal(
					{
						chainId: input.chainId,
						label: allocation.name.slice(0, -4),
						processingTransactionHash,
						processingLogIndex,
						renewalTransactionHash,
						renewalLogIndex,
					},
					{
						rpc,
						async messages(domain, hash, s) {
							if (++circleReads > limits.circleReads)
								throw new Error("transaction_circle_budget");
							return json(
								`https://iris-api-sandbox.circle.com/v2/messages/${domain}?transactionHash=${hash}`,
								{ method: "GET", signal: s },
							);
						},
					},
					signal,
				),
			);
		}
	}
	stage = "join";
	const evidence = joinTransactionEvidence(initial, allocations, renewals);
	if (evidence.blocks.length > limits.blockRechecks)
		throw new Error("transaction_block_budget");
	// Re-read indexed source membership after the other proofs; no cached completed state is used.
	stage = "source_recheck";
	const final = await source();
	if (
		JSON.stringify(initial.evidence) !== JSON.stringify(final.evidence) ||
		(!final.sourceFinality.providerFinalized &&
			initial.sourceFinality.providerFinalized)
	)
		throw new Error("transaction_source_changed");
	for (const b of evidence.blocks) {
		stage = "block_recheck";
		const fresh = (await rpc(Number(b.chainId), "eth_getBlockByNumber", [
			`0x${BigInt(b.number).toString(16)}`,
			false,
		])) as SourceBlock;
		if (
			BigInt(fresh.number).toString() !== b.number ||
			fresh.hash.toLowerCase() !== b.hash
		)
			throw new Error("transaction_block_changed");
	}
	signal.throwIfAborted();
	console.log(
		JSON.stringify(
			{
				observedAt: new Date().toISOString(),
				readOnly: true,
				sourceSnapshots: [initial.databaseSnapshotAt, final.databaseSnapshotAt],
				rpcCalls,
				circleReads,
				limits,
				allocationRpcCalls: allocations.map((a) => a.rpcCalls),
				renewalRpcCalls: renewals.map((r) => r.rpcCalls),
				evidence,
			},
			null,
			2,
		),
	);
}
inspect().catch(() => {
		console.error(
		JSON.stringify({
			error: "transaction_inspection_unavailable",
			stage,
			message:
				"Check candidate identities, configuration and evidence. Provider and database details are suppressed.",
		}),
	);
	process.exitCode = 1;
});
