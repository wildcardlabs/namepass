import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { keccak256, stringToHex, toHex } from "viem";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import route from "../routes/api/v1/status/[chainId]";
import { SERVER_CHAINS } from "../src/lib/chains";

const recorded = JSON.parse(
	readFileSync(
		new URL(
			"../test/fixtures/public-status/october-reads.json",
			import.meta.url,
		),
		"utf8",
	),
);
const row = recorded.seed.indexed[0];
const spec = JSON.parse(
	readFileSync(new URL("../docs/api/openapi.json", import.meta.url), "utf8"),
);
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const valid = ajv.compile<any>({
	$ref: "#/components/schemas/StatusResponse",
	components: spec.components,
});
function request(
	hash = row.tx_hash,
	chain = "11155111",
	method = "GET",
	extra = "",
) {
	return new Request(
		`https://status.test/api/v1/status/${chain}?transactionHash=${hash}${extra}`,
		{ method },
	);
}
function setup(t: TestContext) {
	const saved = { ...process.env };
	const keys = [
		"DATABASE_URL",
		"NAMEPASS_PUBLIC_STATUS_ENABLED",
		"NAMEPASS_MAINTENANCE",
		...SERVER_CHAINS.map((c) => c.rpcEnv),
	];
	process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/status";
	process.env.NAMEPASS_PUBLIC_STATUS_ENABLED = "1";
	delete process.env.NAMEPASS_MAINTENANCE;
	for (const c of SERVER_CHAINS)
		process.env[c.rpcEnv] = `https://rpc.test/${c.rpcEnv}`;
	t.after(() => {
		for (const k of keys) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});
}
type Change = (method: string, params: any[], value: any, call: number) => any;
function provider(t: TestContext, change?: Change) {
	let calls = 0;
	const mock = t.mock.method(
		globalThis,
		"fetch",
		async (url: string | URL | Request, init?: RequestInit) => {
			const p = JSON.parse(String(init?.body));
			const found = recorded.reads.find(
				(r: any) =>
					String(url).endsWith("/" + r.chainId) &&
					r.method === p.method &&
					JSON.stringify(r.params) === JSON.stringify(p.params),
			);
			let value = found ? structuredClone(found.result) : undefined;
			if (p.method === "eth_getCode") value = recorded.codes[value.code];
			calls++;
			if (change) value = change(p.method, p.params, value, calls);
			assert.notEqual(
				value,
				undefined,
				`unrecorded ${p.method} ${JSON.stringify(p.params)}`,
			);
			return Response.json({ jsonrpc: "2.0", id: p.id, result: value });
		},
	);
	return {
		mock,
		get calls() {
			return calls;
		},
	};
}
async function database(t: TestContext) {
	const db = new PGlite();
	t.after(() => db.close());
	const journal = JSON.parse(
		readFileSync(
			new URL("../drizzle/meta/_journal.json", import.meta.url),
			"utf8",
		),
	);
	for (const entry of journal.entries)
		await db.exec(
			readFileSync(
				new URL(`../drizzle/${entry.tag}.sql`, import.meta.url),
				"utf8",
			),
		);
	const ids = new Map<string, string>();
	for (const n of recorded.seed.registry) {
		const r = await db.query<{ id: string }>(
			"INSERT INTO names(normalized_label,display_name,label_hash,namehash,deposit_address,activated_at,ens_synced_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id",
			[
				n.normalized_label,
				n.normalized_label + ".eth",
				keccak256(stringToHex(n.normalized_label)),
				keccak256(stringToHex(n.normalized_label + ".eth")),
				n.deposit_address,
				n.activated_at,
			],
		);
		ids.set(n.normalized_label, r.rows[0].id);
		if (n.watch)
			await db.query(
				"INSERT INTO goldsky.watched_addresses(value) VALUES($1)",
				[n.watch],
			);
	}
	async function deliver(r: any) {
		await db.query(
			"INSERT INTO chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts) VALUES($1,'deposit','Transfer',$2,$3,$4,$5,'2026-10-01','c',true,$6)",
			[
				r.event_id,
				r.chain_id,
				r.tx_hash,
				r.log_index,
				r.block_number,
				JSON.stringify(r.facts),
			],
		);
		await db.query(
			"INSERT INTO deposits(event_id,name_id,chain_id,token_address,sender_address,amount,tx_hash,log_index,block_number,block_time,source,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-10-01','goldsky',$10)",
			[
				r.event_id,
				ids.get(r.normalized_label),
				r.chain_id,
				r.token_address,
				r.sender_address,
				r.amount,
				r.tx_hash,
				r.log_index,
				r.block_number,
				r.status,
			],
		);
	}
	await deliver(row);
	for (const c of recorded.seed.candidates) {
		for (const [type, index] of [
			["DepositProcessed", c.processing_index],
			["Renewed", c.renewal_index],
		] as const) {
			await db.query(
				"INSERT INTO chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,facts) VALUES($1,'namepass',$2,11155111,$3,$4,$5,'2026-10-01','c','{}')",
				[type, type, c.processing_hash, index, c.block_number],
			);
		}
		await db.query(
			"INSERT INTO flows(name_id,origin_chain_id,trigger,status,amount_detected,origin_event_id,renewal_event_id) VALUES($1,11155111,'external','settled',1000000,'DepositProcessed','Renewed')",
			[ids.get(c.label)],
		);
	}
	const queries: string[] = [];
	// Replace transport only: the actual adapter SQL executes against migrated PostgreSQL.
	const connect = t.mock.method(Pool.prototype, "connect", async () => ({
		query: async (sql: string, values: unknown[] = []) => {
			queries.push(sql);
			return db.query(sql, values);
		},
		release: () => {},
	}));
	return { db, queries, connect, deliver };
}
async function body(response: Response) {
	const data = await response.json();
	if (response.status === 200)
		assert.ok(valid(data), JSON.stringify(valid.errors));
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(response.headers.get("access-control-allow-origin"), "*");
	return data;
}

