import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import {
	decodeEventLog,
	encodeAbiParameters,
	encodeEventTopics,
	parseAbi,
	toEventSelector,
	toHex,
	type Hex,
} from "viem";
import { HUB_CHAIN } from "../src/lib/chains";
import {
	inspectProcessingRenewal,
	type ProcessingRenewalInput,
	type ProcessingRenewalTransport,
} from "./processing-renewal-evidence";
import type { SourceReceipt } from "./source-deposit-evidence";

const stored = JSON.parse(
	readFileSync(
		new URL(
			"../test/fixtures/public-processing-renewal/receipts.json",
			import.meta.url,
		),
		"utf8",
	),
);
const PROCESSED = parseAbi([
	"event DepositProcessed(bytes32 indexed labelKey,address indexed wallet,uint256 amount,uint256 remaining)",
]);
const RENEWED = parseAbi([
	"event Renewed(bytes32 indexed labelHash,address indexed wallet,address indexed executor,string label,uint64 duration,uint256 amountReceived,uint256 gasAllowance,uint256 amountApplied,uint256 remainder,bool fromCCTP)",
]);
const ENS = parseAbi([
	"event NameRenewed(uint256 indexed tokenId,string label,uint64 duration,uint64 newExpiry,address paymentToken,bytes32 indexed referrer,uint256 amount)",
]);
type Read = {
	kind: string;
	chainId: number;
	method: string;
	params: unknown[];
	result: any;
};
function fixture(index = 0) {
	const entry = structuredClone(stored.cases[index]);
	const input = entry.input as ProcessingRenewalInput;
	const reads: Read[] = entry.reads.map((r: any) => ({
		...r,
		result: r.resultCodeHash ? stored.codes[r.resultCodeHash] : r.result,
	}));
	const calls: { chainId: number; method: string; params: unknown[] }[] = [];
	const transport: ProcessingRenewalTransport = {
		async rpc(chainId, method, params) {
			calls.push({ chainId, method, params });
			const r = reads.find(
				(r) =>
					r.chainId === chainId &&
					r.method === method &&
					JSON.stringify(r.params) === JSON.stringify(params),
			);
			assert.ok(r, `unexpected fixture read ${method}`);
			return structuredClone(r.result);
		},
		async messages(domain, hash) {
			assert.equal(domain, 26);
			assert.equal(hash, input.processingTransactionHash);
			return structuredClone(reads.find((r) => r.kind === "iris")!.result);
		},
	};
	const origin = () =>
		reads.find(
			(r) =>
				r.method === "eth_getTransactionReceipt" &&
				r.params[0] === input.processingTransactionHash,
		)!.result as SourceReceipt;
	const hub = () =>
		reads.find(
			(r) =>
				r.method === "eth_getTransactionReceipt" &&
				r.params[0] === input.renewalTransactionHash,
		)!.result as SourceReceipt;
	return { input, reads, calls, transport, origin, hub };
}
function changeEns(
	f: ReturnType<typeof fixture>,
	change: Record<string, unknown>,
) {
	const l = f.hub().logs.find((l) => l.topics[0] === toEventSelector(ENS[0]))!;
	const args = {
		...decodeEventLog({
			abi: ENS,
			data: l.data as Hex,
			topics: l.topics as [Hex, ...Hex[]],
			strict: true,
		}).args,
		...change,
	} as any;
	l.topics = encodeEventTopics({
		abi: ENS,
		eventName: "NameRenewed",
		args: { tokenId: args.tokenId, referrer: args.referrer },
	}) as string[];
	l.data = encodeAbiParameters(
		[
			{ type: "string" },
			{ type: "uint64" },
			{ type: "uint64" },
			{ type: "address" },
			{ type: "uint256" },
		],
		[args.label, args.duration, args.newExpiry, args.paymentToken, args.amount],
	);
}

test("historical Arc and direct Sepolia receipts bind each call to its exact ENS expiry and history identifier", async () => {
	// These fixed expiries/durations come from the published chain receipt events, not verifier output.
	const expected = [
		["2029-07-02T07:16:26.000Z", 184, 19],
		["2029-08-12T08:46:16.000Z", 158, 19],
		["2029-09-22T10:16:06.000Z", 316, 13],
		["2069-09-12T15:13:35.000Z", 154, 20],
	] as const;
	for (let i = 0; i < 4; i++) {
		const f = fixture(i),
			r = await inspectProcessingRenewal(f.input, f.transport);
		assert.equal(
			r.renewalId,
			`11155111:${f.input.renewalTransactionHash}:${f.input.renewalLogIndex}`,
		);
		assert.equal(
			r.processingId,
			`${f.input.chainId}:${f.input.processingTransactionHash}:${f.input.processingLogIndex}`,
		);
		assert.equal(r.secondsAdded, i === 3 ? "39025697" : "3547790");
		assert.equal(r.amountApplied, i === 3 ? "9900000" : "900000");
		assert.equal(r.renewalFee, "100000");
		assert.equal(r.expiry, expected[i][0]);
		assert.equal(r.ensLogIndex, expected[i][1]);
		assert.equal(r.rpcCalls, expected[i][2]);
		assert.equal(r.providerFinalized, true);
		assert.equal(r.irisReads, i === 2 ? 0 : 1);
		assert.equal("complete" in r, false);
		assert.equal("status" in r, false);
		assert.ok(
			f.calls.every((c) =>
				[
					"eth_chainId",
					"eth_getBlockByNumber",
					"eth_getTransactionReceipt",
					"eth_getCode",
					"eth_call",
				].includes(c.method),
			),
		);
	}
});

