import { decodeEventLog, getAddress, parseAbi, toEventSelector } from "viem";
import { SERVER_CHAINS } from "../src/lib/chains";
import { depositAddress, normalizeLabel } from "../src/lib/namepass";

const TRANSFER = parseAbi([
	"event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const TOPIC = toEventSelector(TRANSFER[0]);
const NATIVE_SCALE = 1_000_000_000_000n;
type RawLog = {
	address: string;
	data: string;
	topics: string[];
	logIndex: string;
	transactionIndex: string;
	transactionHash: string;
	blockHash: string;
	blockNumber: string;
	removed?: boolean;
};
export type SourceReceipt = {
	transactionHash: string;
	transactionIndex: string;
	blockHash: string;
	blockNumber: string;
	status: string;
	logs: RawLog[];
};
export type SourceTransaction = {
	hash: string;
	from: string;
	to: string | null;
	value: string;
	transactionIndex: string;
	blockHash: string;
	blockNumber: string;
};
export type SourceBlock = { hash: string; number: string; timestamp: string };
export type RegisteredDepositAddress = { label: string; address: string; activatedAt: string };
export type IndexedSourceDeposit = {
	eventId: string;
	label: string;
	address: string;
	chainId: string;
	transactionHash: string;
	logIndex: number;
	blockNumber: string;
	sender: string | null;
	amount: string;
	tokenAddress: string;
	canonical: boolean;
	source: string;
	status: string;
	facts: Record<string, unknown>;
};
type Movement = { from: string; to: string; value: bigint; logIndex: number };
type Member = {
	sourceId: string;
	name: string;
	address: string;
	sender: string;
	amount: string | null;
	nativeAmount: string | null;
	receiptLogIndex: number;
	allocationLogIndex: number | null;
	publicLogIndex: number | null;
	kind: "erc20" | "native_top_level" | "native_internal" | "ambiguous";
	indexedEventId: string | null;
};
function quantity(value: string) {
	if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error("invalid_source_quantity");
	return BigInt(value);
}
function position(value: string) {
	const n = quantity(value);
	if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("invalid_source_position");
	return Number(n);
}
function hash(value: string) {
	if (!/^0x[0-9a-f]{64}$/i.test(value)) throw new Error("invalid_source_hash");
	return value.toLowerCase();
}
const address = (value: string) => getAddress(value).toLowerCase();
const movementKey = (m: Movement) => `${m.from}:${m.to}:${m.value}`;

/** Provider finality for one source block. Independent of indexed membership and payment completion. */
export function sourceFinalityEvidence(input: {
	source: SourceBlock;
	finalized: SourceBlock;
	canonicalSource: SourceBlock;
	canonicalFinalized: SourceBlock;
}) {
	const observation = (block: SourceBlock) => ({
		number: quantity(block.number),
		hash: hash(block.hash),
		timestamp: quantity(block.timestamp),
	});
	const source = observation(input.source), finalized = observation(input.finalized);
	for (const [before, after] of [
		[source, observation(input.canonicalSource)],
		[finalized, observation(input.canonicalFinalized)],
	]) {
		if (before.number !== after.number || before.hash !== after.hash || before.timestamp !== after.timestamp)
			throw new Error("source_finality_boundary_changed");
	}
	if (
		(source.number === finalized.number && (source.hash !== finalized.hash || source.timestamp !== finalized.timestamp)) ||
		(source.number < finalized.number && source.timestamp > finalized.timestamp) ||
		(source.number > finalized.number && source.timestamp < finalized.timestamp)
	) throw new Error("inconsistent_source_finality");
	return {
		policy: "configured RPC finalized tag" as const,
		sourceBlock: { number: source.number.toString(), hash: source.hash },
		finalizedBlock: { number: finalized.number.toString(), hash: finalized.hash },
		providerFinalized: source.number <= finalized.number,
	};
}

/** Discovery evidence only. A represented receipt set is not payment completion or historical watch coverage. */
export function sourceDepositEvidence(input: {
	chainId: string;
	transactionHash: string;
	receipt: SourceReceipt;
	transaction: SourceTransaction;
	block: SourceBlock;
	registry: RegisteredDepositAddress[];
	watchedAddresses: string[];
	indexed: IndexedSourceDeposit[];
}) {
	const chain = SERVER_CHAINS.find((c) => String(c.chainId) === input.chainId);
	if (!chain) throw new Error("unsupported_source_chain");
	const txHash = hash(input.transactionHash),
		receipt = input.receipt,
		tx = input.transaction,
		block = input.block;
	if (
		hash(receipt.transactionHash) !== txHash ||
		hash(tx.hash) !== txHash ||
		quantity(receipt.status) !== 1n ||
		hash(receipt.blockHash) !== hash(block.hash) ||
		hash(tx.blockHash) !== hash(block.hash) ||
		quantity(receipt.blockNumber) !== quantity(block.number) ||
		quantity(tx.blockNumber) !== quantity(block.number) ||
		position(receipt.transactionIndex) !== position(tx.transactionIndex)
	)
		throw new Error("inconsistent_source_receipt");
	if (receipt.logs.length > 10_000 || input.registry.length > 1_000 || input.indexed.length > 1_000)
		throw new Error("source_evidence_limit");
	const token = address(chain.usdcAddress),
		timestamp = quantity(block.timestamp);
	if (chain.nativeUsdcTransfer && timestamp < BigInt(chain.nativeUsdcTransfer.activationTimestamp))
		throw new Error("unsupported_arc_history");
	const nativeEmitter = chain.nativeUsdcTransfer && address(chain.nativeUsdcTransfer.emitter);
	const topLevelRecipient = tx.to ? address(tx.to) : null;
	const names = new Map<string, RegisteredDepositAddress>();
	for (const n of input.registry) {
		const a = address(n.address);
		if (
			normalizeLabel(n.label) !== n.label ||
			address(depositAddress(n.label)) !== a ||
			!Number.isFinite(Date.parse(n.activatedAt)) ||
			names.has(a)
		)
			throw new Error("inconsistent_address_registry");
		names.set(a, n);
	}
	const watched = new Set(input.watchedAddresses.map(address));
	const erc20: Movement[] = [],
		native: Movement[] = [];
	let previous = -1;
	for (const log of receipt.logs) {
		const index = position(log.logIndex);
		if (
			log.removed ||
			index <= previous ||
			hash(log.transactionHash) !== txHash ||
			hash(log.blockHash) !== hash(block.hash) ||
			quantity(log.blockNumber) !== quantity(block.number) ||
			position(log.transactionIndex) !== position(tx.transactionIndex)
		)
			throw new Error("inconsistent_receipt_log");
		previous = index;
		const emitter = address(log.address);
		if (![token, nativeEmitter].includes(emitter) || log.topics[0]?.toLowerCase() !== TOPIC)
			continue;
		let event;
		try {
			event = decodeEventLog({
				abi: TRANSFER,
				data: log.data as `0x${string}`,
				topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
				strict: true,
			});
		} catch {
			throw new Error("malformed_usdc_transfer");
		}
		const m = {
			from: address(event.args.from),
			to: address(event.args.to),
			value: event.args.value,
			logIndex: index,
		};
		// Zero and self transfers do not deliver funds to a deposit address.
		if (m.value === 0n || m.from === m.to) continue;
		(emitter === token ? erc20 : native).push(m);
	}
	const members: Member[] = [],
		issues: string[] = [];
	const add = (m: Movement, kind: Member["kind"], isNative: boolean, allocationLogIndex: number | null = m.logIndex) => {
		const n = names.get(m.to);
		if (!n) return;
		const exact = !isNative || m.value % NATIVE_SCALE === 0n;
		if (!exact) issues.push("unsupported_native_precision");
		members.push({
			sourceId: `${input.chainId}:${txHash}:${isNative ? "native:" : ""}${m.logIndex}`,
			name: `${n.label}.eth`,
			address: m.to,
			sender: m.from,
			amount: exact ? (isNative ? m.value / NATIVE_SCALE : m.value).toString() : null,
			nativeAmount: isNative ? m.value.toString() : null,
			receiptLogIndex: m.logIndex,
			allocationLogIndex,
			publicLogIndex: isNative ? null : m.logIndex,
			kind,
			indexedEventId: null,
		});
	};
	if (!nativeEmitter) {
		for (const m of erc20) add(m, "erc20", false);
	} else {
		// System transfers are the complete Arc movement stream. ERC-20 mirrors are not extra deposits.
		const groups = new Map<string, { native: Movement[]; erc20: Movement[] }>();
		for (const m of native) {
			const key = movementKey(m);
			const g = groups.get(key) ?? { native: [], erc20: [] };
			g.native.push(m);
			groups.set(key, g);
		}
		for (const m of erc20) {
			const key = movementKey({ ...m, value: m.value * NATIVE_SCALE });
			const g = groups.get(key) ?? { native: [], erc20: [] };
			g.erc20.push(m);
			groups.set(key, g);
		}
		for (const g of groups.values()) {
			if (g.erc20.length > g.native.length) throw new Error("missing_arc_system_transfer");
			if (g.erc20.length && g.native.length !== g.erc20.length) {
				if (g.native.some((m) => names.has(m.to))) issues.push("ambiguous_arc_mirror_mapping");
				for (const m of g.native) add(m, "ambiguous", true);
			} else if (g.erc20.length) {
				// Equal movements with several mirrors have no unique per-credit system-log join.
				for (const m of g.erc20) add(m, "erc20", false, g.native.length === 1 ? g.native[0].logIndex : null);
			} else {
				const top = g.native.filter(
					(m) =>
						tx.to &&
						m.to === address(tx.to) &&
						m.from === address(tx.from) &&
						m.value === quantity(tx.value),
				);
				for (const m of g.native)
					add(m, top.length === 1 && m === top[0] ? "native_top_level" : "native_internal", true);
				if (top.length > 1 && g.native.some((m) => names.has(m.to)))
					issues.push("ambiguous_native_top_level");
			}
		}
		if (
			quantity(tx.value) > 0n &&
			topLevelRecipient &&
			names.has(topLevelRecipient) &&
			!native.some(
				(m) =>
					m.from === address(tx.from) &&
					m.to === topLevelRecipient &&
					m.value === quantity(tx.value),
			)
		)
			throw new Error("missing_native_top_level_transfer");
	}
	members.sort((a, b) => a.receiptLogIndex - b.receiptLogIndex);
	const rows = new Map<string, IndexedSourceDeposit>();
	for (const row of input.indexed) {
		if (rows.has(row.eventId)) {
			if (JSON.stringify(rows.get(row.eventId)) !== JSON.stringify(row))
				throw new Error("conflicting_index_delivery");
			continue;
		}
		rows.set(row.eventId, row);
	}
	const matched = new Set<string>();
	for (const m of members) {
		if (m.kind === "native_internal" || m.kind === "ambiguous" || m.amount === null) continue;
		const nativeRow = m.kind === "native_top_level";
		const candidates = [...rows.values()].filter(
			(row) =>
				row.chainId === input.chainId &&
				row.transactionHash.toLowerCase() === txHash &&
				row.blockNumber === quantity(block.number).toString() &&
				row.canonical &&
				row.status !== "orphaned" &&
				row.source === "goldsky" &&
				row.label + ".eth" === m.name &&
				address(row.address) === m.address &&
				row.sender !== null &&
				address(row.sender) === m.sender &&
				row.amount === m.amount &&
				address(row.tokenAddress) === token &&
				row.eventId.startsWith(`${input.chainId}:native:`) === nativeRow &&
				row.logIndex === (nativeRow ? position(tx.transactionIndex) : m.receiptLogIndex) &&
				String(row.facts.amount) === m.amount &&
				String(row.facts.recipient_address).toLowerCase() === m.address &&
				String(row.facts.sender_address).toLowerCase() === m.sender &&
				String(row.facts.token_address).toLowerCase() === token,
		);
		if (candidates.length > 1 || candidates.some((row) => matched.has(row.eventId))) {
			issues.push("ambiguous_index_identity");
			continue;
		}
		if (candidates.length === 1) {
			m.indexedEventId = candidates[0].eventId;
			matched.add(candidates[0].eventId);
		}
	}
	const missing = members.filter((m) => !m.indexedEventId).map((m) => m.sourceId);
	const extra = [...rows.keys()].filter((id) => !matched.has(id));
	const unwatched = members.filter((m) => !watched.has(m.address)).map((m) => m.address);
	const activatedAfterSource = members
		.filter((m) => BigInt(Date.parse(names.get(m.address)!.activatedAt)) > timestamp * 1000n)
		.map((m) => m.address);
	const unregisteredRecipients = [
		...new Set((nativeEmitter ? native : erc20).filter((m) => !names.has(m.to)).map((m) => m.to)),
	];
	const representationComplete = members.length > 0 && !missing.length && !extra.length && !unwatched.length && !issues.length;
	return {
		chainId: input.chainId,
		transactionHash: txHash,
		blockNumber: quantity(block.number).toString(),
		blockHash: hash(block.hash),
		scope: "current activated-name registry" as const,
		members,
		missingIndexedMembers: missing,
		unmatchedIndexedRows: extra,
		unregisteredRecipients,
		unwatchedAddresses: [...new Set(unwatched)],
		activatedAfterSource: [...new Set(activatedAfterSource)],
		issues: [...new Set(issues)],
		representationComplete,
		// Without a label, an unknown recipient cannot be excluded as a counterfactual ENS wallet.
		receiptSetClosed: representationComplete && !unregisteredRecipients.length,
		coverage:
			"Current watch membership only; historical propagation and unregistered deterministic addresses are not proven.",
	};
}
