import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import {
	concatHex,
	encodeAbiParameters,
	encodeEventTopics,
	keccak256,
	numberToHex,
	padHex,
	parseAbi,
	stringToHex,
	toHex,
	type Hex,
} from "viem";
import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { depositAddress } from "../src/lib/namepass";
import { inspectAllocation, type AllocationRpc } from "./allocation-evidence";
import type { SourceReceipt } from "./source-deposit-evidence";

const runtime = readFileSync(
	new URL(
		"../test/fixtures/public-allocation/factory-runtime.hex",
		import.meta.url,
	),
	"utf8",
).trim();
const wallet = depositAddress("steve").toLowerCase() as Hex;
const sender = "0x1208a26faa0f4ac65b42098419eb4daa5e580ac6" as Hex;
const other = "0x3333333333333333333333333333333333333333" as Hex;
const transferAbi = parseAbi([
	"event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const processedAbi = parseAbi([
	"event DepositProcessed(bytes32 indexed labelKey,address indexed wallet,uint256 amount,uint256 remaining)",
]);
const renewalAbi = parseAbi([
	"event Renewed(bytes32 indexed labelHash,address indexed wallet,address indexed executor,string label,uint64 duration,uint256 amountReceived,uint256 gasAllowance,uint256 amountApplied,uint256 remainder,bool fromCCTP)",
]);
const messageAbi = parseAbi(["event MessageSent(bytes message)"]);
const id = (n: number) => toHex(n, { size: 32 });
type Bare = { address: string; topics: string[]; data: string; index: number };
function fixture(chainId = HUB_CHAIN.chainId) {
	const chain = SERVER_CHAINS.find((c) => c.chainId === chainId)!;
	const receipts: SourceReceipt[] = [],
		calls: string[] = [];
	const emitter = chain.nativeUsdcTransfer?.emitter ?? chain.usdcAddress,
		scale = chain.nativeUsdcTransfer ? 1_000_000_000_000n : 1n;
	let opening = 0n,
		closing = 0n;
	function transfer(
		amount: bigint,
		index: number,
		from = sender,
		to = wallet,
		mirror = false,
	): Bare {
		return {
			address: mirror ? chain.usdcAddress : emitter,
			index,
			topics: encodeEventTopics({
				abi: transferAbi,
				eventName: "Transfer",
				args: { from, to },
			}) as string[],
			data: encodeAbiParameters(
				[{ type: "uint256" }],
				[amount * (mirror ? 1n : scale)],
			),
		};
	}
	function process(amount: bigint, remaining: bigint, index: number): Bare[] {
		const labelKey = keccak256(stringToHex("steve"));
		const marker: Bare = {
			address: chain.factoryAddress!,
			index: index + 2,
			topics: encodeEventTopics({
				abi: processedAbi,
				eventName: "DepositProcessed",
				args: { labelKey, wallet },
			}) as string[],
			data: encodeAbiParameters(
				[{ type: "uint256" }, { type: "uint256" }],
				[amount, remaining],
			),
		};
		if (chainId === HUB_CHAIN.chainId)
			return [
				transfer(
					amount,
					index,
					wallet,
					HUB_CHAIN.gatewayAddress!.toLowerCase() as Hex,
				),
				{
					address: HUB_CHAIN.gatewayAddress!,
					index: index + 1,
					topics: encodeEventTopics({
						abi: renewalAbi,
						eventName: "Renewed",
						args: { labelHash: labelKey, wallet, executor: sender },
					}) as string[],
					data: encodeAbiParameters(
						[
							{ type: "string" },
							{ type: "uint64" },
							{ type: "uint256" },
							{ type: "uint256" },
							{ type: "uint256" },
							{ type: "uint256" },
							{ type: "bool" },
						],
						["steve", 600n, amount, 100000n, amount - 100000n, 0n, false],
					),
				},
				marker,
			];
		const word = (n: string | bigint) =>
			typeof n === "string"
				? padHex(n as Hex, { size: 32 })
				: numberToHex(n, { size: 32 });
		const message = concatHex([
			numberToHex(1, { size: 4 }),
			numberToHex(chain.circleDomain, { size: 4 }),
			numberToHex(HUB_CHAIN.circleDomain, { size: 4 }),
			word(0n),
			word(chain.tokenMessengerAddress!),
			word(HUB_CHAIN.tokenMessengerAddress!),
			word(HUB_CHAIN.gatewayAddress!),
			numberToHex(2000, { size: 4 }),
			numberToHex(0, { size: 4 }),
			numberToHex(1, { size: 4 }),
			word(chain.usdcAddress),
			word(HUB_CHAIN.gatewayAddress!),
			word(amount),
			word(wallet),
			word(0n),
			word(0n),
			word(0n),
			stringToHex("steve"),
		]);
		return [
			transfer(amount, index, wallet, other),
			{
				address: chain.messageTransmitterAddress,
				index: index + 1,
				topics: encodeEventTopics({
					abi: messageAbi,
					eventName: "MessageSent",
				}) as string[],
				data: encodeAbiParameters([{ type: "bytes" }], [message]),
			},
			marker,
		];
	}
	function add(n: number, block: number, txIndex: number, logs: Bare[]) {
		const r: SourceReceipt = {
			transactionHash: id(n),
			blockNumber: toHex(block),
			blockHash: id(block + 10000),
			transactionIndex: toHex(txIndex),
			status: "0x1",
			logs: logs.map((l) => ({
				address: l.address,
				topics: l.topics,
				data: l.data,
				transactionHash: id(n),
				blockNumber: toHex(block),
				blockHash: id(block + 10000),
				transactionIndex: toHex(txIndex),
				logIndex: toHex(l.index),
				removed: false,
			})),
		};
		receipts.push(r);
		return r;
	}
	const rpc: AllocationRpc = async (method, params) => {
		calls.push(method);
		switch (method) {
			case "eth_chainId":
				return toHex(chainId);
			case "eth_getBlockByNumber": {
				const n = Number(BigInt(String(params[0])));
				return {
					number: toHex(n),
					hash: id(n + 10000),
					timestamp: toHex(1790000000),
				};
			}
			case "eth_getTransactionReceipt":
				return structuredClone(
					receipts.find((r) => r.transactionHash === params[0]),
				);
			case "eth_getCode":
				return String(params[0]).toLowerCase() === wallet
					? `0x363d3d373d3d3d363d73${chain.factoryAddress!.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`
					: runtime;
			case "eth_call":
				return toHex(
					Number(BigInt(String(params[1]))) === 999 ? opening : closing,
				);
			case "eth_getLogs": {
				const p = params[0] as {
					address: string;
					fromBlock: string;
					toBlock: string;
					topics: (string | null)[];
				};
				return structuredClone(
					receipts
						.flatMap((r) => r.logs)
						.filter(
							(l) =>
								l.address.toLowerCase() === p.address.toLowerCase() &&
								BigInt(l.blockNumber) >= BigInt(p.fromBlock) &&
								BigInt(l.blockNumber) <= BigInt(p.toBlock) &&
								p.topics.every(
									(t, i) =>
										t === null || t.toLowerCase() === l.topics[i].toLowerCase(),
								),
						),
				);
			}
			default:
				throw new Error("Unexpected RPC method");
		}
	};
	return {
		chain,
		receipts,
		calls,
		transfer,
		process,
		add,
		rpc,
		setBalances(a: bigint, b: bigint) {
			opening = a;
			closing = b;
		},
		input: {
			chainId: String(chainId),
			label: "steve",
			transactionHash: id(1),
			throughBlock: "1005",
		},
	};
}

