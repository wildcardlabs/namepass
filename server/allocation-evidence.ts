import {
	decodeEventLog,
	getAddress,
	keccak256,
	parseAbi,
	stringToHex,
	toEventSelector,
} from "viem";
import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { depositAddress, normalizeLabel } from "../src/lib/namepass";
import { parseOriginBurnReceipt } from "../workflows/cctp";
import type { SourceBlock, SourceReceipt } from "./source-deposit-evidence";

const TRANSFER = parseAbi([
	"event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const PROCESSED = parseAbi([
	"event DepositProcessed(bytes32 indexed labelKey,address indexed wallet,uint256 amount,uint256 remaining)",
]);
const RENEWED = parseAbi([
	"event Renewed(bytes32 indexed labelHash,address indexed wallet,address indexed executor,string label,uint64 duration,uint256 amountReceived,uint256 gasAllowance,uint256 amountApplied,uint256 remainder,bool fromCCTP)",
]);
// Reviewed deployment, docs/deployments/2026-09-22/verification.json. Not a generic factory allowlist.
const FACTORY_HASH =
	"0x3822dfc2cbf9fe25fbe5258eb13cf8be999c1b776c361fbd220f9412b96659e1";
const SCALE = 1_000_000_000_000n;
const METHODS = [
	"eth_chainId",
	"eth_getBlockByNumber",
	"eth_getTransactionReceipt",
	"eth_getLogs",
	"eth_call",
	"eth_getCode",
];
type Log = SourceReceipt["logs"][number];
export type AllocationRpc = (
	method: string,
	params: unknown[],
	signal: AbortSignal,
) => Promise<unknown>;
function fail(code: string): never {
	throw new Error(code);
}
function quantity(value: string): bigint {
	if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))
		fail("invalid_allocation_quantity");
	return BigInt(value);
}
function hash(value: string) {
	if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value))
		fail("invalid_allocation_hash");
	return value.toLowerCase();
}
function position(value: string) {
	const n = quantity(value);
	if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail("invalid_allocation_position");
	return Number(n);
}
const address = (value: string) => getAddress(value).toLowerCase();
const hex = (n: bigint) => `0x${n.toString(16)}`;
const logId = (l: Log) => `${hash(l.transactionHash)}:${position(l.logIndex)}`;
function sameLog(a: Log, b: Log) {
	return (
		hash(a.blockHash) === hash(b.blockHash) &&
		quantity(a.blockNumber) === quantity(b.blockNumber) &&
		position(a.transactionIndex) === position(b.transactionIndex) &&
		logId(a) === logId(b) &&
		address(a.address) === address(b.address) &&
		a.data.toLowerCase() === b.data.toLowerCase() &&
		a.topics.map((t) => t.toLowerCase()).join(":") ===
			b.topics.map((t) => t.toLowerCase()).join(":") &&
		!a.removed &&
		!b.removed
	);
}
function ordered(a: Log, b: Log) {
	return (
		Number(quantity(a.blockNumber) - quantity(b.blockNumber)) ||
		position(a.transactionIndex) - position(b.transactionIndex) ||
		position(a.logIndex) - position(b.logIndex)
	);
}

