import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, toHex } from "viem";
import {
	sourceDepositEvidence,
	sourceFinalityEvidence,
	type IndexedSourceDeposit,
	type SourceBlock,
	type SourceReceipt,
	type SourceTransaction,
} from "./source-deposit-evidence";
const abi = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const hash = `0x${"bb".repeat(32)}`,
	blockHash = `0x${"aa".repeat(32)}`;
const sender = "0x1208a26faa0f4ac65b42098419eb4daa5e580ac6",
	steve = "0x5b7516768ed0b04e212041265bb1f11af71841d7",
	vitalik = "0xa61656ca2d2952a46a9d4da0aae01d8d7fe988e0",
	other = "0x3333333333333333333333333333333333333333";
const ethToken = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
	arcToken = "0x3600000000000000000000000000000000000000",
	system = "0xfffffffffffffffffffffffffffffffffffffffe";
const registry = [
	{ label: "steve", address: steve, activatedAt: "2026-01-01T00:00:00.000Z" },
	{ label: "vitalik", address: vitalik, activatedAt: "2026-01-01T00:00:00.000Z" },
];
test("source finality stays separate from indexed membership and waits for a numbered provider anchor", () => {
	const source = { number: "0x64", hash: blockHash, timestamp: "0x64" };
	const earlier = { number: "0x63", hash, timestamp: "0x63" };
	const pending = sourceFinalityEvidence({ source, finalized: earlier, canonicalSource: source, canonicalFinalized: earlier });
	assert.equal(pending.providerFinalized, false);
	assert.deepEqual(pending.sourceBlock, { number: "100", hash: blockHash });
	const final = sourceFinalityEvidence({ source, finalized: source, canonicalSource: source, canonicalFinalized: source });
	assert.equal(final.providerFinalized, true);
	assert.equal("status" in final, false);
	const missing = fixture();
	missing.receipt.logs = [transfer(ethToken, 9, steve, 1000000n)];
	assert.equal(sourceDepositEvidence(missing).representationComplete, false,
		"Finality of the source block does not supply missing indexed membership");
});