test("pooled source credits and an existing balance share one exact processing call", async () => {
	const f = fixture();
	f.setBalances(7000000n, 0n);
	f.add(1, 1000, 1, [f.transfer(3000000n, 1), f.transfer(5000000n, 2)]);
	f.add(2, 1001, 0, f.process(15000000n, 0n, 0));
	const result = await inspectAllocation(f.input, f.rpc);
	assert.equal(result.windowClosed, true);
	assert.deepEqual(
		result.deposits.map((d) => d.amount),
		["3000000", "5000000"],
	);
	const processing = `11155111:${id(2)}:2`;
	assert.deepEqual(
		result.deposits.map((d) => d.processingCallIds),
		[[processing], [processing]],
	);
	assert.equal(result.processingCalls.length, 1);
	assert.equal(result.processingCalls[0].amount, "15000000");
	assert.equal(
		result.processingCalls[0].directRenewalId,
		`11155111:${id(2)}:1`,
	);
	assert.equal("status" in result, false);
});

test("Arc split processing closes only after all slices; a new credit joins later calls only", async () => {
	const f = fixture(5042002);
	f.add(1, 1000, 1, [
		f.transfer(10000000n, 1),
		f.transfer(10000000n, 2, sender, wallet, true),
	]);
	f.add(2, 1001, 0, f.process(6000000n, 4000000n, 0));
	f.setBalances(0n, 4000000n);
	f.input.throughBlock = "1001";
	const pending = await inspectAllocation(f.input, f.rpc);
	assert.equal(pending.windowClosed, false);
	assert.equal(pending.deposits[0].windowClosed, false);
	assert.deepEqual(pending.deposits[0].processingCallIds, [
		`5042002:${id(2)}:2`,
	]);
	f.add(3, 1002, 0, [f.transfer(2000000n, 0)]);
	f.add(4, 1003, 0, f.process(6000000n, 0n, 0));
	f.setBalances(0n, 0n);
	f.input.throughBlock = "1005";
	const closed = await inspectAllocation(f.input, f.rpc);
	assert.equal(closed.windowClosed, true);
	assert.deepEqual(closed.deposits[0].processingCallIds, [
		`5042002:${id(2)}:2`,
		`5042002:${id(4)}:2`,
	]);
	assert.deepEqual(
		closed.processingCalls.map((c) => c.cctpMessageIndex),
		[0, 0],
	);
	assert.equal(
		closed.deposits.length,
		1,
		"ERC20 mirror is not another deposit",
	);
	f.input.transactionHash = id(3);
	// The later credit starts a different bounded window; its opening balance is four USDC.
	const rpc: AllocationRpc = (method, params, signal) =>
		method === "eth_call" && params[1] === toHex(1001)
			? Promise.resolve(toHex(4000000n))
			: f.rpc(method, params, signal);
	const later = await inspectAllocation(f.input, rpc);
	assert.deepEqual(later.deposits[0].processingCallIds, [`5042002:${id(4)}:2`]);
});