test("equal-sized renewals for the same name cannot substitute for another processing call", async () => {
	const f = fixture(),
		other = fixture(1);
	const otherReads = other.reads.filter((r) => r.chainId === HUB_CHAIN.chainId);
	f.reads.push(...otherReads);
	await assert.rejects(
		inspectProcessingRenewal(
			{
				...f.input,
				renewalTransactionHash: other.input.renewalTransactionHash,
				renewalLogIndex: other.input.renewalLogIndex,
			},
			f.transport,
		),
		/claim nonce/,
	);
	const direct = fixture(2);
	await assert.rejects(
		inspectProcessingRenewal(
			{ ...direct.input, processingLogIndex: "0" },
			direct.transport,
		),
		/processing_event_not_found/,
	);
});

test("two equal burns and renewals inside one transaction keep ordered message and renewal identities separate", async () => {
	const f = fixture(),
		other = fixture(1);
	function append(first: SourceReceipt, second: SourceReceipt) {
		first.logs.push(...structuredClone(second.logs));
		first.logs.forEach((l, i) =>
			Object.assign(l, {
				logIndex: toHex(i),
				transactionHash: first.transactionHash,
				transactionIndex: first.transactionIndex,
				blockHash: first.blockHash,
				blockNumber: first.blockNumber,
			}),
		);
	}
	append(f.origin(), other.origin());
	append(f.hub(), other.hub());
	const messages = f.reads.find((r) => r.kind === "iris")!.result;
	messages.messages.push(
		...other.reads.find((r) => r.kind === "iris")!.result.messages,
	);
	const markers = f
		.origin()
		.logs.filter((l) => l.topics[0] === toEventSelector(PROCESSED[0]));
	const renewals = f
		.hub()
		.logs.filter((l) => l.topics[0] === toEventSelector(RENEWED[0]));
	const input = (i: number) => ({
		...f.input,
		processingLogIndex: String(parseInt(markers[i].logIndex, 16)),
		renewalLogIndex: String(parseInt(renewals[i].logIndex, 16)),
	});
	const first = await inspectProcessingRenewal(input(0), f.transport),
		second = await inspectProcessingRenewal(input(1), f.transport);
	assert.equal(first.cctp!.messageIndex, 0);
	assert.equal(second.cctp!.messageIndex, 1);
	assert.notEqual(first.processingId, second.processingId);
	assert.notEqual(first.renewalId, second.renewalId);
	assert.equal(first.expiry, "2029-07-02T07:16:26.000Z");
	assert.equal(second.expiry, "2029-08-12T08:46:16.000Z");
	await assert.rejects(
		inspectProcessingRenewal(
			{ ...input(0), renewalLogIndex: input(1).renewalLogIndex },
			f.transport,
		),
		/claim nonce/,
	);
});

test("Circle source coverage, immutable message bytes, version, readiness and nonce must match", async () => {
	const cases: [(payload: any) => void, RegExp][] = [
		[
			(p) => (p.sourceTxHash = "0x" + "11".repeat(32)),
			/circle_message_coverage_mismatch/,
		],
		[
			(p) => p.messages.push(structuredClone(p.messages[0])),
			/circle_message_coverage_mismatch/,
		],
		[
			(p) => (p.messages[0].status = "pending_confirmations"),
			/circle_message_not_ready/,
		],
		[(p) => (p.messages[0].cctpVersion = 1), /circle_message_not_ready/],
		[(p) => (p.messages[0].eventNonce = "1"), /circle_nonce_mismatch/],
		[
			(p) => {
				const raw = p.messages[0].message;
				p.messages[0].message =
					raw.slice(0, 2 + 280 * 2) +
					"0".repeat(63) +
					"1" +
					raw.slice(2 + 312 * 2);
			},
			/circle_source_message_mismatch/,
		],
		[
			(p) => {
				const raw = p.messages[0].message;
				p.messages[0].message =
					raw.slice(0, 2 + 312 * 2) +
					"0".repeat(63) +
					"1" +
					raw.slice(2 + 344 * 2);
			},
			/circle_claim_message_mismatch/,
		],
	];
	for (const [change, error] of cases) {
		const f = fixture();
		change(f.reads.find((r) => r.kind === "iris")!.result);
		await assert.rejects(inspectProcessingRenewal(f.input, f.transport), error);
	}
	const decimal = fixture();
	const entry = decimal.reads.find((r) => r.kind === "iris")!.result
		.messages[0];
	entry.eventNonce = BigInt(entry.eventNonce).toString();
	assert.equal(
		(await inspectProcessingRenewal(decimal.input, decimal.transport))
			.providerFinalized,
		true,
	);
});