test("changed, malformed or contradictory source/finality blocks cannot produce finality evidence", () => {
	const source = { number: "0x64", hash: blockHash, timestamp: "0x64" };
	const finalized = { number: "0x65", hash, timestamp: "0x65" };
	const input = { source, finalized, canonicalSource: source, canonicalFinalized: finalized };
	for (const field of ["canonicalSource", "canonicalFinalized"] as const)
		assert.throws(() => sourceFinalityEvidence({ ...input, [field]: { ...input[field], hash: `0x${"cc".repeat(32)}` } }), /boundary_changed/);
	assert.throws(() => sourceFinalityEvidence({ ...input, canonicalFinalized: { ...finalized, number: "0x66" } }), /boundary_changed/);
	assert.throws(() => sourceFinalityEvidence({ ...input, finalized: { ...finalized, hash: "0x12" } }), /invalid_source_hash/);
	assert.throws(() => sourceFinalityEvidence({ ...input, finalized: { ...finalized, number: "latest" } }), /invalid_source_quantity/);
	const contradictory = { ...finalized, timestamp: "0x63" };
	assert.throws(() => sourceFinalityEvidence({ ...input, finalized: contradictory, canonicalFinalized: contradictory }), /inconsistent_source_finality/);
	const sameHeight = { ...source, hash };
	assert.throws(() => sourceFinalityEvidence({ ...input, finalized: sameHeight, canonicalFinalized: sameHeight }), /inconsistent_source_finality/);
});
function transfer(emitter: string, index: number, to: string, value: bigint, from = sender) {
	return {
		address: emitter,
		logIndex: toHex(index),
		transactionIndex: "0x2",
		transactionHash: hash,
		blockNumber: "0x64",
		blockHash,
		removed: false,
		topics: encodeEventTopics({
			abi,
			eventName: "Transfer",
			args: { from: from as `0x${string}`, to: to as `0x${string}` },
		}) as string[],
		data: encodeAbiParameters(parseAbiParameters("uint256"), [value]),
	};
}
function fixture(chainId = "11155111") {
	const block: SourceBlock = { hash: blockHash, number: "0x64", timestamp: toHex(1790000000) };
	const transaction: SourceTransaction = {
		hash,
		from: sender,
		to: chainId === "5042002" ? arcToken : ethToken,
		value: "0x0",
		blockHash,
		blockNumber: "0x64",
		transactionIndex: "0x2",
	};
	const receipt: SourceReceipt = {
		transactionHash: hash,
		transactionIndex: "0x2",
		blockHash,
		blockNumber: "0x64",
		status: "0x1",
		logs: [],
	};
	return {
		chainId,
		transactionHash: hash,
		block,
		transaction,
		receipt,
		registry: structuredClone(registry),
		watchedAddresses: [steve, vitalik],
		indexed: [] as IndexedSourceDeposit[],
	};
}
function indexed(
	chainId: string,
	label: string,
	amount: string,
	index: number,
	native = false,
): IndexedSourceDeposit {
	const address = label === "steve" ? steve : vitalik,
		token = chainId === "5042002" ? arcToken : ethToken;
	return {
		eventId: `${chainId}:${native ? "native:" : ""}fixture:${index}`,
		label,
		address,
		chainId,
		transactionHash: hash,
		logIndex: index,
		blockNumber: "100",
		sender,
		amount,
		tokenAddress: token,
		canonical: true,
		source: "goldsky",
		status: "finalized",
		facts: { recipient_address: address, sender_address: sender, token_address: token, amount },
	};
}
test("staggered indexing cannot hide a second deposit, even when delivered rows are finalized", () => {
	const f = fixture();
	f.receipt.logs = [
		transfer(ethToken, 9, steve, 1000000n),
		transfer(ethToken, 10, vitalik, 2000000n),
	];
	f.indexed = [indexed(f.chainId, "steve", "1000000", 9)];
	const first = sourceDepositEvidence(f);
	assert.equal(first.members.length, 2);
	assert.equal(first.representationComplete, false);
	assert.deepEqual(first.missingIndexedMembers, [`11155111:${hash}:10`]);
	f.indexed.push(indexed(f.chainId, "vitalik", "2000000", 10));
	const second = sourceDepositEvidence(f);
	assert.equal(second.representationComplete, true);
	assert.deepEqual(
		second.members.map((m) => m.amount),
		["1000000", "2000000"],
	);
	assert.deepEqual(second.missingIndexedMembers, []);
	f.indexed.push(structuredClone(f.indexed[0]));
	assert.equal(
		sourceDepositEvidence(f).representationComplete,
		true,
		"identical redelivery is not an extra economic deposit",
	);
	f.indexed[2].amount = "3";
	assert.throws(() => sourceDepositEvidence(f), /conflicting_index_delivery/);
});