test("status gate, validation and unknown transaction do not consume provider reads", async (t) => {
	setup(t);
	const connect = t.mock.method(Pool.prototype, "connect", async () => {
		throw new Error("unexpected database");
	});
	const rpc = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("unexpected provider");
	});
	process.env.NAMEPASS_PUBLIC_STATUS_ENABLED = "0";
	assert.equal(
		(await body(await route.fetch(request()))).error.code,
		"api_unavailable",
	);
	assert.equal(
		(await route.fetch(request(row.tx_hash, "11155111", "OPTIONS"))).status,
		204,
	);
	const post = await route.fetch(request(row.tx_hash, "11155111", "POST"));
	assert.equal(post.status, 405);
	assert.equal(post.headers.get("allow"), "GET, OPTIONS");
	process.env.NAMEPASS_PUBLIC_STATUS_ENABLED = "1";
	process.env.NAMEPASS_MAINTENANCE = "1";
	assert.equal(
		(await body(await route.fetch(request()))).error.code,
		"maintenance",
	);
	delete process.env.NAMEPASS_MAINTENANCE;
	for (const r of [
		request("bad"),
		request(row.tx_hash, "1"),
		request(row.tx_hash, "11155111", "GET", "&transactionHash=" + row.tx_hash),
		request(row.tx_hash, "11155111", "GET", "&throughBlock=999"),
	])
		assert.equal((await route.fetch(r)).status, 400);
	assert.equal(connect.mock.callCount(), 0);
	assert.equal(rpc.mock.callCount(), 0);
	connect.mock.restore();
	const f = await database(t);
	assert.equal(
		(await route.fetch(request("0x" + "ab".repeat(32)))).status,
		404,
	);
	assert.equal(f.connect.mock.callCount(), 1);
	assert.equal(rpc.mock.callCount(), 0);
});

