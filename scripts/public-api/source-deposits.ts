/** Read-only discovery CLI. It never returns API payment status or starts processing. */
import { Pool } from "pg";
import { SERVER_CHAINS } from "../../src/lib/chains";
import {
	sourceDepositEvidence,
	type IndexedSourceDeposit,
	type RegisteredDepositAddress,
	type SourceBlock,
	type SourceReceipt,
	type SourceTransaction,
} from "../../server/source-deposit-evidence";

const [chainId, transactionHash, ...extra] = process.argv.slice(2);
const chain = SERVER_CHAINS.find((c) => String(c.chainId) === chainId);
async function inspect() {
	if (!chain || !/^0x[0-9a-f]{64}$/i.test(transactionHash ?? "") || extra.length)
		throw new Error("invalid_inspection_arguments");
	const databaseUrl = process.env.DATABASE_URL,
		rpcUrl = process.env[chain.rpcEnv];
	if (!databaseUrl || !rpcUrl) throw new Error("missing_inspection_configuration");
	const connection = new URL(databaseUrl);
	connection.searchParams.set(
		"options",
		"-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1500 -c idle_in_transaction_session_timeout=10000",
	);
	const pool = new Pool({
		connectionString: connection.toString(),
		max: 1,
		connectionTimeoutMillis: 5000,
		query_timeout: 7000,
	});
	let registry: RegisteredDepositAddress[],
		watchedAddresses: string[],
		indexed: IndexedSourceDeposit[],
		snapshotAt: string;
	try {
		const client = await pool.connect();
		try {
			await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
			const state = (
				await client.query(
					"SELECT current_setting('transaction_read_only') AS read_only,transaction_timestamp() AS snapshot_at",
				)
			).rows[0];
			if (state.read_only !== "on") throw new Error("inspection_not_read_only");
			snapshotAt = state.snapshot_at.toISOString();
			const names = (
				await client.query(
					`SELECT n.normalized_label,n.deposit_address,n.activated_at,w.value AS watch FROM names n LEFT JOIN goldsky.watched_addresses w ON lower(w.value)=lower(n.deposit_address) ORDER BY n.normalized_label LIMIT 1001`,
				)
			).rows;
			if (names.length > 1000) throw new Error("source_evidence_limit");
			registry = names.map((n) => ({
				label: n.normalized_label,
				address: n.deposit_address,
				activatedAt: n.activated_at.toISOString(),
			}));
			watchedAddresses = names.flatMap((n) => (n.watch ? [n.watch] : []));
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
			indexed = rows.map((r) => ({
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
			await client.query("ROLLBACK");
		} finally {
			client.release();
		}
	} finally {
		await pool.end();
	}
	const signal = AbortSignal.timeout(15000);
	let operations = 0;
	async function rpc<T>(method: string, params: unknown[]): Promise<T> {
		if (
			++operations > 4 ||
			![
				"eth_chainId",
				"eth_getTransactionReceipt",
				"eth_getTransactionByHash",
				"eth_getBlockByNumber",
			].includes(method)
		)
			throw new Error("inspection_rpc_budget");
		const response = await fetch(rpcUrl!, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: operations, method, params }),
			signal,
		});
		if (!response.ok) throw new Error("source_rpc_unavailable");
		const payload = await response.json();
		if (payload.error || !payload.result || payload.id !== operations || payload.jsonrpc !== "2.0")
			throw new Error("source_rpc_unavailable");
		return payload.result;
	}
	if (BigInt(await rpc<string>("eth_chainId", [])).toString() !== chainId)
		throw new Error("wrong_source_chain");
	const receipt = await rpc<SourceReceipt>("eth_getTransactionReceipt", [transactionHash]);
	const transaction = await rpc<SourceTransaction>("eth_getTransactionByHash", [transactionHash]);
	const block = await rpc<SourceBlock>("eth_getBlockByNumber", [receipt.blockNumber, false]);
	const evidence = sourceDepositEvidence({
		chainId,
		transactionHash,
		receipt,
		transaction,
		block,
		registry,
		watchedAddresses,
		indexed,
	});
	console.log(
		JSON.stringify(
			{
				observedAt: new Date().toISOString(),
				databaseSnapshotAt: snapshotAt,
				readOnly: true,
				registryCount: registry.length,
				indexedCount: indexed.length,
				rpcCalls: operations,
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
			error: "source_inspection_unavailable",
			message:
				"Inspection failed. Check arguments, configuration and evidence; provider and database details are suppressed.",
		}),
	);
	process.exitCode = 1;
});
