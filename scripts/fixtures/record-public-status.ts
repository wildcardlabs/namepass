/**
 * Records `test/fixtures/public-status/october-reads.json`-shaped captures: the seed rows the
 * status route needs (name registry, one indexed source deposit, its processing and renewal
 * candidates) read from the hosted database over Neon's HTTPS SQL endpoint, then the provider
 * reads the real status route makes against live RPCs while serving that transaction from a
 * local PGlite seeded exactly as the test seeds it. Read-only everywhere.
 *
 *   DATABASE_URL=<neon connection string> ETHEREUM_SEPOLIA_RPC_URL=… … node --import tsx \
 *     scripts/fixtures/record-public-status.ts <out.json> <sourceChainId> <sourceTxHash>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { keccak256, stringToHex } from "viem";
import { SERVER_CHAINS } from "../../src/lib/chains";

const [out, sourceChainId, sourceTxHash] = process.argv.slice(2);
if (!out || !sourceChainId || !sourceTxHash) throw new Error("usage: <out.json> <sourceChainId> <sourceTxHash>");
const database = process.env.DATABASE_URL;
if (!database) throw new Error("missing DATABASE_URL");
const neon = new URL(database);
async function sql(query: string, params: unknown[] = []) {
	const r = await fetch(`https://${neon.hostname}/sql`, { method: "POST", headers: { "Neon-Connection-String": database!, "content-type": "application/json" }, body: JSON.stringify({ query, params }) });
	const body = await r.json(); if (!r.ok) throw new Error(JSON.stringify(body).slice(0, 200)); return body.rows as any[];
}
const registry = await sql("select n.normalized_label, n.deposit_address, n.activated_at, w.value as watch from names n left join goldsky.watched_addresses w on w.value = n.deposit_address order by 1");
const [event] = await sql("select e.*, d.sender_address, d.amount::text as amount, d.token_address, d.source, d.status, n.normalized_label, n.deposit_address from chain_events e join deposits d on d.event_id = e.event_id join names n on n.id = d.name_id where e.chain_id = $1 and e.tx_hash = $2 and e.event_family = 'deposit'", [sourceChainId, sourceTxHash]);
if (!event) throw new Error("source deposit not indexed");
const [flow] = await sql("select f.*, n.normalized_label from flows f join names n on n.id = f.name_id where f.deposit_event_id = $1", [event.event_id]);
if (!flow?.renewal_event_id) throw new Error("flow has no renewal yet");
const [processing] = await sql("select * from chain_events where event_id = $1", [flow.origin_event_id]);
const [renewal] = await sql("select * from chain_events where event_id = $1", [flow.renewal_event_id]);
const indexed = {
	event_id: event.event_id, chain_id: String(event.chain_id), tx_hash: event.tx_hash, log_index: event.log_index, block_number: String(event.block_number),
	sender_address: event.sender_address, amount: event.amount, token_address: event.token_address, source: event.source, status: event.status, canonical: event.canonical, facts: event.facts,
	event_family: event.event_family, event_type: event.event_type, event_log_index: event.log_index, event_chain_id: String(event.chain_id), event_tx_hash: event.tx_hash, event_block_number: String(event.block_number),
	normalized_label: event.normalized_label, deposit_address: event.deposit_address,
};
const candidates = [{ label: flow.normalized_label, block_number: String(renewal.block_number), processing_hash: processing.tx_hash, processing_index: processing.log_index, renewal_hash: renewal.tx_hash, renewal_index: renewal.log_index }];
const seed = { registry: registry.map((r) => ({ normalized_label: r.normalized_label, deposit_address: r.deposit_address, activated_at: r.activated_at, watch: r.watch })), indexed: [indexed], candidates };
console.log("seed:", JSON.stringify({ registry: seed.registry.length, indexed: indexed.event_id, candidates }));

// Local PGlite seeded exactly as server/public-status.test.ts seeds it; the route's own SQL runs against it.
const db = new PGlite();
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
for (const entry of journal.entries) await db.exec(readFileSync(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"));
const ids = new Map<string, string>();
for (const n of seed.registry) {
	const r = await db.query<{ id: string }>("INSERT INTO names(normalized_label,display_name,label_hash,namehash,deposit_address,activated_at,ens_synced_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id", [n.normalized_label, n.normalized_label + ".eth", keccak256(stringToHex(n.normalized_label)), keccak256(stringToHex(n.normalized_label + ".eth")), n.deposit_address, n.activated_at]);
	ids.set(n.normalized_label, r.rows[0].id);
	if (n.watch) await db.query("INSERT INTO goldsky.watched_addresses(value) VALUES($1)", [n.watch]);
}
await db.query("INSERT INTO chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts) VALUES($1,'deposit','Transfer',$2,$3,$4,$5,'2026-10-01','c',true,$6)", [indexed.event_id, indexed.chain_id, indexed.tx_hash, indexed.log_index, indexed.block_number, JSON.stringify(indexed.facts)]);
await db.query("INSERT INTO deposits(event_id,name_id,chain_id,token_address,sender_address,amount,tx_hash,log_index,block_number,block_time,source,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-10-01','goldsky',$10)", [indexed.event_id, ids.get(indexed.normalized_label), indexed.chain_id, indexed.token_address, indexed.sender_address, indexed.amount, indexed.tx_hash, indexed.log_index, indexed.block_number, indexed.status]);
for (const c of candidates) {
	for (const [type, index] of [["DepositProcessed", c.processing_index], ["Renewed", c.renewal_index]] as const)
		await db.query("INSERT INTO chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,facts) VALUES($1,'namepass',$2,11155111,$3,$4,$5,'2026-10-01','c','{}')", [type, type, c.processing_hash, index, c.block_number]);
	await db.query("INSERT INTO flows(name_id,origin_chain_id,trigger,status,amount_detected,origin_event_id,renewal_event_id) VALUES($1,11155111,'external','settled',1000000,'DepositProcessed','Renewed')", [ids.get(c.label)]);
}
(Pool.prototype as any).connect = async () => ({ query: (q: string, v: unknown[] = []) => db.query(q, v), release() {} });

// Real providers, recorded under the environment variable name the test addresses them by.
const byUrl = new Map<string, string>();
for (const c of SERVER_CHAINS) { const url = process.env[c.rpcEnv]; if (!url) throw new Error(`missing ${c.rpcEnv}`); byUrl.set(url, c.rpcEnv); }
const codes: Record<string, string> = {};
const reads: any[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
	const url = String(input);
	const response = await realFetch(input, init);
	const env = byUrl.get(url);
	if (env && init?.body) {
		const p = JSON.parse(String(init.body));
		const body = await response.clone().json();
		let result = body.result;
		if (p.method === "eth_getCode" && typeof result === "string" && result.length > 2) { const hash = keccak256(result).slice(2); codes[hash] = result; result = { code: hash }; }
		reads.push({ kind: "rpc", chainId: env, method: p.method, params: p.params, result });
	} else if (url.includes("iris-api")) {
		reads.push({ kind: "iris", url: url.replace(/transactionHash=.*/, "transactionHash=…"), result: await response.clone().json() });
	}
	return response;
}) as typeof fetch;
process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/status";
process.env.NAMEPASS_PUBLIC_STATUS_ENABLED = "1";
delete process.env.NAMEPASS_MAINTENANCE;
const route = (await import("../../routes/api/v1/status/[chainId]")).default;
const response = await route.fetch(new Request(`https://status.test/api/v1/status/${sourceChainId}?transactionHash=${sourceTxHash}`));
const data = await response.json();
console.log("status response:", response.status, JSON.stringify(data).slice(0, 600));
writeFileSync(out, `${JSON.stringify({ seed, reads, codes }, null, 2)}\n`);
console.log(`wrote ${out}: ${reads.length} reads, ${Object.keys(codes).length} code blobs`);
await db.close();
