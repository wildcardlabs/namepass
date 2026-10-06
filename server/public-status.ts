import { admitPublicRequest } from "./public-admission";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { getAddress } from "viem";
import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { depositAddress, normalizeLabel } from "../src/lib/namepass";
import { minimumTriggerAmount } from "./config";
import { ApiError, json, pathSegment } from "./http";
import { logOperation } from "./log";
import { readSourceSnapshot, inspectSource } from "./source-inspection";
import { inspectAllocation } from "./allocation-evidence";
import { inspectProcessingRenewal } from "./processing-renewal-evidence";
import {
	joinTransactionEvidence,
	type AllocationInspection,
	type RenewalInspection,
} from "./transaction-evidence";
import type { SourceBlock } from "./source-deposit-evidence";

const HEADERS = {
	"cache-control": "no-store",
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-headers": "Content-Type",
	"access-control-expose-headers": "Retry-After",
	"x-content-type-options": "nosniff",
};
let pool: Pool | undefined,
	activeRequests = 0;
function statusPool() {
	if (!pool) {
		if (!process.env.DATABASE_URL)
			throw new Error("status_database_unavailable");
		const connection = new URL(process.env.DATABASE_URL);
		connection.searchParams.set(
			"options",
			"-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1500 -c idle_in_transaction_session_timeout=10000",
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
type Candidate = {
	label: string;
	block_number: string;
	processing_hash: string;
	processing_index: number;
	renewal_hash: string | null;
	renewal_index: number | null;
};
function input(request: Request) {
	const chainId = pathSegment(request),
		chain = SERVER_CHAINS.find((c) => String(c.chainId) === chainId);
	const search = new URL(request.url).searchParams,
		hash = search.get("transactionHash");
	if (
		!chain ||
		!hash ||
		!/^0x[0-9a-f]{64}$/i.test(hash) ||
		[...search.keys()].some((k) => k !== "transactionHash") ||
		search.getAll("transactionHash").length !== 1
	)
		throw new ApiError(
			400,
			"invalid_transaction",
			"Use a supported source chain and one transactionHash.",
		);
	return { chain, chainId, transactionHash: hash.toLowerCase() };
}
async function snapshot(chainId: string, hash: string) {
	const client = await statusPool().connect();
	let discard = false;
	try {
		await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
		const source = await readSourceSnapshot(client, chainId, hash);
		if (!source.indexed.length)
			throw new ApiError(
				404,
				"transaction_not_found",
				"No matching deposit has been indexed. Retry the same URL.",
			);
		if (source.indexed.length > 16) throw new Error("status_member_budget");
		const minBlock = source.indexed.reduce(
			(n, r) => (BigInt(r.blockNumber) < n ? BigInt(r.blockNumber) : n),
			BigInt(source.indexed[0].blockNumber),
		);
		const rows = (
			await client.query<Candidate>(
				`SELECT n.normalized_label AS label,o.block_number::text,o.tx_hash AS processing_hash,o.log_index AS processing_index,r.tx_hash AS renewal_hash,r.log_index AS renewal_index
    FROM flows f JOIN names n ON n.id=f.name_id JOIN chain_events o ON o.event_id=f.origin_event_id
    LEFT JOIN chain_events r ON r.event_id=f.renewal_event_id AND r.canonical=true AND r.event_family='namepass' AND r.event_type='Renewed' AND r.chain_id=$4::numeric
    WHERE f.origin_chain_id=$1::numeric AND o.chain_id=$1::numeric AND o.canonical=true AND o.event_family='namepass' AND o.event_type='DepositProcessed'
    AND n.normalized_label=ANY($2::text[]) AND o.block_number >= $3::numeric AND o.block_number < $3::numeric+32768
    ORDER BY o.block_number,o.log_index,o.event_id LIMIT 33`,
				[
					chainId,
					[...new Set(source.indexed.map((r) => r.label))],
					minBlock.toString(),
					String(HUB_CHAIN.chainId),
				],
			)
		).rows;
		if (rows.length > 32) throw new Error("status_candidate_budget");
		await client.query("COMMIT");
		return { source, candidates: rows };
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

async function status(request: Request, signal: AbortSignal) {
	const { chain, chainId, transactionHash } = input(request);
	const initial = await snapshot(chainId, transactionHash);
	let calls = 0,
		circleReads = 0,
		id = 0;
	async function payload(url: string, init: RequestInit) {
		signal.throwIfAborted();
		const response = await fetch(url, {
			...init,
			signal: init.signal ?? signal,
			redirect: "error",
		});
		if (!response.ok) throw new Error("status_provider_unavailable");
		const reader = response.body?.getReader();
		if (!reader) throw new Error("status_provider_unavailable");
		let size = 0;
		const parts: Uint8Array[] = [];
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > 1024 * 1024) throw new Error("status_response_limit");
				parts.push(value);
			}
		} finally {
			await reader.cancel();
		}
		return JSON.parse(Buffer.concat(parts).toString("utf8"));
	}
	async function rpc(
		chainNumber: number,
		method: string,
		params: unknown[],
		cancellation = signal,
	) {
		signal.throwIfAborted();
		if (
			++calls > 96 ||
			![
				"eth_chainId",
				"eth_getBlockByNumber",
				"eth_getTransactionReceipt",
				"eth_getTransactionByHash",
				"eth_getLogs",
				"eth_getCode",
				"eth_call",
			].includes(method)
		)
			throw new Error("status_request_budget");
		const network = SERVER_CHAINS.find((c) => c.chainId === chainNumber),
			url = network && process.env[network.rpcEnv];
		if (!url) throw new Error("status_provider_unavailable");
		const requestId = ++id;
		const p = await payload(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
			signal: cancellation,
		});
		if (
			p.jsonrpc !== "2.0" ||
			p.id !== requestId ||
			p.error ||
			p.result === null ||
			p.result === undefined
		)
			throw new Error("status_provider_unavailable");
		return p.result;
	}
	const source = await inspectSource(
		chainId,
		transactionHash,
		initial.source,
		(method, params, s) => rpc(chain.chainId, method, params, s),
		signal,
	);
	const allocations: AllocationInspection[] = [],
		renewals: RenewalInspection[] = [];
	if (
		source.evidence?.receiptSetClosed &&
		source.sourceFinality.providerFinalized &&
		source.evidence.members.every((m) => m.allocationLogIndex !== null)
	) {
		const names = [...new Set(source.evidence.members.map((m) => m.name))];
		if (names.length > 8 || source.evidence.members.length > 16)
			throw new Error("status_member_budget");
		for (const name of names) {
			const hints = initial.candidates.filter(
				(c) =>
					c.label + ".eth" === name &&
					BigInt(c.block_number) >= BigInt(source.identity.blockNumber),
			);
			if (!hints.length) continue;
			const throughBlock = hints.reduce(
				(n, c) => (BigInt(c.block_number) > n ? BigInt(c.block_number) : n),
				BigInt(source.identity.blockNumber),
			);
			allocations.push(
				await inspectAllocation(
					{
						chainId,
						label: name.slice(0, -4),
						transactionHash,
						throughBlock: throughBlock.toString(),
						rangeMode: "request",
					},
					(method, params, s) => rpc(chain.chainId, method, params, s),
					signal,
				),
			);
		}
		const needed = new Set(
			allocations.flatMap((a) =>
				a.deposits.flatMap((d) => d.processingCallIds),
			),
		);
		if (needed.size > 16) throw new Error("status_renewal_budget");
		for (const callId of needed) {
			const a = allocations.find((a) =>
				a.processingCalls.some((c) => c.processingId === callId),
			)!;
			const [, processingTransactionHash, processingLogIndex] =
				callId.split(":");
			const hint = initial.candidates.find(
				(c) =>
					c.label + ".eth" === a.name &&
					c.processing_hash.toLowerCase() === processingTransactionHash &&
					String(c.processing_index) === processingLogIndex,
			);
			if (!hint?.renewal_hash || hint.renewal_index === null) continue;
			renewals.push(
				await inspectProcessingRenewal(
					{
						chainId,
						label: a.name.slice(0, -4),
						processingTransactionHash,
						processingLogIndex,
						renewalTransactionHash: hint.renewal_hash.toLowerCase(),
						renewalLogIndex: String(hint.renewal_index),
					},
					{
						rpc,
						async messages(domain, hash, s) {
							if (++circleReads > 16) throw new Error("status_circle_budget");
							return payload(
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
	const combined = source.evidence
		? joinTransactionEvidence(
				{ ...source, evidence: source.evidence },
				allocations,
				renewals,
			)
		: null;
	const final = await snapshot(chainId, transactionHash);
	const checked = await inspectSource(
		chainId,
		transactionHash,
		final.source,
		(method, params, s) => rpc(chain.chainId, method, params, s),
		signal,
	);
	if (
		JSON.stringify(source.evidence) !== JSON.stringify(checked.evidence) ||
		JSON.stringify(source.identity) !== JSON.stringify(checked.identity) ||
		(source.sourceFinality.providerFinalized &&
			!checked.sourceFinality.providerFinalized) ||
		JSON.stringify(initial.candidates) !== JSON.stringify(final.candidates) ||
		(!source.evidence &&
			JSON.stringify(initial.source.indexed) !==
				JSON.stringify(final.source.indexed))
	)
		throw new Error("status_evidence_changed");
	const blocks = combined?.blocks ?? [
		{
			chainId,
			number: source.identity.blockNumber,
			hash: source.identity.blockHash,
		},
		{
			chainId,
			number: source.sourceFinality.finalizedBlock.number,
			hash: source.sourceFinality.finalizedBlock.hash,
		},
	];
	if (blocks.length > 64) throw new Error("status_block_budget");
	for (const b of blocks) {
		const fresh = (await rpc(Number(b.chainId), "eth_getBlockByNumber", [
			`0x${BigInt(b.number).toString(16)}`,
			false,
		])) as SourceBlock;
		if (
			BigInt(fresh.number).toString() !== b.number ||
			fresh.hash.toLowerCase() !== b.hash
		)
			throw new Error("status_block_changed");
	}
	signal.throwIfAborted();
	if (!source.evidence) {
		const failed =
			source.identity.reverted && checked.sourceFinality.providerFinalized;
		const deposits = initial.source.indexed.map((r) => {
			if (
				normalizeLabel(r.label) !== r.label ||
				getAddress(r.address) !== getAddress(depositAddress(r.label)) ||
				!/^[1-9][0-9]*$/.test(r.amount) ||
				r.source !== "goldsky" ||
				getAddress(r.tokenAddress) !== getAddress(chain.usdcAddress)
			)
				throw new Error("invalid_recorded_deposit");
			return {
				name: r.label + ".eth",
				depositAddress: getAddress(r.address),
				logIndex: r.eventId.startsWith(`${chainId}:native:`)
					? null
					: r.logIndex,
				amount: r.amount,
				status: failed ? "failed" : "pending",
				reason: failed ? "source_transaction_reverted" : "source_not_finalized",
				renewals: [],
			};
		});
		return {
			chainId,
			transactionHash,
			status: failed ? "failed" : "pending",
			deposits,
		};
	}
	const e = source.evidence;
	const deposits = e.members
		.filter((m) => m.amount !== null)
		.map((m) => {
			const a = allocations.find((a) => a.name === m.name),
				credit = a?.deposits.find(
					(d) => d.receiptLogIndex === m.allocationLogIndex,
				);
			const results = (credit?.processingCallIds ?? [])
				.map((id) => renewals.find((r) => r.processingId === id))
				.filter((r): r is RenewalInspection => !!r);
			let state = "processing",
				reason: string | null = "awaiting_processing";
			if (
				!e.receiptSetClosed ||
				!source.sourceFinality.providerFinalized ||
				!m.indexedEventId ||
				m.allocationLogIndex === null
			) {
				state = "pending";
				reason = "source_set_unproven";
			} else if (
				credit?.windowClosed &&
				credit.processingCallIds.length > 0 &&
				results.length === credit.processingCallIds.length &&
				results.every((r) => r.providerFinalized)
			) {
				state = "complete";
				reason = null;
			} else if (
				!credit?.processingCallIds.length &&
				BigInt(m.amount!) < minimumTriggerAmount(chain.chainId)
			) {
				state = "pending";
				reason = "below_minimum";
			} else if (credit?.processingCallIds.length) reason = "awaiting_renewal";
			const events = [
				...new Map(
					results
						.filter((r) => r.providerFinalized)
						.map((r) => [r.renewalId, r]),
				).values(),
			];
			return {
				name: m.name,
				depositAddress: getAddress(m.address),
				logIndex: m.publicLogIndex,
				amount: m.amount!,
				status: state,
				reason,
				renewals: events.map((r) => ({
					renewalId: r.renewalId,
					chainId: r.chainId,
					transactionHash: r.transactionHash,
					secondsAdded: r.secondsAdded,
					expiry: r.expiry,
				})),
			};
		});
	if (!deposits.length) throw new Error("status_source_unrepresented");
	const aggregate =
		!e.receiptSetClosed ||
		!source.sourceFinality.providerFinalized ||
		deposits.some((d) => d.status === "pending")
			? "pending"
			: combined?.evidenceComplete &&
				  deposits.every((d) => d.status === "complete")
				? "complete"
				: "processing";
	return { chainId, transactionHash, status: aggregate, deposits };
}
export const publicStatus = {
	async fetch(request: Request): Promise<Response> {
		const requestId = crypto.randomUUID();
		const error = (status: number, code: string, message: string) =>
			json({ error: { code, message }, requestId }, status, {
				...HEADERS,
				...([429, 503].includes(status) ? { "retry-after": code === "rate_limited" ? "60" : "5" } : {}),
			});
		if (request.method === "OPTIONS")
			return new Response(null, { status: 204, headers: HEADERS });
		if (request.method !== "GET")
			return json(
				{
					error: { code: "method_not_allowed", message: "Use GET." },
					requestId,
				},
				405,
				{ ...HEADERS, allow: "GET, OPTIONS" },
			);
		if (process.env.NAMEPASS_PUBLIC_STATUS_ENABLED !== "1")
			return error(503, "api_unavailable", "The status API is not enabled.");
		if (process.env.NAMEPASS_MAINTENANCE === "1")
			return error(
				503,
				"maintenance",
				"Namepass is being upgraded. Try again later.",
			);
		if (activeRequests >= 2)
			return error(
				429,
				"status_capacity",
				"Status capacity is busy. Retry after the indicated delay.",
			);
		activeRequests++;
		try {
			await admitPublicRequest("status", request);
			const result = await status(
				request,
				AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
			);
			logOperation("public_status.response", { requestId, step: "status" });
			return json(result, 200, {
				...HEADERS,
				...(["pending", "processing"].includes(result.status)
					? { "retry-after": "5" }
					: {}),
			});
		} catch (cause) {
			logOperation("public_status.error", {
				requestId,
				step: "status",
				errorCode:
					cause instanceof ApiError ? cause.code : "status_unavailable",
			});
			return cause instanceof ApiError
				? error(cause.status, cause.code, cause.message)
				: error(
						503,
						"status_unavailable",
						"Verified transaction status is temporarily unavailable. Try again later.",
					);
		} finally {
			activeRequests--;
		}
	},
};