test("extended audit covers a delayed drain across range boundaries without closing an unfinished slice", async () => {
	const f = fixture(5042002);
	f.add(1, 1000, 1, [f.transfer(3000000n, 0)]);
	f.add(2, 1511, 0, f.process(1000000n, 2000000n, 0));
	f.add(3, 1512, 0, [f.transfer(2000000n, 0)]);
	f.setBalances(0n, 4000000n);
	const extended = {
		...f.input,
		rangeMode: "extended" as const,
		throughBlock: "18097",
	};
	await assert.rejects(
		inspectAllocation({ ...f.input, throughBlock: "18097" }, f.rpc),
		/range_budget/,
	);
	const ranges: { fromBlock: string; toBlock: string; topics: unknown[] }[] =
		[];
	const rpc: AllocationRpc = (method, params, signal) => {
		if (method === "eth_getLogs")
			ranges.push(params[0] as (typeof ranges)[number]);
		return f.rpc(method, params, signal);
	};
	const pending = await inspectAllocation(extended, rpc);
	assert.equal(pending.windowClosed, false);
	assert.equal(pending.closingBalance, "4000000");
	assert.deepEqual(pending.deposits[0].processingCallIds, [
		`5042002:${id(2)}:2`,
	]);
	const incoming = ranges.filter((r) => r.topics[1] === null);
	assert.equal(BigInt(incoming[0].fromBlock), 1000n);
	assert.equal(BigInt(incoming[incoming.length - 1].toBlock), 18097n);
	for (let i = 0; i < incoming.length; i++) {
		assert.ok(
			BigInt(incoming[i].toBlock) - BigInt(incoming[i].fromBlock) < 512n,
		);
		if (i)
			assert.equal(
				BigInt(incoming[i].fromBlock),
				BigInt(incoming[i - 1].toBlock) + 1n,
			);
	}
	assert.equal(ranges.length, incoming.length * 2);
	f.add(4, 18097, 0, f.process(4000000n, 0n, 0));
	f.setBalances(0n, 0n);
	const closed = await inspectAllocation(extended, f.rpc);
	assert.equal(closed.windowClosed, true);
	assert.deepEqual(closed.deposits[0].processingCallIds, [
		`5042002:${id(2)}:2`,
		`5042002:${id(4)}:2`,
	]);
	assert.equal(closed.deposits[0].amount, "3000000");
	assert.equal(closed.movements, 4);
	assert.equal(closed.rangeMode, "extended");
	assert.ok(closed.rpcCalls <= 192);
	assert.equal("status" in closed, false);
	// A later unknown debit cannot be hidden by the longer range or matching end balances.
	f.add(5, 9000, 0, [f.transfer(1000000n, 0, wallet, other)]);
	await assert.rejects(
		inspectAllocation(extended, f.rpc),
		/unproven_wallet_debit/,
	);
});