test("status completes a verified renewal before finality and holds a staggered second deposit", async (t) => {
	setup(t);
	const f = await database(t);
	let additional = false;
	const n = recorded.seed.registry.find(
		(r: any) => r.normalized_label === "vitalik",
	);
	assert.ok(n);
	const original = recorded.reads.find(
		(r: any) =>
			r.method === "eth_getTransactionReceipt" && r.params[0] === row.tx_hash,
	).result;
	const transfer = original.logs.find(
		(l: any) => Number(BigInt(l.logIndex)) === row.log_index,
	);
	const second = {
		...transfer,
		logIndex: toHex(
			Math.max(...original.logs.map((l: any) => Number(BigInt(l.logIndex)))) +
				1,
		),
		topics: [
			...transfer.topics.slice(0, 2),
			"0x" + n.deposit_address.slice(2).padStart(64, "0"),
		],
		data: toHex(2000000n, { size: 32 }),
	};
	// Both source and renewal receipts are ahead of this canonical finality anchor.
	const sourceBlock = recorded.reads.find(
		(r: any) => r.method === "eth_getBlockByNumber" && r.params[0] === originalBlock(),
	).result;
	const earlier = {
		number: toHex(BigInt(sourceBlock.number) - 1n),
		hash: "0x" + "cd".repeat(32),
		timestamp: toHex(BigInt(sourceBlock.timestamp) - 12n),
	};
	const rpc = provider(t, (m, p, v) => {
		if (m === "eth_getBlockByNumber" && ["finalized", earlier.number].includes(p[0]))
			return structuredClone(earlier);
		return m === "eth_getTransactionReceipt" && p[0] === row.tx_hash && additional
			? { ...v, logs: [...v.logs, second] }
			: v;
	});
	const before = (
		await f.db.query(
			"SELECT event_id,canonical,facts FROM chain_events ORDER BY event_id",
		)
	).rows;
	const complete = await body(await route.fetch(request()));
	assert.equal(complete.status, "complete");
	assert.equal(complete.deposits[0].amount, "500000");
	assert.deepEqual(complete.deposits[0].renewals, [
		{
			renewalId: `11155111:${recorded.seed.candidates[0].renewal_hash}:179`,
			chainId: "11155111",
			transactionHash: recorded.seed.candidates[0].renewal_hash,
			secondsAdded: "1576795",
			expiry: "2032-03-26T03:32:32.000Z",
		},
	]);
	assert.ok(rpc.calls <= 96);
	assert.equal(f.connect.mock.callCount(), 2);
	assert.equal(
		f.queries.filter((q) =>
			q.includes("current_setting('transaction_read_only')"),
		).length,
		2,
	);
	assert.ok(f.queries.every((q) => /^(SELECT|BEGIN|COMMIT|ROLLBACK)/.test(q)));
	assert.deepEqual(
		(
			await f.db.query(
				"SELECT event_id,canonical,facts FROM chain_events ORDER BY event_id",
			)
		).rows,
		before,
	);
	additional = true;
	const open = await route.fetch(request());
	const a = await body(open);
	assert.equal(a.status, "pending");
	assert.equal(a.deposits.length, 2);
	assert.ok(a.deposits.every((d: any) => d.status === "pending"));
	assert.equal(open.headers.get("retry-after"), "5");
	const late = {
		...row,
		event_id: "late-transfer",
		normalized_label: n.normalized_label,
		deposit_address: n.deposit_address,
		amount: "2000000",
		log_index: Number(BigInt(second.logIndex)),
		facts: {
			...row.facts,
			recipient_address: n.deposit_address,
			amount: "2000000",
		},
	};
	await f.deliver(late);
	const b = await body(await route.fetch(request()));
	assert.equal(b.status, "processing");
	assert.deepEqual(
		b.deposits.map((d: any) => d.status),
		["complete", "processing"],
	);
	await f.db.query("DELETE FROM deposits WHERE event_id='late-transfer'");
	await f.db.query("DELETE FROM chain_events WHERE event_id='late-transfer'");
	additional = false;
	assert.equal((await body(await route.fetch(request()))).status, "complete");
});