test("an unregistered second recipient blocks receipt-set closure before its late activation and delivery", () => {
	const f = fixture();
	f.receipt.logs = [transfer(ethToken, 9, steve, 1000000n), transfer(ethToken, 10, vitalik, 2000000n)];
	f.registry = [registry[0]];
	f.indexed = [indexed("11155111", "steve", "1000000", 9)];
	const unknown = sourceDepositEvidence(f);
	assert.equal(unknown.representationComplete, true);
	assert.deepEqual(unknown.unregisteredRecipients, [vitalik]);
	assert.equal(unknown.receiptSetClosed, false);
	f.registry = [...registry];
	assert.equal(sourceDepositEvidence(f).receiptSetClosed, false, "Activation alone does not supply the missing indexed member");
	f.indexed.push(indexed("11155111", "vitalik", "2000000", 10));
	assert.equal(sourceDepositEvidence(f).receiptSetClosed, true);
});
test("Arc native receipt identity is separate from its stored top-level transaction position", () => {
	const f = fixture("5042002");
	f.transaction.to = steve;
	f.transaction.value = toHex(11000000000000000000n);
	f.receipt.logs = [transfer(system, 9, steve, 11000000000000000000n)];
	f.indexed = [indexed(f.chainId, "steve", "11000000", 2, true)];
	const e = sourceDepositEvidence(f);
	assert.equal(e.representationComplete, true);
	assert.equal(e.members[0].receiptLogIndex, 9);
	assert.equal(e.members[0].publicLogIndex, null);
	assert.equal(e.members[0].kind, "native_top_level");
	assert.equal(e.members[0].amount, "11000000");
	f.indexed[0].logIndex = 9;
	assert.equal(
		sourceDepositEvidence(f).representationComplete,
		false,
		"a system log position cannot masquerade as the stored transaction position",
	);
});
test("Base and Arbitrum use their own USDC emitters and reject truncated registry evidence", () => {
	for (const [chainId, token] of [
		["84532", "0x036cbd53842c5426634e7929541ec2318f3dcf7e"],
		["421614", "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d"],
	]) {
		const f = fixture(chainId);
		f.transaction.to = token;
		f.receipt.logs = [transfer(token, 9, steve, 1000000n)];
		const row = indexed(chainId, "steve", "1000000", 9);
		row.tokenAddress = token;
		row.facts.token_address = token;
		f.indexed = [row];
		assert.equal(sourceDepositEvidence(f).representationComplete, true);
		f.receipt.logs[0].address = ethToken;
		assert.equal(sourceDepositEvidence(f).members.length, 0);
		f.registry = Array.from({ length: 1001 }, () => registry[0]);
		assert.throws(() => sourceDepositEvidence(f), /source_evidence_limit/);
	}
});
test("Arc system stream exposes internal funding omitted by the top-level native dataset", () => {
	const f = fixture("5042002");
	f.transaction.to = steve;
	f.transaction.value = toHex(1000000000000000000n);
	f.receipt.logs = [
		transfer(system, 9, steve, 1000000000000000000n),
		transfer(system, 10, vitalik, 2000000000000000000n, steve),
	];
	f.indexed = [indexed(f.chainId, "steve", "1000000", 2, true)];
	const e = sourceDepositEvidence(f);
	assert.equal(e.members.length, 2);
	assert.equal(e.members[1].kind, "native_internal");
	assert.equal(e.representationComplete, false);
	assert.deepEqual(e.missingIndexedMembers, [`5042002:${hash}:native:10`]);
	const fake = indexed(f.chainId, "vitalik", "2000000", 2, true);
	fake.eventId += ":internal";
	fake.sender = steve;
	fake.facts.sender_address = steve;
	f.indexed.push(fake);
	assert.equal(
		sourceDepositEvidence(f).representationComplete,
		false,
		"a top-level-shaped row is not evidence for an internal call",
	);
});
test("Arc ERC-20 mirrors count once and identical mixed native/erc20 movements stay ambiguous", () => {
	const f = fixture("5042002");
	f.transaction.from = other;
	f.receipt.logs = [
		transfer(system, 9, steve, 1000000000000000000n),
		transfer(arcToken, 10, steve, 1000000n),
	];
	f.indexed = [indexed(f.chainId, "steve", "1000000", 10)];
	const e = sourceDepositEvidence(f);
	assert.equal(e.members.length, 1);
	assert.equal(e.members[0].publicLogIndex, 10);
	assert.equal(e.members[0].allocationLogIndex, 9, "join the mirror to its unique authoritative system credit");
	assert.equal(e.members[0].sender, sender, "use the log sender, not the relayer");
	assert.equal(e.representationComplete, true);
	f.receipt.logs = [transfer(system, 8, steve, 1000000000000000000n), ...f.receipt.logs];
	const ambiguous = sourceDepositEvidence(f);
	assert.equal(ambiguous.members.length, 2);
	assert.equal(ambiguous.representationComplete, false);
	assert.deepEqual(ambiguous.issues, ["ambiguous_arc_mirror_mapping"]);
	f.receipt.logs.push(transfer(arcToken, 11, steve, 1000000n));
	f.indexed.push(indexed(f.chainId, "steve", "1000000", 11));
	const equalMirrors = sourceDepositEvidence(f);
	assert.equal(equalMirrors.receiptSetClosed, true, "public source identities can close without a unique allocation join");
	assert.ok(equalMirrors.members.every(m => m.allocationLogIndex === null), "equal mirrors have no guessed positional join");
	f.receipt.logs = [transfer(arcToken, 10, steve, 1000000n)];
	assert.throws(() => sourceDepositEvidence(f), /missing_arc_system_transfer/);
});
test("unknown coverage, fractional native precision and empty receipts do not become closed payment proofs", () => {
	const f = fixture();
	assert.equal(sourceDepositEvidence(f).representationComplete, false);
	f.receipt.logs = [
		transfer(ethToken, 9, steve, 1000000n),
		transfer(ethToken, 10, other, 2000000n),
	];
	f.indexed = [indexed(f.chainId, "steve", "1000000", 9)];
	f.watchedAddresses = [];
	assert.equal(sourceDepositEvidence(f).representationComplete, false);
	assert.deepEqual(sourceDepositEvidence(f).unregisteredRecipients, [other]);
	f.watchedAddresses = [steve];
	f.registry[0].activatedAt = "2027-01-01T00:00:00.000Z";
	const current = sourceDepositEvidence(f);
	assert.equal(current.representationComplete, true);
	assert.deepEqual(current.activatedAfterSource, [steve]);
	assert.match(current.coverage, /historical propagation.*not proven/);
	assert.equal("complete" in current, false, "this discovery result is not API payment completion");
	const arc = fixture("5042002");
	arc.receipt.logs = [transfer(system, 0, steve, 1000000000001n)];
	const precision = sourceDepositEvidence(arc);
	assert.equal(precision.members[0].amount, null);
	assert.equal(precision.representationComplete, false);
	assert.deepEqual(precision.issues, ["unsupported_native_precision"]);
	arc.block.timestamp = toHex(1779894516);
	assert.throws(() => sourceDepositEvidence(arc), /unsupported_arc_history/);
});
test("source/index corrections, forged receipts and registry mistakes block matching", () => {
	const original = fixture();
	original.receipt.logs = [transfer(ethToken, 9, steve, 1000000n)];
	original.indexed = [indexed(original.chainId, "steve", "1000000", 9)];
	for (const change of [
		(f: typeof original) => (f.indexed[0].canonical = false),
		(f: typeof original) => (f.indexed[0].status = "orphaned"),
		(f: typeof original) => (f.indexed[0].amount = "999999"),
		(f: typeof original) => (f.indexed[0].facts.amount = "999999"),
		(f: typeof original) => (f.indexed[0].sender = other),
		(f: typeof original) => (f.indexed[0].chainId = "84532"),
	]) {
		const f = structuredClone(original);
		change(f);
		assert.equal(sourceDepositEvidence(f).representationComplete, false);
	}
	for (const change of [
		(f: typeof original) => (f.receipt.blockHash = `0x${"cc".repeat(32)}`),
		(f: typeof original) => (f.receipt.logs[0].removed = true),
		(f: typeof original) => (f.receipt.logs[0].transactionHash = `0x${"cc".repeat(32)}`),
		(f: typeof original) => (f.receipt.logs[0].transactionIndex = "0x3"),
		(f: typeof original) => (f.receipt.status = "0x0"),
		(f: typeof original) => (f.registry[0].address = other),
		(f: typeof original) => (f.receipt.logs[0].data = "0x01"),
	]) {
		const f = structuredClone(original);
		change(f);
		assert.throws(() => sourceDepositEvidence(f));
	}
	const repeated = structuredClone(original);
	repeated.receipt.logs.push(structuredClone(repeated.receipt.logs[0]));
	assert.throws(() => sourceDepositEvidence(repeated), /inconsistent_receipt_log/);
	const spoof = structuredClone(original);
	spoof.receipt.logs[0].address = other;
	assert.equal(sourceDepositEvidence(spoof).members.length, 0);
});

