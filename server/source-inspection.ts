import type { PoolClient } from "pg";
import { SERVER_CHAINS } from "../src/lib/chains";
import {
	sourceDepositEvidence,
	sourceFinalityEvidence,
	sourceReceiptIdentity,
	type SourceBlock,
	type SourceReceipt,
	type SourceTransaction,
} from "./source-deposit-evidence";

/** Called inside the caller's repeatable-read, read-only transaction. No transaction is opened or written here. */
export async function readSourceSnapshot(
	client: Pick<PoolClient, "query">,
	chainId: string,
	transactionHash: string,
) {
	const state = (
		await client.query(
			"SELECT current_setting('transaction_read_only') AS read_only,transaction_timestamp() AS snapshot_at",
		)
	).rows[0];
	if (state.read_only !== "on") throw new Error("inspection_not_read_only");
	const snapshotAt = state.snapshot_at.toISOString();
	const names = (
		await client.query(
			`SELECT n.normalized_label,n.deposit_address,n.activated_at,w.value AS watch FROM names n LEFT JOIN goldsky.watched_addresses w ON lower(w.value)=lower(n.deposit_address) ORDER BY n.normalized_label LIMIT 1001`,
		)
	).rows;
	if (names.length > 1000) throw new Error("source_evidence_limit");
	const registry = names.map((n) => ({
		label: n.normalized_label,
		address: n.deposit_address,
		activatedAt: n.activated_at.toISOString(),
	}));
	const watchedAddresses = names.flatMap((n) => (n.watch ? [n.watch] : []));
	const rows = (
		await client.query(
			`SELECT d.event_id,d.chain_id,d.tx_hash,d.log_index,d.block_number,d.sender_address,d.amount,d.token_address,d.source,d.status,e.canonical,e.facts,e.event_family,e.event_type,e.log_index AS event_log_index,e.chain_id AS event_chain_id,e.tx_hash AS event_tx_hash,e.block_number AS event_block_number,n.normalized_label,n.deposit_address FROM deposits d JOIN names n ON n.id=d.name_id JOIN chain_events e ON e.event_id=d.event_id WHERE d.chain_id=$1 AND lower(d.tx_hash)=$2 ORDER BY d.log_index,d.event_id LIMIT 1001`,
			[chainId, transactionHash.toLowerCase()],
		)
	).rows;
	if (rows.length > 1000) throw new Error("source_evidence_limit");
	if (
		rows.some(
			(r) =>
				r.event_family !== "deposit" ||
				r.event_type !== "Transfer" ||
				r.event_log_index !== r.log_index ||
				r.event_chain_id !== r.chain_id ||
				r.event_tx_hash.toLowerCase() !== r.tx_hash.toLowerCase() ||
				r.event_block_number !== r.block_number,
		)
	)
		throw new Error("inconsistent_index_event");
	const indexed = rows.map((r) => ({
		eventId: r.event_id,
		label: r.normalized_label,
		address: r.deposit_address,
		chainId: r.chain_id,
		transactionHash: r.tx_hash,
		logIndex: r.log_index,
		blockNumber: r.block_number,
		sender: r.sender_address,
		amount: r.amount,
		tokenAddress: r.token_address,
		canonical: r.canonical,
		source: r.source,
		status: r.status,
		facts: r.facts,
	}));
	return { snapshotAt, registry, watchedAddresses, indexed };
}
export type SourceSnapshot = Awaited<ReturnType<typeof readSourceSnapshot>>;

/** Seven bounded read-only RPC operations; a reverted canonical receipt supplies no deposit evidence. */
export async function inspectSource(
	chainId: string,
	transactionHash: string,
	snapshot: SourceSnapshot,
	rpc: (
		method: string,
		params: unknown[],
		signal: AbortSignal,
	) => Promise<unknown>,
	cancellation?: AbortSignal,
) {
	const signal = cancellation
		? AbortSignal.any([cancellation, AbortSignal.timeout(15000)])
		: AbortSignal.timeout(15000);
	let rpcCalls = 0;
	async function read<T>(method: string, params: unknown[]): Promise<T> {
		signal.throwIfAborted();
		if (++rpcCalls > 7) throw new Error("source_request_budget");
		return (await rpc(method, params, signal)) as T;
	}
	if (
		!SERVER_CHAINS.some((c) => String(c.chainId) === chainId) ||
		BigInt(await read<string>("eth_chainId", [])) !== BigInt(chainId)
	)
		throw new Error("wrong_source_chain");
	const receipt = await read<SourceReceipt>("eth_getTransactionReceipt", [
		transactionHash,
	]);
	const transaction = await read<SourceTransaction>(
		"eth_getTransactionByHash",
		[transactionHash],
	);
	const block = await read<SourceBlock>("eth_getBlockByNumber", [
		receipt.blockNumber,
		false,
	]);
	const identity = sourceReceiptIdentity({
		transactionHash,
		receipt,
		transaction,
		block,
	});
	const evidence = identity.reverted
		? null
		: sourceDepositEvidence({
				chainId,
				transactionHash,
				receipt,
				transaction,
				block,
				...snapshot,
			});
	if (identity.reverted && receipt.logs.length)
		throw new Error("inconsistent_reverted_source");
	const finalized = await read<SourceBlock>("eth_getBlockByNumber", [
		"finalized",
		false,
	]);
	const canonicalSource = await read<SourceBlock>("eth_getBlockByNumber", [
		block.number,
		false,
	]);
	const canonicalFinalized = await read<SourceBlock>("eth_getBlockByNumber", [
		finalized.number,
		false,
	]);
	const sourceFinality = sourceFinalityEvidence({
		source: block,
		finalized,
		canonicalSource,
		canonicalFinalized,
	});
	signal.throwIfAborted();
	return {
		readOnly: true,
		databaseSnapshotAt: snapshot.snapshotAt,
		rpcCalls,
		evidence,
		sourceFinality,
		identity,
	};
}