test("extended operator limits still reject excess range, requests and a corrected boundary", async () => {
	const f = fixture();
	f.add(1, 1000, 1, [f.transfer(30000000n, 0)]);
	const input = {
		...f.input,
		rangeMode: "extended" as const,
		throughBlock: "33767",
	};
	await assert.rejects(
		inspectAllocation({ ...input, throughBlock: "33768" }, f.rpc),
		/range_budget/,
	);
	for (let i = 2; i <= 16; i++)
		f.add(
			i,
			1000 + i,
			0,
			f.process(2000000n, 30000000n - BigInt(i - 1) * 2000000n, 0),
		);
	f.calls.length = 0;
	await assert.rejects(inspectAllocation(input, f.rpc), /request_budget/);
	assert.equal(f.calls.length, 192);
	const changed = fixture();
	changed.add(1, 1000, 1, [changed.transfer(3000000n, 0)]);
	changed.add(2, 18097, 0, changed.process(3000000n, 0n, 0));
	let terminalReads = 0;
	const rpc: AllocationRpc = async (method, params, signal) => {
		const result = await changed.rpc(method, params, signal);
		if (
			method === "eth_getBlockByNumber" &&
			params[0] === toHex(18097) &&
			++terminalReads > 1
		)
			return { ...(result as object), hash: id(99999) };
		return result;
	};
	await assert.rejects(
		inspectAllocation(
			{ ...changed.input, rangeMode: "extended", throughBlock: "18097" },
			rpc,
		),
		/boundary_changed/,
	);
});

test("two calls in one Arc transaction retain distinct message positions and drain identities", async () => {
	const f = fixture(5042002);
	f.add(1, 1000, 1, [f.transfer(10000000n, 0)]);
	f.add(2, 1001, 0, [
		...f.process(6000000n, 4000000n, 0),
		...f.process(4000000n, 0n, 3),
	]);
	const result = await inspectAllocation(f.input, f.rpc);
	assert.deepEqual(
		result.processingCalls.map((c) => c.processingId),
		[`5042002:${id(2)}:2`, `5042002:${id(2)}:5`],
	);
	assert.deepEqual(
		result.processingCalls.map((c) => c.cctpMessageIndex),
		[0, 1],
	);
	assert.equal(result.windowClosed, true);
});

test("same-block ordering excludes an earlier drain and separates drains inside the source transaction", async () => {
	const f = fixture();
	f.setBalances(2000000n, 0n);
	f.add(2, 1000, 0, f.process(2000000n, 0n, 0));
	f.add(1, 1000, 1, [
		f.transfer(3000000n, 3),
		...f.process(3000000n, 0n, 4),
		f.transfer(5000000n, 7),
		...f.process(5000000n, 0n, 8),
	]);
	const result = await inspectAllocation(f.input, f.rpc);
	assert.equal(result.windowClosed, true);
	assert.deepEqual(
		result.deposits.map((d) => d.processingCallIds),
		[[`11155111:${id(1)}:6`], [`11155111:${id(1)}:10`]],
	);
});