test("ENS duration, charged amount, token, referrer and helper runtime cannot be replaced with lookalike evidence", async () => {
	for (const [change, error] of [
		[{ duration: 1n }, /processing_ens_renewal_mismatch/],
		[{ amount: 1n }, /processing_ens_renewal_mismatch/],
		[
			{ paymentToken: "0x" + "11".repeat(20) },
			/does not match the expected Namepass renewal/,
		],
		[
			{ referrer: "0x" + "11".repeat(32) },
			/does not match the expected Namepass renewal/,
		],
		[{ label: "vitalik" }, /does not match the expected Namepass renewal/],
	] as const) {
		const f = fixture();
		changeEns(f, change);
		await assert.rejects(inspectProcessingRenewal(f.input, f.transport), error);
	}
	const missing = fixture();
	missing.hub().logs = missing
		.hub()
		.logs.filter((l) => l.topics[0] !== toEventSelector(ENS[0]));
	await assert.rejects(
		inspectProcessingRenewal(missing.input, missing.transport),
		/exactly one expected ENS/,
	);
	const runtime = fixture();
	const helper = runtime.reads.find(
		(r) =>
			r.method === "eth_getCode" &&
			String(r.params[0]).toLowerCase() ===
				"0x7bfee7c257ff48f8d787a61f15925e24743c8f88",
	)!;
	helper.result = "0x1234";
	await assert.rejects(
		inspectProcessingRenewal(runtime.input, runtime.transport),
		/unsupported pricing adapter/,
	);
	const factory = fixture();
	factory.reads.find((r) => r.method === "eth_getCode")!.result = "0x1234";
	await assert.rejects(
		inspectProcessingRenewal(factory.input, factory.transport),
		/unsupported_processing_factory/,
	);
	const gateway = fixture();
	gateway.reads.find(
		(r) =>
			r.method === "eth_getCode" &&
			String(r.params[0]).toLowerCase() ===
				HUB_CHAIN.gatewayAddress!.toLowerCase(),
	)!.result = "0x1234";
	await assert.rejects(
		inspectProcessingRenewal(gateway.input, gateway.transport),
		/unsupported_renewal_gateway/,
	);
	const metadata = fixture();
	metadata.reads.find((r) => r.method === "eth_call")!.result =
		"0x" + "0".repeat(24) + "11".repeat(20);
	await assert.rejects(
		inspectProcessingRenewal(metadata.input, metadata.transport),
		/unsupported_renewal_ens_metadata/,
	);
});

test("receipt membership, canonical corrections and wrong chains prevent successful inspection", async () => {
	for (const [change, error] of [
		[
			(f: ReturnType<typeof fixture>) => (f.hub().logs[0].removed = true),
			/inconsistent_processing_renewal_log/,
		],
		[
			(f: ReturnType<typeof fixture>) =>
				(f.hub().blockHash = "0x" + "11".repeat(32)),
			/noncanonical_processing_renewal/,
		],
		[
			(f: ReturnType<typeof fixture>) =>
				(f.hub().logs[0].transactionIndex = "0x0"),
			/inconsistent_processing_renewal_log/,
		],
		[
			(f: ReturnType<typeof fixture>) =>
				f.hub().logs.splice(1, 0, structuredClone(f.hub().logs[0])),
			/inconsistent_processing_renewal_log/,
		],
		[
			(f: ReturnType<typeof fixture>) =>
				(f.reads.find((r) => r.method === "eth_chainId")!.result = "0x1"),
			/wrong_processing_renewal_chain/,
		],
	] as const) {
		const f = fixture();
		change(f);
		await assert.rejects(inspectProcessingRenewal(f.input, f.transport), error);
	}
	const correction = fixture();
	const target = correction.hub().blockNumber;
	let visits = 0;
	const original = correction.transport.rpc;
	correction.transport.rpc = async (id, method, params, signal) => {
		const r: any = await original(id, method, params, signal);
		if (
			id === 11155111 &&
			method === "eth_getBlockByNumber" &&
			params[0] === target &&
			++visits === 2
		)
			r.hash = "0x" + "11".repeat(32);
		return r;
	};
	await assert.rejects(
		inspectProcessingRenewal(correction.input, correction.transport),
		/processing_renewal_block_changed/,
	);
});

