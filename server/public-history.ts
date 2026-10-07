import { admitPublicRequest } from "./public-admission";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import {
	createPublicClient,
	decodeEventLog,
	getAddress,
	http,
	keccak256,
	parseAbi,
	stringToHex,
	type Hex,
	type TransactionReceipt,
} from "viem";
import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { assertEnsV2Adapter } from "../src/lib/helperAdapter";
import { depositAddress, InvalidLabelError, normalizeLabel } from "../src/lib/namepass";
import { ApiError, json, pathSegment } from "./http";
import { indexedRenewalSegment } from "./indexed-renewal";
import { parseEnsRenewalExpiry, receiptHelper } from "./ens-renewal";
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
const HELPER = parseAbi([
	"event HelperUsed(address indexed helper, bytes32 indexed labelHash, address indexed wallet)",
	"function ethRegistrar() view returns (address)",
	"function ethRenewerV1() view returns (address)",
	"function referrer() view returns (bytes32)",
]);
const ENS_RENEWAL = parseAbi([
	"event NameRenewed(uint256 indexed tokenId, string label, uint64 duration, uint64 newExpiry, address paymentToken, bytes32 indexed referrer, uint256 amount)",
]);
const V1_METADATA = parseAbi(["function BASE_REGISTRAR() view returns (address)"]);
let pool: Pool | undefined;
let activeRequests = 0;
function historyPool() {
	if (!pool) {
		if (!process.env.DATABASE_URL) throw new Error("History database is unavailable.");
		// pg lets URL options override Pool options. Enforce this reader's settings in the URL itself.
		const connection = new URL(process.env.DATABASE_URL);
		connection.searchParams.set(
			"options",
			"-c default_transaction_read_only=on",
		);
		pool = new Pool({
			connectionString: connection.toString(),
			max: 2,
			connectionTimeoutMillis: 5000,
			query_timeout: 7000,
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
	if (limit > 100)
		throw new ApiError(400, "invalid_pagination", "limit must be an integer from 1 to 100.");
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
			throw new ApiError(
				400,
				"invalid_pagination",
				"cursor must be a valid nextCursor for this name.",
			);
		}
	}
	return { limit, cursor };
}
async function candidates(label: string, limit: number, cursor?: Cursor) {
	const client = await historyPool().connect();
	let discard = false;
	try {
		await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
		// Poolers reject startup timeout options; keep them local to this read.
		await client.query(
			"SET LOCAL statement_timeout = '5000ms'",
		);
		await client.query("SET LOCAL lock_timeout = '1500ms'");
		await client.query(
			"SET LOCAL idle_in_transaction_session_timeout = '10000ms'",
		);
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
					? [
							name.id,
							String(HUB_CHAIN.chainId),
							cursor[2],
							cursor[3],
							cursor[4],
							cursor[5],
							limit + 1,
						]
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
	let previousLog = -1;
	for (const log of receipt.logs) {
		if (
			log.removed ||
			log.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
			log.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase() ||
			log.blockNumber !== receipt.blockNumber ||
			!Number.isSafeInteger(log.logIndex) ||
			log.logIndex! <= previousLog
		)
			throw new Error("Receipt log membership is inconsistent.");
		previousLog = log.logIndex!;
	}
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
		segment,
		item: {
			renewalId: `${HUB_CHAIN.chainId}:${row.tx_hash.toLowerCase()}:${row.log_index}`,
			flowId: row.flow_id,
			sourceChainId: source,
			chainId: String(HUB_CHAIN.chainId),
			transactionHash: row.tx_hash.toLowerCase(),
			secondsAdded: integer("duration"),
			amountApplied: integer("amount_applied"),
			renewalFee: integer("gas_allowance"),
			expiry: null as string | null,
			status: "processing" as "processing" | "complete",
			renewedAt: new Date(row.block_time).toISOString(),
		},
	};
}
function selectedHelper(segment: TransactionReceipt["logs"], label: string) {
	const helper = receiptHelper(segment, label);
	const selection = segment.flatMap((log) => {
		if (getAddress(log.address) !== getAddress(HUB_CHAIN.gatewayAddress!)) return [];
		try {
			const event = decodeEventLog({ abi: HELPER, ...log, strict: true });
			return event.args.labelHash === keccak256(stringToHex(label)) ? [event.args] : [];
		} catch {
			return [];
		}
	});
	if (
		selection.length !== 1 ||
		getAddress(selection[0].wallet) !== getAddress(depositAddress(label))
	)
		throw new Error("Helper selection does not belong to this wallet.");
	return helper;
}
function eventExpiry(
	segment: TransactionReceipt["logs"],
	label: string,
	row: Row,
	metadata: { registrar: string; renewerV1: string; referrer: string; baseRegistrarV1?: string },
) {
	// ENS emitters are authenticated against the reviewed deployment, not arbitrary helper metadata.
	if (
		getAddress(metadata.registrar) !== getAddress(HUB_CHAIN.ensRegistrarAddress!) ||
		getAddress(metadata.renewerV1) !== getAddress(HUB_CHAIN.ensRenewerV1Address!) ||
		metadata.referrer.toLowerCase() !== HUB_CHAIN.ensReferrer!.toLowerCase()
	)
		throw new Error("Unsupported ENS renewal deployment.");
	const expiry = parseEnsRenewalExpiry(segment, { label, ...metadata });
	const events = segment.flatMap((log) => {
		if (
			![getAddress(metadata.registrar), getAddress(metadata.renewerV1)].includes(
				getAddress(log.address),
			)
		)
			return [];
		try {
			return [decodeEventLog({ abi: ENS_RENEWAL, ...log, strict: true }).args];
		} catch {
			return [];
		}
	});
	if (
		events.length !== 1 ||
		events[0].duration !== BigInt(String(row.facts.duration)) ||
		events[0].amount !== BigInt(String(row.facts.amount_applied))
	)
		throw new Error("ENS event does not match the gateway renewal.");
	return expiry.toISOString();
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
	const items: Array<ReturnType<typeof receiptItem>["item"]> = [];
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
						operations > 702 ||
						calls.some(
							(call) =>
								![
									"eth_chainId",
									"eth_getTransactionReceipt",
									"eth_getBlockByNumber",
									"eth_call",
									"eth_getCode",
								].includes(call.method),
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
		const metadata = new Map<
			string,
			Promise<{ registrar: string; renewerV1: string; referrer: string }>
		>();
		const metadataFor = (helper: `0x${string}`, blockNumber: bigint) => {
			const key = `${helper.toLowerCase()}:${blockNumber}`;
			let result = metadata.get(key);
			if (!result) {
				result = (async () => {
					// Sequential reads keep two workers within four RPC calls in flight.
					assertEnsV2Adapter(await client.getCode({ address: helper, blockNumber }));
					const registrar = await client.readContract({
						address: helper,
						abi: HELPER,
						functionName: "ethRegistrar",
						blockNumber,
					});
					const renewerV1 = await client.readContract({
						address: helper,
						abi: HELPER,
						functionName: "ethRenewerV1",
						blockNumber,
					});
					const referrer = await client.readContract({
						address: helper,
						abi: HELPER,
						functionName: "referrer",
						blockNumber,
					});
					return { registrar, renewerV1, referrer };
				})();
				metadata.set(key, result);
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
						const { item, segment } = receiptItem(row, label, receipt, block);
						const helper = selectedHelper(segment, label);
						const ensMetadata = await metadataFor(helper, receipt.blockNumber);
						const baseRegistrarV1 = segment.some(log => getAddress(log.address) === getAddress(ensMetadata.renewerV1))
							? await client.readContract({ address: ensMetadata.renewerV1 as Hex, abi: V1_METADATA, functionName: "BASE_REGISTRAR", blockNumber: receipt.blockNumber })
							: undefined;
						const expiry = eventExpiry(
							segment,
							label,
							row,
							{ ...ensMetadata, baseRegistrarV1 },
						);
						items[index] = { ...item, expiry, status: "complete" };
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
				...([429, 503].includes(status) ? { "retry-after": code === "rate_limited" ? "60" : "5" } : {}),
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
			return error(
				429,
				"history_capacity",
				"History capacity is busy. Retry after the indicated delay.",
			);
		activeRequests++;
		try {
			await admitPublicRequest("history", request);
			const result = await history(
				request,
				AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
			);
			logOperation("public_history.response", { requestId, step: "history" });
			return json(result, 200, {
				...HEADERS,
				...(result.items.some((item) => item.status === "processing")
					? { "retry-after": "5" }
					: {}),
			});
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