test("omitted movements, an unknown debit, wrong remainder and receipt corrections cannot close a window", async () => {
	for (const defect of [
		"omitted_credit",
		"unknown_debit",
		"wrong_remainder",
		"noncanonical",
		"reorg_at_end",
		"unsupported_runtime",
		"wrong_chain",
	] as const) {
		const f = fixture();
		f.add(1, 1000, 1, [f.transfer(3000000n, 0)]);
		f.add(
			2,
			1001,
			0,
			defect === "unknown_debit"
				? [f.transfer(3000000n, 0, wallet, other)]
				: f.process(3000000n, defect === "wrong_remainder" ? 1n : 0n, 0),
		);
		if (defect === "noncanonical") f.receipts[1].blockHash = id(88);
		let endReads = 0;
		const rpc: AllocationRpc = async (method, params, signal) => {
			if (defect === "wrong_chain" && method === "eth_chainId")
				return toHex(84532);
			if (defect === "unsupported_runtime" && method === "eth_getCode")
				return "0x1234";
			const value = await f.rpc(method, params, signal);
			if (defect === "omitted_credit" && method === "eth_getLogs")
				return (value as SourceReceipt["logs"]).filter(
					(l) => l.transactionHash !== id(1),
				);
			if (
				defect === "reorg_at_end" &&
				method === "eth_getBlockByNumber" &&
				params[0] === toHex(1005) &&
				++endReads > 1
			)
				return { ...(value as object), hash: id(89) };
			return value;
		};
		const expected = {
			omitted_credit: /missing_allocation_movement/,
			unknown_debit: /unproven_wallet_debit/,
			wrong_remainder: /inconsistent_wallet_drain/,
			noncanonical: /noncanonical_allocation_receipt/,
			reorg_at_end: /allocation_boundary_changed/,
			unsupported_runtime: /unsupported_allocation_factory/,
			wrong_chain: /wrong_allocation_chain/,
		};
		await assert.rejects(
			inspectAllocation(f.input, rpc),
			expected[defect],
			defect,
		);
	}
});

test("an unindexed receipt call works, duplicates deduplicate, and unfinished funding stays open", async () => {
	const f = fixture();
	f.add(1, 1000, 1, [f.transfer(3000000n, 0)]);
	f.setBalances(0n, 3000000n);
	assert.equal((await inspectAllocation(f.input, f.rpc)).windowClosed, false);
	f.add(2, 1001, 0, f.process(3000000n, 0n, 0));
	f.setBalances(0n, 0n);
	const rpc: AllocationRpc = async (method, params, signal) => {
		const value = await f.rpc(method, params, signal);
		return method === "eth_getLogs"
			? [...(value as unknown[]), ...(value as unknown[])]
			: value;
	};
	const result = await inspectAllocation(f.input, rpc);
	assert.equal(result.windowClosed, true);
	assert.equal(result.movements, 2);
	assert.equal(result.processingCalls.length, 1);
});

test("global processing order and Arc fractional movements cannot supply a false drain", async () => {
	const f = fixture();
	f.add(1, 1000, 1, [f.transfer(3000000n, 0)]);
	const call = f.process(3000000n, 0n, 0);
	call[2].index = 10;
	f.add(2, 1001, 0, call);
	f.add(3, 1001, 1, [f.transfer(1000000n, 5)]);
	f.setBalances(0n, 1000000n);
	await assert.rejects(
		inspectAllocation(f.input, f.rpc),
		/inconsistent_processing_order/,
	);
	const arc = fixture(5042002),
		credit = arc.transfer(3000000n, 0);
	credit.data = encodeAbiParameters(
		[{ type: "uint256" }],
		[3000000000000000001n],
	);
	arc.add(1, 1000, 1, [credit]);
	await assert.rejects(
		inspectAllocation(arc.input, arc.rpc),
		/unsupported_allocation_precision/,
	);
});

