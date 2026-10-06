/** Read-only discovery CLI. It never returns API payment status or starts processing. */
import { Pool } from "pg";
import { SERVER_CHAINS } from "../../src/lib/chains";
import {
	inspectSource,
	readSourceSnapshot,
} from "../../server/source-inspection";

const [chainId, transactionHash, ...extra] = process.argv.slice(2);
const chain = SERVER_CHAINS.find((c) => String(c.chainId) === chainId);
async function inspect() {
	if (
		!chain ||
		!/^0x[0-9a-f]{64}$/i.test(transactionHash ?? "") ||
		extra.length
	)
		throw new Error("invalid_inspection_arguments");
	const databaseUrl = process.env.DATABASE_URL,
		rpcUrl = process.env[chain.rpcEnv];
	if (!databaseUrl || !rpcUrl)
		throw new Error("missing_inspection_configuration");
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
	let snapshot: Awaited<ReturnType<typeof readSourceSnapshot>>;
	try {
		const client = await pool.connect();
		try {
			await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
			snapshot = await readSourceSnapshot(client, chainId, transactionHash);
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
			++operations > 7 ||
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
		const reader = response.body?.getReader();
		if (!reader) throw new Error("source_rpc_unavailable");
		let size = 0;
		const parts: Uint8Array[] = [];
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > 1024 * 1024) throw new Error("source_response_limit");
				parts.push(value);
			}
		} finally {
			await reader.cancel();
		}
		const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
		if (
			payload.error ||
			!payload.result ||
			payload.id !== operations ||
			payload.jsonrpc !== "2.0"
		)
			throw new Error("source_rpc_unavailable");
		return payload.result;
	}
	const inspected = await inspectSource(
		chainId,
		transactionHash,
		snapshot,
		(method, params) => rpc(method, params),
		signal,
	);
	if (!inspected.evidence) throw new Error("reverted_source");
	const { evidence, sourceFinality } = inspected;
	console.log(
		JSON.stringify(
			{
				observedAt: new Date().toISOString(),
				databaseSnapshotAt: snapshot.snapshotAt,
				readOnly: true,
				registryCount: snapshot.registry.length,
				indexedCount: snapshot.indexed.length,
				rpcCalls: operations,
				sourceFinality,
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