test("a renewal above the provider finalized anchor remains unfinalized and changing anchors fail inspection", async () => {
	const f = fixture();
	const original = f.transport.rpc;
	const old = toHex(BigInt(f.hub().blockNumber) - 1n);
	const anchor = {
		number: old,
		hash: "0x" + "11".repeat(32),
		timestamp: toHex(1),
	};
	f.transport.rpc = async (id, method, params, signal) =>
		id === 11155111 &&
		method === "eth_getBlockByNumber" &&
		(params[0] === "finalized" || params[0] === old)
			? structuredClone(anchor)
			: original(id, method, params, signal);
	assert.equal(
		(await inspectProcessingRenewal(f.input, f.transport)).providerFinalized,
		false,
	);
	const changed = fixture();
	const base = changed.transport.rpc;
	const a = changed.reads.find(
		(r) =>
			r.chainId === 11155111 &&
			r.method === "eth_getBlockByNumber" &&
			r.params[0] === "finalized",
	)!.result;
	changed.transport.rpc = async (id, method, params, signal) => {
		const r: any = await base(id, method, params, signal);
		if (
			id === 11155111 &&
			method === "eth_getBlockByNumber" &&
			params[0] === a.number
		)
			r.hash = "0x" + "11".repeat(32);
		return r;
	};
	await assert.rejects(
		inspectProcessingRenewal(changed.input, changed.transport),
		/processing_renewal_anchor_changed/,
	);
});

test("invalid positions fail before RPC and cancellation stops a hung provider within the shared deadline", async () => {
	const f = fixture();
	await assert.rejects(
		inspectProcessingRenewal(
			{ ...f.input, processingLogIndex: "2147483648" },
			f.transport,
		),
		/invalid_renewal_position/,
	);
	assert.equal(f.calls.length, 0);
	const controller = new AbortController();
	const original = f.transport.rpc;
	f.transport.rpc = (id, method, params, signal) => {
		if (method === "eth_getCode") {
			setTimeout(() => controller.abort(), 5);
			return new Promise(() => {});
		}
		return original(id, method, params, signal);
	};
	await assert.rejects(
		inspectProcessingRenewal(f.input, f.transport, controller.signal),
		/processing_renewal_deadline/,
	);
	assert.ok(f.calls.length < 24);
});

test("actual direct CLI uses read-only serialized RPC and suppresses private or oversized provider errors", async () => {
	const f = fixture(2);
	let mode: "valid" | "error" | "oversized" | "wrong-id" = "valid";
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const part of req) body += part;
		const p = JSON.parse(body);
		assert.equal(req.method, "POST");
		assert.ok(
			[
				"eth_chainId",
				"eth_getBlockByNumber",
				"eth_getTransactionReceipt",
				"eth_getCode",
				"eth_call",
			].includes(p.method),
		);
		const result =
			mode === "oversized"
				? { result: "x".repeat(2 * 1024 * 1024) }
				: mode === "error"
					? { error: { message: "PRIVATE_PROVIDER_CREDENTIAL" } }
					: {
							result: await f.transport.rpc(
								11155111,
								p.method,
								p.params,
								new AbortController().signal,
							),
						};
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				jsonrpc: "2.0",
				id: mode === "wrong-id" ? p.id + 1 : p.id,
				...result,
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const addr = server.address();
	assert.ok(addr && typeof addr !== "string");
	const port = addr.port;
	async function run() {
		const child = spawn(
			process.execPath,
			[
				"--import",
				"tsx",
				"scripts/public-api/processing-renewals.ts",
				...Object.values(f.input),
			],
			{
				cwd: new URL("../", import.meta.url),
				env: {
					PATH: process.env.PATH,
					ETHEREUM_SEPOLIA_RPC_URL: `http://127.0.0.1:${port}`,
				},
			},
		);
		let stdout = "",
			stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		const code = await new Promise<number | null>((resolve, reject) => {
			child.on("error", reject);
			child.on("close", resolve);
		});
		return { stdout, stderr, code };
	}
	try {
		const result = await run();
		assert.equal(result.code, 0, result.stderr);
		const report = JSON.parse(result.stdout);
		assert.equal(report.readOnly, true);
		assert.equal(report.evidence.expiry, "2029-09-22T10:16:06.000Z");
		assert.equal(report.evidence.providerFinalized, true);
		for (const bad of ["error", "oversized", "wrong-id"] as const) {
			mode = bad;
			const rejected = await run();
			assert.equal(rejected.code, 1);
			assert.equal(rejected.stdout, "");
			assert.doesNotMatch(rejected.stderr, /PRIVATE_PROVIDER_CREDENTIAL/);
			assert.equal(
				JSON.parse(rejected.stderr).error,
				"processing_renewal_inspection_unavailable",
			);
		}
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