/** Bounded operator evidence for one wallet. This is not transaction status or renewal finality. */
export async function inspectAllocation(
	input: {
		chainId: string;
		label: string;
		transactionHash: string;
		throughBlock: string;
		rangeMode?: "short" | "extended";
	},
	rpc: AllocationRpc,
	cancellation?: AbortSignal,
) {
	const chain = SERVER_CHAINS.find((c) => String(c.chainId) === input.chainId);
	if (
		!chain?.factoryAddress ||
		(input.rangeMode !== undefined &&
			input.rangeMode !== "short" &&
			input.rangeMode !== "extended") ||
		!/^(0|[1-9][0-9]*)$/.test(input.throughBlock) ||
		normalizeLabel(input.label) !== input.label
	)
		fail("invalid_allocation_arguments");
	const txHash = hash(input.transactionHash),
		wallet = address(depositAddress(input.label));
	// Extended inspection is an explicit operator audit, never a larger public polling budget.
	const rangeMode = input.rangeMode ?? "short";
	const limits =
		rangeMode === "extended"
			? { blocks: 32768, rpcCalls: 192, deadlineMs: 60000 }
			: { blocks: 2048, rpcCalls: 64, deadlineMs: 15000 };
	const end = BigInt(input.throughBlock),
		emitter = address(chain.nativeUsdcTransfer?.emitter ?? chain.usdcAddress);
	const scale = chain.nativeUsdcTransfer ? SCALE : 1n;
	const signal = cancellation
		? AbortSignal.any([AbortSignal.timeout(limits.deadlineMs), cancellation])
		: AbortSignal.timeout(limits.deadlineMs);
	let requests = 0;
	async function read<T>(method: string, params: unknown[]): Promise<T> {
		if (!METHODS.includes(method) || ++requests > limits.rpcCalls)
			fail("allocation_request_budget");
		signal.throwIfAborted();
		let abort: () => void = () => {};
		try {
			const timeout = new Promise<never>((_, reject) => {
				abort = () => reject(new Error("allocation_deadline"));
				signal.addEventListener("abort", abort, { once: true });
			});
			return (await Promise.race([rpc(method, params, signal), timeout])) as T;
		} finally {
			signal.removeEventListener("abort", abort);
		}
	}
	if (quantity(await read<string>("eth_chainId", [])) !== BigInt(input.chainId))
		fail("wrong_allocation_chain");
	const blockCache = new Map<string, SourceBlock>();
	async function block(number: string) {
		const key = quantity(number).toString();
		if (!blockCache.has(key)) {
			const b = await read<SourceBlock>("eth_getBlockByNumber", [
				number,
				false,
			]);
			if (!b || quantity(b.number).toString() !== key)
				fail("inconsistent_allocation_block");
			hash(b.hash);
			quantity(b.timestamp);
			blockCache.set(key, b);
		}
		return blockCache.get(key)!;
	}
	const receiptCache = new Map<string, SourceReceipt>();
	async function receipt(tx: string) {
		const id = hash(tx);
		if (!receiptCache.has(id)) {
			if (receiptCache.size >= 16) fail("allocation_receipt_budget");
			const r = await read<SourceReceipt>("eth_getTransactionReceipt", [id]);
			if (
				!r ||
				hash(r.transactionHash) !== id ||
				quantity(r.status) !== 1n ||
				!Array.isArray(r.logs) ||
				r.logs.length > 10000
			)
				fail("inconsistent_allocation_receipt");
			const b = await block(r.blockNumber);
			if (hash(b.hash) !== hash(r.blockHash))
				fail("noncanonical_allocation_receipt");
			let previous = -1;
			for (const l of r.logs) {
				const index = position(l.logIndex);
				if (
					l.removed ||
					index <= previous ||
					hash(l.transactionHash) !== id ||
					hash(l.blockHash) !== hash(r.blockHash) ||
					quantity(l.blockNumber) !== quantity(r.blockNumber) ||
					position(l.transactionIndex) !== position(r.transactionIndex)
				)
					fail("inconsistent_allocation_log");
				previous = index;
			}
			receiptCache.set(id, r);
		}
		return receiptCache.get(id)!;
	}
	const source = await receipt(txHash),
		start = quantity(source.blockNumber);
	if (start === 0n || end < start || end - start >= BigInt(limits.blocks))
		fail("allocation_range_budget");
	const initial = await block(source.blockNumber),
		terminal = await block(hex(end));
	if (
		chain.nativeUsdcTransfer &&
		quantity(initial.timestamp) <
			BigInt(chain.nativeUsdcTransfer.activationTimestamp)
	)
		fail("unsupported_arc_history");
	const codeCache = new Set<string>();
	async function factoryAt(number: string) {
		const key = quantity(number).toString();
		if (!codeCache.has(key)) {
			const code = await read<string>("eth_getCode", [
				chain!.factoryAddress,
				number,
			]);
			if (
				!/^0x(?:[0-9a-f]{2})+$/i.test(code) ||
				keccak256(code as `0x${string}`) !== FACTORY_HASH
			)
				fail("unsupported_allocation_factory");
			codeCache.add(key);
		}
	}
	await factoryAt(source.blockNumber);
	function movement(l: Log) {
		if (
			address(l.address) !== emitter ||
			l.topics[0]?.toLowerCase() !== toEventSelector(TRANSFER[0])
		)
			return null;
		const { from, to, value } = decodeEventLog({
			abi: TRANSFER,
			data: l.data as `0x${string}`,
			topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
			strict: true,
		}).args;
		const f = address(from),
			t = address(to);
		if (value === 0n || f === t || (f !== wallet && t !== wallet)) return null;
		if (value % scale !== 0n) fail("unsupported_allocation_precision");
		return { log: l, from: f, to: t, amount: value / scale };
	}
	const topic = `0x${"0".repeat(24)}${wallet.slice(2)}`,
		logs = new Map<string, Log>();
	for (let from = start; from <= end; from += 512n) {
		const to = from + 511n < end ? from + 511n : end;
		for (const outgoing of [false, true]) {
			const found = await read<Log[]>("eth_getLogs", [
				{
					address: emitter,
					fromBlock: hex(from),
					toBlock: hex(to),
					topics: outgoing
						? [toEventSelector(TRANSFER[0]), topic]
						: [toEventSelector(TRANSFER[0]), null, topic],
				},
			]);
			if (!Array.isArray(found) || found.length > 256)
				fail("allocation_log_budget");
			for (const l of found) {
				if (
					l.removed ||
					quantity(l.blockNumber) < from ||
					quantity(l.blockNumber) > to ||
					address(l.address) !== emitter
				)
					fail("inconsistent_allocation_range");
				const m = movement(l);
				if (!m) continue;
				if (outgoing ? m.from !== wallet : m.to !== wallet)
					fail("inconsistent_allocation_filter");
				const id = logId(l),
					previous = logs.get(id);
				if (previous && !sameLog(previous, l))
					fail("conflicting_allocation_delivery");
				logs.set(id, l);
				if (logs.size > 256) fail("allocation_log_budget");
			}
		}
	}
	// Source is independently fetched, even if a provider omits its whole transaction from getLogs.
	for (const tx of new Set([
		txHash,
		...[...logs.values()].map((l) => hash(l.transactionHash)),
	])) {
		const r = await receipt(tx);
		for (const l of r.logs) {
			if (!movement(l)) continue;
			const listed = logs.get(logId(l));
			if (!listed || !sameLog(listed, l)) fail("missing_allocation_movement");
		}
	}
	for (const l of logs.values()) {
		const r = await receipt(l.transactionHash),
			actual = r.logs.find(
				(other) => position(other.logIndex) === position(l.logIndex),
			);
		if (!actual || !sameLog(actual, l)) fail("unproven_allocation_movement");
	}
	const movements = [...logs.values()].sort(ordered).map((l) => movement(l)!);
	for (let i = 1; i < movements.length; i++) {
		const a = movements[i - 1].log,
			b = movements[i].log;
		if (
			quantity(a.blockNumber) === quantity(b.blockNumber) &&
			position(a.logIndex) >= position(b.logIndex)
		)
			fail("inconsistent_block_order");
	}
	type Call = {
		processingId: string;
		transactionHash: string;
		logIndex: number;
		blockNumber: string;
		amount: string;
		remaining: string;
		directRenewalId: string | null;
		cctpMessageIndex: number | null;
	};
	const calls = new Map<string, { call: Call; marker: Log }>();
	for (const r of receiptCache.values()) {
		const markers = r.logs.filter(
			(l) =>
				address(l.address) === address(chain.factoryAddress!) &&
				l.topics[0]?.toLowerCase() === toEventSelector(PROCESSED[0]),
		);
		for (let i = 0; i < markers.length; i++) {
			const marker = markers[i],
				p = decodeEventLog({
					abi: PROCESSED,
					data: marker.data as `0x${string}`,
					topics: marker.topics as [`0x${string}`, ...`0x${string}`[]],
					strict: true,
				}).args;
			if (address(p.wallet) !== wallet) continue;
			if (
				p.labelKey.toLowerCase() !== keccak256(stringToHex(input.label)) ||
				p.amount === 0n
			)
				fail("inconsistent_processing_label");
			const lower = i ? position(markers[i - 1].logIndex) : -1;
			const segment = r.logs.filter(
				(l) =>
					position(l.logIndex) > lower &&
					position(l.logIndex) < position(marker.logIndex),
			);
			const debits = segment.flatMap((l) => {
				const m = movement(l);
				return m?.from === wallet ? [m] : [];
			});
			if (debits.length !== 1 || debits[0].amount !== p.amount)
				fail("ambiguous_processing_debit");
			await factoryAt(r.blockNumber);
			const code = await read<string>("eth_getCode", [wallet, r.blockNumber]);
			if (
				code.toLowerCase() !==
				`0x363d3d373d3d3d363d73${address(chain.factoryAddress!).slice(2)}5af43d82803e903d91602b57fd5bf3`
			)
				fail("unsupported_allocation_wallet");
			let directRenewalId: string | null = null,
				cctpMessageIndex: number | null = null;
			if (chain.chainId === HUB_CHAIN.chainId) {
				if (debits[0].to !== address(HUB_CHAIN.gatewayAddress!))
					fail("unsupported_processing_destination");
				const renewals = segment.filter(
					(l) =>
						address(l.address) === address(HUB_CHAIN.gatewayAddress!) &&
						l.topics[0]?.toLowerCase() === toEventSelector(RENEWED[0]),
				);
				if (renewals.length !== 1) fail("ambiguous_direct_processing");
				const l = renewals[0],
					renewal = decodeEventLog({
						abi: RENEWED,
						data: l.data as `0x${string}`,
						topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
						strict: true,
					}).args;
				if (
					address(renewal.wallet) !== wallet ||
					renewal.label !== input.label ||
					renewal.labelHash.toLowerCase() !== p.labelKey.toLowerCase() ||
					renewal.fromCCTP ||
					renewal.amountReceived !== p.amount ||
					renewal.gasAllowance > p.amount ||
					renewal.amountApplied + renewal.remainder !==
						p.amount - renewal.gasAllowance
				)
					fail("inconsistent_direct_processing");
				directRenewalId = `${input.chainId}:${hash(r.transactionHash)}:${position(l.logIndex)}`;
			} else {
				const burn = parseOriginBurnReceipt(
					r.logs.map((l) => ({
						address: l.address as `0x${string}`,
						data: l.data as `0x${string}`,
						topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
						logIndex: position(l.logIndex),
					})),
					{
						originChainId: chain.chainId,
						wallet: wallet as `0x${string}`,
						label: input.label,
						labelHash: p.labelKey,
						amount: p.amount,
						depositLogIndex: position(marker.logIndex),
					},
				);
				if (burn.remaining !== p.remaining)
					fail("inconsistent_processing_remainder");
				cctpMessageIndex = burn.messageIndex;
			}
			const key = logId(debits[0].log);
			if (calls.has(key)) fail("ambiguous_processing_identity");
			calls.set(key, {
				marker,
				call: {
					processingId: `${input.chainId}:${hash(r.transactionHash)}:${position(marker.logIndex)}`,
					transactionHash: hash(r.transactionHash),
					logIndex: position(marker.logIndex),
					blockNumber: quantity(r.blockNumber).toString(),
					amount: p.amount.toString(),
					remaining: p.remaining.toString(),
					directRenewalId,
					cctpMessageIndex,
				},
			});
		}
	}
	async function balance(number: bigint) {
		return quantity(
			await read<string>("eth_call", [
				{ to: chain!.usdcAddress, data: `0x70a08231${topic.slice(2)}` },
				hex(number),
			]),
		);
	}
	const opening = await balance(start - 1n),
		closing = await balance(end);
	let current = opening;
	const deposits: {
		movementId: string;
		receiptLogIndex: number;
		amount: string;
		windowClosed: boolean;
		processingCallIds: string[];
	}[] = [];
	const ledger = [
		...movements.map((m) => ({
			log: m.log,
			movement: m,
			process: undefined as undefined | Call,
		})),
		...[...calls.values()].map((c) => ({
			log: c.marker,
			movement: undefined,
			process: c.call,
		})),
	].sort((a, b) => ordered(a.log, b.log));
	for (let i = 1; i < ledger.length; i++) {
		const a = ledger[i - 1].log,
			b = ledger[i].log;
		if (
			quantity(a.blockNumber) === quantity(b.blockNumber) &&
			position(a.logIndex) >= position(b.logIndex)
		)
			fail("inconsistent_processing_order");
	}
	const usedCalls: Call[] = [];
	for (const item of ledger) {
		if (item.movement) {
			const m = item.movement;
			if (m.to === wallet) {
				current += m.amount;
				if (hash(m.log.transactionHash) === txHash)
					deposits.push({
						movementId: `${input.chainId}:${logId(m.log)}`,
						receiptLogIndex: position(m.log.logIndex),
						amount: m.amount.toString(),
						windowClosed: false,
						processingCallIds: [],
					});
			} else {
				const pair = calls.get(logId(m.log));
				if (!pair || m.amount > current) fail("unproven_wallet_debit");
				current -= m.amount;
				usedCalls.push(pair.call);
				for (const d of deposits.filter((d) => !d.windowClosed))
					d.processingCallIds.push(pair.call.processingId);
			}
		} else {
			if (current.toString() !== item.process!.remaining)
				fail("inconsistent_wallet_drain");
			if (current === 0n)
				for (const d of deposits.filter((d) => !d.windowClosed))
					d.windowClosed = true;
		}
	}
	if (!deposits.length || current !== closing)
		fail("inconsistent_allocation_balance");
	// Recheck both boundaries after the entire proof. No finality inference from a stored status.
	for (const b of [initial, terminal]) {
		const fresh = await read<SourceBlock>("eth_getBlockByNumber", [
			b.number,
			false,
		]);
		if (
			!fresh ||
			hash(fresh.hash) !== hash(b.hash) ||
			quantity(fresh.number) !== quantity(b.number)
		)
			fail("allocation_boundary_changed");
	}
	return {
		scope: "one wallet source-to-processing window" as const,
		chainId: input.chainId,
		name: `${input.label}.eth`,
		depositAddress: wallet,
		transactionHash: txHash,
		fromBlock: start.toString(),
		throughBlock: end.toString(),
		fromBlockHash: hash(initial.hash),
		throughBlockHash: hash(terminal.hash),
		openingBalance: opening.toString(),
		closingBalance: closing.toString(),
		movements: movements.length,
		deposits,
		processingCalls: usedCalls,
		windowClosed: deposits.every((d) => d.windowClosed),
		rangeMode,
		limits,
		rpcCalls: requests,
		limitations:
			"Not API completion: registry/index coverage, source finality, cross-chain claim and finalized ENS renewal verification remain separate gates. Call lists describe whole shared windows, not per-deposit amount allocation.",
	};
}
