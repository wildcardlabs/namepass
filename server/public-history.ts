import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import {
	createPublicClient,
	decodeEventLog,
	http,
	keccak256,
	parseAbi,
	stringToHex,
	type Hex,
	type TransactionReceipt,
} from "viem";
import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { depositAddress, InvalidLabelError, normalizeLabel } from "../src/lib/namepass";
import { ApiError, json, pathSegment } from "./http";
import { indexedRenewalSegment } from "./indexed-renewal";
import type { GoldskyEvent } from "./goldsky";
import { logOperation } from "./log";

const HEADERS = {
	"cache-control": "no-store",
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-headers": "Content-Type",
	"access-control-expose-headers": "Retry-After",
	"x-content-type-options": "nosniff",
};
const CLAIM = parseAbi([
	"event CCTPClaimed(bytes32 indexed nonce, address indexed wallet, uint32 sourceDomain, uint256 burnAmount, uint256 feeExecuted, uint256 mintedAmount)",
]);
let pool: Pool | undefined;
let activeRequests = 0;
function historyPool() {
	if (!pool) {
		if (!process.env.DATABASE_URL) throw new Error("History database is unavailable.");
		pool = new Pool({
			connectionString: process.env.DATABASE_URL,
			max: 2,
			connectionTimeoutMillis: 5000,
			query_timeout: 7000,
			options:
				"-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1500 -c idle_in_transaction_session_timeout=10000",
		});
		attachDatabasePool(pool);
	}
	return pool;
}
type Cursor = [1, string, string, string, number, string];
type Row = {
	event_id: string;
	chain_id: string;
	tx_hash: string;
	log_index: number;
	block_number: string;
	block_time: Date | string;
	facts: Record<string, unknown>;
	flow_id: string;
	origin_chain_id: string;
	cctp_nonce: string | null;
	amount_processed: string | null;
};
function pagination(request: Request, label: string) {
	const params = new URL(request.url).searchParams;
	if (
		[...params.keys()].some((key) => !["limit", "cursor"].includes(key)) ||
		[...new Set(params.keys())].some((key) => params.getAll(key).length !== 1)
	)
		throw new ApiError(400, "invalid_pagination", "Use one limit and one cursor parameter.");
	const rawLimit = params.get("limit");
	if (rawLimit !== null && !/^[1-9][0-9]{0,2}$/.test(rawLimit))
		throw new ApiError(400, "invalid_pagination", "limit must be an integer from 1 to 100.");
	const limit = rawLimit === null ? 20 : Number(rawLimit);
	if (limit > 100) throw new ApiError(400, "invalid_pagination", "limit must be an integer from 1 to 100.");
	const raw = params.get("cursor");
	let cursor: Cursor | undefined;
	if (raw !== null) {
		try {
			if (!raw || raw.length > 1536 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
			const bytes = Buffer.from(raw, "base64url");
			if (bytes.toString("base64url") !== raw) throw new Error();
			const value = JSON.parse(bytes.toString("utf8"));
			if (
				!Array.isArray(value) ||
				value.length !== 6 ||
				value[0] !== 1 ||
				value[1] !== label ||
				typeof value[2] !== "string" ||
				new Date(value[2]).toISOString() !== value[2] ||
				typeof value[3] !== "string" ||
				!/^0x[0-9a-f]{64}$/.test(value[3]) ||
				!Number.isSafeInteger(value[4]) ||
				value[4] < 0 ||
				value[4] > 2147483647 ||
				typeof value[5] !== "string" ||
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value[5])
			)
				throw new Error();
			cursor = value as Cursor;
		} catch {
			throw new ApiError(400, "invalid_pagination", "cursor must be a valid nextCursor for this name.");
		}
	}
	return { limit, cursor };
}
async function candidates(label: string, limit: number, cursor?: Cursor) {
	const client = await historyPool().connect();
	let discard = false;
	try {
		await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
		const name = (
			await client.query<{ id: string; current_expiry: Date | null }>(
				"SELECT id,current_expiry FROM names WHERE normalized_label=$1",
				[label],
			)
		).rows[0];
		if (!name)
			throw new ApiError(
				404,
				"name_not_found",
				"This name has not been activated. Retrieve its deposit address first.",
			);
		const rows = (
			await client.query<Row>(
				`SELECT e.event_id,e.chain_id::text,e.tx_hash,e.log_index,e.block_number::text,e.block_time,e.facts,f.id::text AS flow_id,f.origin_chain_id::text,f.cctp_nonce::text,f.amount_processed::text
   FROM chain_events e JOIN flows f ON f.renewal_event_id=e.event_id
   WHERE f.name_id=$1 AND e.canonical=true AND e.event_family='namepass' AND e.event_type='Renewed' AND e.chain_id=$2
   ${cursor ? "AND (e.block_time,lower(e.tx_hash),e.log_index,f.id)<($3::timestamptz,$4,$5::integer,$6::uuid)" : ""}
   ORDER BY e.block_time DESC,lower(e.tx_hash) DESC,e.log_index DESC,f.id DESC LIMIT ${cursor ? "$7" : "$3"}`,
				cursor
					? [name.id, String(HUB_CHAIN.chainId), cursor[2], cursor[3], cursor[4], cursor[5], limit + 1]
					: [name.id, String(HUB_CHAIN.chainId), limit + 1],
			)
		).rows;
		await client.query("COMMIT");
		return { name, rows };
	} catch (error) {
		discard = !(error instanceof ApiError);
		await client.query("ROLLBACK").catch(() => {
			discard = true;
		});
		throw error;
	} finally {
		client.release(discard);
	}
}
function receiptItem(
	row: Row,
	label: string,
	receipt: TransactionReceipt,
	block: { hash: Hex | null; timestamp: bigint; number: bigint | null },
) {
	if (
		receipt.status !== "success" ||
		receipt.transactionHash.toLowerCase() !== row.tx_hash.toLowerCase() ||
		receipt.blockNumber !== BigInt(row.block_number) ||
		block.number !== receipt.blockNumber ||
		receipt.blockHash !== block.hash ||
		block.timestamp * 1000n !== BigInt(new Date(row.block_time).getTime())
	)
		throw new Error("Renewal receipt is not canonical indexed evidence.");
	const facts = row.facts;
	if (
		facts.label !== label ||
		String(facts.label_hash).toLowerCase() !== keccak256(stringToHex(label)) ||
		String(facts.wallet_address).toLowerCase() !== depositAddress(label).toLowerCase()
	)
		throw new Error("Renewal does not belong to this name.");
	const event = { logIndex: row.log_index, facts } as GoldskyEvent;
	const segment = indexedRenewalSegment(receipt, event);
	let source = String(HUB_CHAIN.chainId);
	if (String(facts.from_cctp) === "true") {
		const claims = segment.flatMap((log) => {
			if (log.address.toLowerCase() !== HUB_CHAIN.gatewayAddress!.toLowerCase()) return [];
			try {
				return [decodeEventLog({ abi: CLAIM, ...log, strict: true }).args];
			} catch {
				return [];
			}
		});
		if (claims.length !== 1) throw new Error("No exact claim segment.");
		const claim = claims[0];
		const chain = SERVER_CHAINS.find((chain) => chain.circleDomain === claim.sourceDomain);
		if (
			!chain ||
			claim.wallet.toLowerCase() !== String(facts.wallet_address).toLowerCase() ||
			claim.feeExecuted > claim.burnAmount ||
			claim.burnAmount - claim.feeExecuted !== claim.mintedAmount ||
			claim.mintedAmount !== BigInt(String(facts.amount_received)) ||
			BigInt(claim.nonce).toString() !== row.cctp_nonce ||
			claim.burnAmount.toString() !== row.amount_processed
		)
			throw new Error("Claim provenance does not match this flow.");
		source = String(chain.chainId);
	} else if (String(facts.from_cctp) !== "false" || row.cctp_nonce !== null)
		throw new Error("Unknown renewal route.");
	else if (row.amount_processed !== String(facts.amount_received))
		throw new Error("Direct flow amount does not match its renewal.");
	if (source !== row.origin_chain_id) throw new Error("Flow source chain does not match renewal.");
	const integer = (key: string) => {
		const value = String(facts[key]);
		if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid renewal amount.");
		return value;
	};
	return {
		renewalId: `${HUB_CHAIN.chainId}:${row.tx_hash.toLowerCase()}:${row.log_index}`,
		flowId: row.flow_id,
		sourceChainId: source,
		chainId: String(HUB_CHAIN.chainId),
		transactionHash: row.tx_hash.toLowerCase(),
		secondsAdded: integer("duration"),
		amountApplied: integer("amount_applied"),
		renewalFee: integer("gas_allowance"),
		expiry: null,
		status: "processing" as const,
		renewedAt: new Date(row.block_time).toISOString(),
	};
}
async function history(request: Request, signal: AbortSignal) {
	signal.throwIfAborted();
	let label: string;
	try {
		const input = pathSegment(request, "renewals");
		if (input.length > 512) throw new ApiError(400, "invalid_name", "Name is too long.");
		label = normalizeLabel(input);
	} catch (error) {
		if (error instanceof InvalidLabelError) throw new ApiError(400, "invalid_name", error.message);
		throw error;
	}
	const { limit, cursor } = pagination(request, label);
	const { name, rows } = await candidates(label, limit, cursor);
	signal.throwIfAborted();
	const page = rows.slice(0, limit);
	const items: Array<ReturnType<typeof receiptItem>> = [];
	if (page.length) {
		const url = process.env[HUB_CHAIN.rpcEnv];
		if (!url) throw new Error("Receipt RPC is unavailable.");
		let operations = 0;
		const client = createPublicClient({
			cacheTime: 0,
			transport: http(url, {
				retryCount: 0,
				timeout: 10000,
				fetchFn: async (url, init) => {
					const payload = JSON.parse(String(init?.body));
					const calls = Array.isArray(payload) ? payload : [payload];
					operations += calls.length;
					if (
						operations > 201 ||
						calls.some(
							(call) =>
								!["eth_chainId", "eth_getTransactionReceipt", "eth_getBlockByNumber"].includes(call.method),
						)
					)
						throw new Error("History RPC budget exceeded.");
					return fetch(url, {
						...init,
						signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
					});
				},
			}),
		});
		if ((await client.getChainId()) !== HUB_CHAIN.chainId) throw new Error("Wrong receipt chain.");
		const receipts = new Map<string, Promise<TransactionReceipt>>();
		const blocks = new Map<string, ReturnType<typeof client.getBlock>>();
		const receiptFor = (hash: string) => {
			let result = receipts.get(hash);
			if (!result) {
				result = client.getTransactionReceipt({ hash: hash as Hex });
				receipts.set(hash, result);
			}
			return result;
		};
		const blockFor = (number: string) => {
			let result = blocks.get(number);
			if (!result) {
				result = client.getBlock({ blockNumber: BigInt(number) });
				blocks.set(number, result);
			}
			return result;
		};
		// At most four logical RPC calls are in flight. All workers finish before request capacity is released.
		let next = 0;
		let failed: unknown;
		await Promise.all(
			Array.from({ length: Math.min(2, page.length) }, async () => {
				while (!failed && next < page.length) {
					const index = next++;
					const row = page[index];
					try {
						signal.throwIfAborted();
						const [receipt, block] = await Promise.all([
							receiptFor(row.tx_hash.toLowerCase()),
							blockFor(row.block_number),
						]);
						items[index] = receiptItem(row, label, receipt, block);
					} catch (error) {
						failed = error;
					}
				}
			}),
		);
		if (failed) throw failed;
	}
	const last = page[page.length - 1];
	return {
		name: `${label}.eth`,
		currentExpiry: name.current_expiry ? new Date(name.current_expiry).toISOString() : null,
		expiryUpdatedAt: null,
		items,
		nextCursor:
			rows.length > limit && last
				? Buffer.from(
						JSON.stringify([
							1,
							label,
							new Date(last.block_time).toISOString(),
							last.tx_hash.toLowerCase(),
							last.log_index,
							last.flow_id,
						]),
					).toString("base64url")
				: null,
	};
}
export const publicHistory = {
	async fetch(request: Request): Promise<Response> {
		const requestId = crypto.randomUUID();
		const error = (status: number, code: string, message: string) =>
			json({ error: { code, message }, requestId }, status, {
				...HEADERS,
				...([429, 503].includes(status) ? { "retry-after": "5" } : {}),
			});
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
		if (request.method !== "GET")
			return json({ error: { code: "method_not_allowed", message: "Use GET." }, requestId }, 405, {
				...HEADERS,
				allow: "GET, OPTIONS",
			});
		if (process.env.NAMEPASS_PUBLIC_HISTORY_ENABLED !== "1")
			return error(503, "api_unavailable", "The history API is not enabled.");
		if (process.env.NAMEPASS_MAINTENANCE === "1")
			return error(503, "maintenance", "Namepass is being upgraded. Try again later.");
		if (activeRequests >= 2)
			return error(429, "history_capacity", "History capacity is busy. Retry after the indicated delay.");
		activeRequests++;
		try {
			const result = await history(request, AbortSignal.any([request.signal, AbortSignal.timeout(15000)]));
			logOperation("public_history.response", { requestId, step: "history" });
			return json(result, 200, { ...HEADERS, ...(result.items.length ? { "retry-after": "5" } : {}) });
		} catch (cause) {
			logOperation("public_history.error", {
				requestId,
				step: "history",
				errorCode: cause instanceof ApiError ? cause.code : "history_unavailable",
			});
			return cause instanceof ApiError
				? error(cause.status, cause.code, cause.message)
				: error(
						503,
						"history_unavailable",
						"Verified renewal history is temporarily unavailable. Try again later.",
					);
		} finally {
			activeRequests--;
		}
	},
};