test(
	"real PostgreSQL inspector detects staggered delivery, enforces read-only URL options and rejects mismatched event projections",
	{ skip: !process.env.TEST_DATABASE_URL },
	async (t) => {
		const { Client, Pool } = await import("pg");
		const { randomBytes } = await import("node:crypto");
		const { readFileSync, writeFileSync, unlinkSync } = await import("node:fs");
		const { createServer } = await import("node:http");
		const { spawn } = await import("node:child_process");
		const { createRequire } = await import("node:module");
		const { fileURLToPath } = await import("node:url");
		const { tmpdir } = await import("node:os");
		const base = new URL(process.env.TEST_DATABASE_URL!);
		assert.ok(
			["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
			"disposable source fixture must be local",
		);
		const name = "namepass_source_" + randomBytes(6).toString("hex");
		const admin = new Pool({ connectionString: base.toString(), max: 1 });
		await admin.query(`CREATE DATABASE "${name}"`);
		base.pathname = "/" + name;
		base.searchParams.set(
			"options",
			"-c default_transaction_read_only=off -c statement_timeout=60000",
		);
		const db = new Client({ connectionString: base.toString() });
		await db.connect();
		const f = fixture();
		f.receipt.logs = [
			transfer(ethToken, 9, steve, 1000000n),
			transfer(ethToken, 10, vitalik, 2000000n),
		];
		let providerFailure = false;
		let oversized = false;
		let finalityMode: "final" | "pending" | "changed" | "unavailable" = "final";
		let correctDuringSourceRead = false;
		const methods: string[] = [];
		const server = createServer(async (req, res) => {
			let raw = "";
			for await (const chunk of req) raw += chunk;
			const p = JSON.parse(raw);
			methods.push(p.method);
			if (correctDuringSourceRead && p.method === "eth_getBlockByNumber" && p.id === 7) {
				correctDuringSourceRead = false;
				await db.query("UPDATE chain_events SET canonical=false WHERE log_index=9");
			}
			const values: Record<string, unknown> = {
				eth_chainId: "0xaa36a7",
				eth_getTransactionReceipt: f.receipt,
				eth_getTransactionByHash: f.transaction,
				eth_getBlockByNumber: f.block,
			};
			if (p.method === "eth_getBlockByNumber") {
				if (p.params[0] === "finalized" && finalityMode === "unavailable") values[p.method] = null;
				else if (finalityMode === "pending" && ["finalized", "0x63"].includes(p.params[0]))
					values[p.method] = { ...f.block, number: "0x63", hash, timestamp: toHex(1789999999) };
				else if (finalityMode === "changed" && p.id === 7)
					values[p.method] = { ...f.block, hash };
			}
			res.setHeader("Content-Type", "application/json");
			if (oversized) {
				res.end(JSON.stringify({ jsonrpc: "2.0", id: p.id, result: "x".repeat(2 * 1024 * 1024) }));
				return;
			}
			res.end(
				JSON.stringify({
					jsonrpc: "2.0",
					id: p.id,
					...(providerFailure
						? { error: { code: -32000, message: "private-provider-secret" } }
						: { result: values[p.method] }),
				}),
			);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as { port: number }).port;
		t.after(async () => {
			await new Promise<void>((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve())),
			);
			// Client.end waits for the socket to close; Pool.end can resolve before it does.
			await db.end();
			await admin.query(`DROP DATABASE "${name}"`);
			await admin.end();
		});
		const journal = JSON.parse(
			readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
		);
		for (const entry of journal.entries)
			await db.query(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"));
		const ids: string[] = [];
		for (const [i, n] of registry.entries()) {
			const r = await db.query(
				"INSERT INTO names(normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at,activated_at) VALUES($1,$2,$3,$4,$5,now(),'2026-01-01') RETURNING id",
				[
					n.label,
					n.label + ".eth",
					"0x" + String(i + 1).repeat(64),
					"0x" + String(i + 3).repeat(64),
					n.address,
				],
			);
			ids.push(r.rows[0].id);
			await db.query("INSERT INTO goldsky.watched_addresses(value) VALUES($1)", [n.address]);
		}
		async function deliver(i: number) {
			const row = indexed("11155111", registry[i].label, i ? "2000000" : "1000000", 9 + i);
			await db.query(
				"INSERT INTO chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts) VALUES($1,'deposit','Transfer','11155111',$2,$3,100,to_timestamp(1790000000),'c',true,$4)",
				[row.eventId, hash, row.logIndex, JSON.stringify(row.facts)],
			);
			await db.query(
				"INSERT INTO deposits(event_id,name_id,chain_id,token_address,sender_address,amount,tx_hash,log_index,block_number,block_time,source,status) VALUES($1,$2,'11155111',$3,$4,$5,$6,$7,100,to_timestamp(1790000000),'goldsky','finalized')",
				[row.eventId, ids[i], ethToken, sender, row.amount, hash, row.logIndex],
			);
		}
		const require = createRequire(new URL("../package.json", import.meta.url));
		const manifest = new URL(`../.transaction-fixture-${name}.json`, import.meta.url);
		writeFileSync(manifest, JSON.stringify({ chainId: "11155111", transactionHash: hash, throughBlock: "100", renewals: [] }));
		t.after(() => unlinkSync(manifest));
		async function run(transaction = false) {
			const c = spawn(
				process.execPath,
				[
					"--import",
					require.resolve("tsx"),
					fileURLToPath(new URL(transaction ? "../scripts/public-api/transaction-evidence.ts" : "../scripts/public-api/source-deposits.ts", import.meta.url)),
					...(transaction ? [fileURLToPath(manifest)] : ["11155111", hash]),
				],
				{
					cwd: transaction ? tmpdir() : undefined,
					env: {
						PATH: process.env.PATH,
						DATABASE_URL: base.toString(),
						ETHEREUM_SEPOLIA_RPC_URL: `http://127.0.0.1:${port}`,
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			let out = "",
				err = "";
			c.stdout.on("data", (s) => (out += s));
			c.stderr.on("data", (s) => (err += s));
			const code = await new Promise<number | null>((resolve, reject) => {
				c.on("error", reject);
				c.on("close", resolve);
			});
			return { code, out, err };
		}

		async function runStatus() {
			const code = `import assert from 'node:assert/strict';import pg from 'pg';
const {Pool}=pg;const connect=Pool.prototype.connect;let pool,reads=0;
Pool.prototype.connect=async function(...args){pool=this;assert.equal(this.options.max,2);const c=await connect.call(this,...args);assert.equal((await c.query("SELECT current_setting('transaction_read_only') AS value")).rows[0].value,'on');reads++;return c;};
const {default:route}=await import(${JSON.stringify(new URL('../routes/api/v1/status/[chainId].ts', import.meta.url).href)});
try {const response=await route.fetch(new Request('https://status.test/api/v1/status/11155111?transactionHash=${hash}'));console.log(JSON.stringify({httpStatus:response.status,body:await response.json(),reads}));}finally{await pool?.end();}`;
			const c = spawn(process.execPath, ["--import", require.resolve("tsx"), "--input-type=module", "-e", code], {
				env: { PATH: process.env.PATH, DATABASE_URL: base.toString(), NAMEPASS_PUBLIC_STATUS_ENABLED: "1", ETHEREUM_SEPOLIA_RPC_URL: `http://127.0.0.1:${port}` },
				stdio: ["ignore", "pipe", "pipe"],
			});
			let out = "", err = "";
			c.stdout.on("data", s => out += s);c.stderr.on("data", s => err += s);
			const exit = await new Promise((resolve,reject)=>{c.on("error",reject);c.on("close",resolve);});
			assert.equal(exit, 0, err);
			const lines=out.trim().split("\n");return JSON.parse(lines[lines.length-1]);
		}
		await deliver(0);
		const first = await run();
		assert.equal(first.code, 0, first.err);
		const a = JSON.parse(first.out);
		assert.equal(a.readOnly, true);
		assert.equal(a.rpcCalls, 7);
		assert.equal(a.sourceFinality.providerFinalized, true);
		assert.equal(a.evidence.representationComplete, false);
		assert.equal(a.evidence.receiptSetClosed, false);
		assert.deepEqual(a.evidence.missingIndexedMembers, [`11155111:${hash}:10`]);
		assert.equal(a.evidence.members.length, 2);
		const combinedPending = await run(true);
		assert.equal(combinedPending.code, 0, combinedPending.err);
		assert.equal(JSON.parse(combinedPending.out).evidence.evidenceComplete, false);
		assert.ok(JSON.parse(combinedPending.out).evidence.reasons.includes("source_set_open"));
		const httpPending = await runStatus();
		assert.equal(httpPending.httpStatus, 200);
		assert.equal(httpPending.reads, 2, "the actual HTTP adapter overrides writable URL options for both PostgreSQL snapshots");
		assert.equal(httpPending.body.status, "pending");
		assert.equal(httpPending.body.deposits.length, 2);
		correctDuringSourceRead = true;
		const httpCorrected = await runStatus();
		assert.equal(httpCorrected.httpStatus, 503);
		assert.equal(httpCorrected.body.error.code, "status_unavailable");
		await db.query("UPDATE chain_events SET canonical=true WHERE log_index=9");
		correctDuringSourceRead = true;
		const corrected = await run(true);
		assert.equal(corrected.code, 1);
		assert.equal(corrected.out, "");
		assert.match(corrected.err, /transaction_inspection_unavailable/);
		await db.query("UPDATE chain_events SET canonical=true WHERE log_index=9");
		await deliver(1);
		const second = await run();
		assert.equal(second.code, 0, second.err);
		assert.equal(JSON.parse(second.out).evidence.representationComplete, true);
		assert.equal(JSON.parse(second.out).evidence.receiptSetClosed, true);
		finalityMode = "pending";
		const pending = await run();
		assert.equal(pending.code, 0, pending.err);
		assert.equal(JSON.parse(pending.out).evidence.representationComplete, true);
		assert.equal(JSON.parse(pending.out).sourceFinality.providerFinalized, false);
		for (const mode of ["changed", "unavailable"] as const) {
			finalityMode = mode;
			const invalid = await run();
			assert.equal(invalid.code, 1);
			assert.equal(invalid.out, "");
			assert.match(invalid.err, /source_inspection_unavailable/);
		}
		finalityMode = "final";
		assert.equal((await db.query("SELECT count(*)::int n FROM deposits")).rows[0].n, 2);
		await db.query("UPDATE chain_events SET chain_id=421614 WHERE log_index=9");
		const calls = methods.length;
		const projection = await run();
		assert.equal(projection.code, 1);
		assert.equal(methods.length, calls, "inconsistent projected identity is rejected before RPC");
		assert.equal(projection.out, "");
		assert.match(projection.err, /source_inspection_unavailable/);
		await db.query("UPDATE chain_events SET chain_id=11155111 WHERE log_index=9");
		providerFailure = true;
		const outage = await run();
		assert.equal(outage.code, 1);
		assert.ok(!outage.err.includes("private-provider-secret"));
		assert.equal(outage.out, "");
		providerFailure = false;
		oversized = true;
		const excess = await run();
		assert.equal(excess.code, 1);
		assert.equal(excess.out, "");
		assert.match(excess.err, /source_inspection_unavailable/);
		assert.ok(
			methods.every((m) =>
				[
					"eth_chainId",
					"eth_getTransactionReceipt",
					"eth_getTransactionByHash",
					"eth_getBlockByNumber",
				].includes(m),
			),
		);
	},
);