test("status revokes completion after an indexed correction and sanitizes provider failures", async (t) => {
	setup(t);
	const f = await database(t);
	let mode = "normal",
		sourceReads = 0;
	provider(t, (m, p, v) => {
		if (mode === "outage")
			throw new Error("https://private-provider.test/secret-token");
		if (
			mode === "missing" &&
			m === "eth_getTransactionReceipt" &&
			p[0] === row.tx_hash
		)
			return null;
		if (
			mode === "changed" &&
			m === "eth_getTransactionReceipt" &&
			p[0] === row.tx_hash &&
			++sourceReads === 2
		)
			return { ...v, blockHash: "0x" + "ab".repeat(32) };
		return v;
	});
	assert.equal((await body(await route.fetch(request()))).status, "complete");
	await f.db.query(
		"UPDATE chain_events SET canonical=false WHERE event_id='Renewed'",
	);
	const corrected = await route.fetch(request());
	const b = await body(corrected);
	assert.equal(b.status, "processing");
	assert.deepEqual(b.deposits[0].renewals, []);
	assert.equal(corrected.headers.get("retry-after"), "5");
	await f.db.query(
		"UPDATE chain_events SET canonical=true WHERE event_id='Renewed'",
	);
	for (mode of ["changed", "outage", "missing"]) {
		sourceReads = 0;
		const r = await route.fetch(request());
		const text = await r.text();
		assert.equal(r.status, 503);
		assert.equal(r.headers.get("retry-after"), "5");
		assert.match(text, /status_unavailable/);
		assert.ok(!text.includes("secret-token"));
		assert.ok(!text.includes("failed"));
	}
});

test("status reports failure only for a canonical finalized reverted source receipt", async (t) => {
	setup(t);
	const f = await database(t);
	let reverted = false,
		unfinalized = false;
	const sourceBlock = recorded.reads.find(
		(r: any) =>
			r.method === "eth_getBlockByNumber" && r.params[0] === originalBlock(),
	).result;
	// A coherent earlier provider anchor must hold a reverted transaction pending.
	const opening = {
		number: toHex(BigInt(sourceBlock.number) - 1n),
		hash: "0x" + "cd".repeat(32),
		timestamp: toHex(BigInt(sourceBlock.timestamp) - 12n),
	};
	provider(t, (m, p, v) => {
		if (reverted && m === "eth_getTransactionReceipt" && p[0] === row.tx_hash)
			return { ...v, status: "0x0", logs: [] };
		if (
			unfinalized &&
			m === "eth_getBlockByNumber" &&
			["finalized", opening.number].includes(p[0])
		)
			return structuredClone(opening);
		return v;
	});
	await f.db.query("UPDATE deposits SET status='orphaned'");
	assert.equal(
		(await body(await route.fetch(request()))).status,
		"pending",
		"an index state cannot establish transaction failure",
	);
	reverted = true;
	unfinalized = true;
	const p = await body(await route.fetch(request()));
	assert.equal(p.status, "pending");
	assert.deepEqual(p.deposits[0].renewals, []);
	unfinalized = false;
	const failed = await body(await route.fetch(request()));
	assert.equal(failed.status, "failed");
	assert.equal(failed.deposits[0].reason, "source_transaction_reverted");
	assert.deepEqual(failed.deposits[0].renewals, []);
});
function originalBlock() {
	return toHex(BigInt(row.block_number));
}

test("status admits at most two local requests and releases capacity after failures", async (t) => {
	setup(t);
	let resolve!: (value: any) => void;
	const wait = new Promise((r) => {
		resolve = r;
	});
	const connect = t.mock.method(Pool.prototype, "connect", () => wait);
	const a = route.fetch(request()),
		b = route.fetch(request());
	const limited = await route.fetch(request());
	assert.equal(limited.status, 429);
	assert.equal(limited.headers.get("retry-after"), "5");
	assert.equal(connect.mock.callCount(), 2);
	resolve({
		query: async () => {
			throw new Error("fixture unavailable");
		},
		release: () => {},
	});
	assert.equal((await a).status, 503);
	assert.equal((await b).status, 503);
	assert.equal((await route.fetch(request())).status, 503);
	assert.equal(connect.mock.callCount(), 3);
});