test("range, receipt, request and cancellation budgets bound operator work", async () => {
	const f = fixture();
	f.add(1, 1000, 1, [f.transfer(3000000n, 0)]);
	f.setBalances(0n, 3000000n);
	await assert.rejects(
		inspectAllocation({ ...f.input, throughBlock: "3048" }, f.rpc),
		/range_budget/,
	);
	const controller = new AbortController();
	controller.abort();
	const before = f.calls.length;
	await assert.rejects(inspectAllocation(f.input, f.rpc, controller.signal));
	assert.equal(f.calls.length, before);
	for (let i = 2; i <= 17; i++) f.add(i, 1001, i, [f.transfer(1000000n, i)]);
	await assert.rejects(inspectAllocation(f.input, f.rpc), /receipt_budget/);
	assert.ok(
		f.calls.filter((c) => c === "eth_getTransactionReceipt").length <= 17,
	);
	const many = fixture();
	many.add(1, 1000, 1, [many.transfer(3000000n, 0)]);
	many.input.throughBlock = "3047";
	for (let i = 2; i <= 15; i++)
		many.add(
			i,
			1000 + i,
			0,
			many.process(200000n, 3000000n - BigInt(i - 1) * 200000n, 0),
		);
	await assert.rejects(
		inspectAllocation(many.input, many.rpc),
		/request_budget/,
	);
	assert.equal(many.calls.length, 64);
	const interrupted = fixture();
	interrupted.add(1, 1000, 1, [interrupted.transfer(3000000n, 0)]);
	const stop = new AbortController();
	const stuck: AllocationRpc = (method, params, signal) => {
		if (method === "eth_getCode") {
			setTimeout(() => stop.abort(), 5);
			return new Promise(() => {});
		}
		return interrupted.rpc(method, params, signal);
	};
	await assert.rejects(
		inspectAllocation(interrupted.input, stuck, stop.signal),
		/allocation_deadline/,
	);
});

test("operator CLI verifies serialized provider receipts, permits only reads and suppresses provider errors", async () => {
	const f = fixture();
	f.add(1, 1000, 1, [f.transfer(3000000n, 0)]);
	f.add(2, 1001, 0, f.process(3000000n, 0n, 0));
	let mode: "valid" | "error" | "oversized" = "valid";
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const part of req) body += part;
		const call = JSON.parse(body);
		assert.equal(req.method, "POST");
		assert.ok(
			[
				"eth_chainId",
				"eth_getBlockByNumber",
				"eth_getTransactionReceipt",
				"eth_getLogs",
				"eth_call",
				"eth_getCode",
			].includes(call.method),
		);
		const result =
			mode === "oversized"
				? { result: "x".repeat(2 * 1024 * 1024) }
				: mode === "error"
					? { error: { message: "PRIVATE_PROVIDER_CREDENTIAL" } }
					: {
							result: await f.rpc(
								call.method,
								call.params,
								new AbortController().signal,
							),
						};
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...result }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const addr = server.address();
	assert.ok(addr && typeof addr !== "string");
	const port = addr.port;
	async function run(extended = false) {
		const child = spawn(
			process.execPath,
			[
				"--import",
				"tsx",
				"scripts/public-api/allocations.ts",
				"11155111",
				"steve",
				id(1),
				extended ? "18097" : "1005",
				...(extended ? ["--extended"] : []),
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
		const code = await new Promise<number | null>((resolve) =>
			child.on("close", resolve),
		);
		return { stdout, stderr, code };
	}
	try {
		const good = await run();
		assert.equal(good.code, 0, good.stderr);
		const report = JSON.parse(good.stdout);
		assert.equal(report.readOnly, true);
		assert.equal(report.evidence.windowClosed, true);
		assert.equal(report.evidence.deposits[0].amount, "3000000");
		assert.equal(
			report.evidence.processingCalls[0].processingId,
			`11155111:${id(2)}:2`,
		);
		assert.equal(report.evidence.rangeMode, "short");
		const long = await run(true);
		assert.equal(long.code, 0, long.stderr);
		const longReport = JSON.parse(long.stdout);
		assert.equal(longReport.evidence.rangeMode, "extended");
		assert.equal(longReport.evidence.throughBlock, "18097");
		assert.equal(longReport.evidence.windowClosed, true);
		assert.equal(longReport.evidence.limits.rpcCalls, 192);
		mode = "error";
		const failed = await run();
		assert.equal(failed.code, 1);
		assert.equal(failed.stdout, "");
		assert.doesNotMatch(failed.stderr, /PRIVATE_PROVIDER_CREDENTIAL/);
		assert.equal(
			JSON.parse(failed.stderr).error,
			"allocation_inspection_unavailable",
		);
		mode = "oversized";
		const oversized = await run();
		assert.equal(oversized.code, 1);
		assert.equal(oversized.stdout, "");
		assert.equal(
			JSON.parse(oversized.stderr).error,
			"allocation_inspection_unavailable",
		);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
