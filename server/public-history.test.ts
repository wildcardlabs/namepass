import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import {
	encodeAbiParameters,
	encodeEventTopics,
	encodeFunctionResult,
	toFunctionSelector,
	keccak256,
	parseAbi,
	parseAbiParameters,
	stringToHex,
} from "viem";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import route from "../routes/api/v1/names/[name]/renewals";
import { HUB_CHAIN } from "../src/lib/chains";
import { depositAddress } from "../src/lib/namepass";

const hash = `0x${"12".repeat(32)}` as const;
const blockHash = `0x${"34".repeat(32)}` as const;
const executor = "0x1111111111111111111111111111111111111111";
const blockTime = new Date("2026-10-05T12:00:00.000Z");
const renewalAbi = parseAbi([
	"event Renewed(bytes32 indexed labelHash, address indexed wallet, address indexed executor, string label, uint64 duration, uint256 amountReceived, uint256 gasAllowance, uint256 amountApplied, uint256 remainder, bool fromCCTP)",
]);
const claimAbi = parseAbi([
	"event CCTPClaimed(bytes32 indexed nonce, address indexed wallet, uint32 sourceDomain, uint256 burnAmount, uint256 feeExecuted, uint256 mintedAmount)",
]);
const helperRuntime = readFileSync(
	new URL("../test/fixtures/public-quote/helper-runtime.hex", import.meta.url),
	"utf8",
).trim();
const helper = "0x2222222222222222222222222222222222222222";
const helperAbi = parseAbi([
	"event HelperUsed(address indexed helper, bytes32 indexed labelHash, address indexed wallet)",
	"function ethRegistrar() view returns (address)",
	"function ethRenewerV1() view returns (address)",
	"function referrer() view returns (bytes32)",
]);
const ensAbi = parseAbi([
	"event NameRenewed(uint256 indexed tokenId, string label, uint64 duration, uint64 newExpiry, address paymentToken, bytes32 indexed referrer, uint256 amount)",
]);
const spec = JSON.parse(readFileSync(new URL("../docs/api/openapi.json", import.meta.url), "utf8"));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const valid = ajv.compile<any>({
	$ref: "#/components/schemas/HistoryResponse",
	components: spec.components,
});
function setup(t: TestContext, enabled = "1") {
	const saved = { ...process.env };
	process.env.NAMEPASS_PUBLIC_HISTORY_ENABLED = enabled;
	process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/history";
	process.env[HUB_CHAIN.rpcEnv] = "https://rpc.test/history";
	delete process.env.NAMEPASS_MAINTENANCE;
	t.after(() => {
		for (const key of [
			"NAMEPASS_PUBLIC_HISTORY_ENABLED",
			"DATABASE_URL",
			HUB_CHAIN.rpcEnv,
			"NAMEPASS_MAINTENANCE",
		]) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});
}
function request(name = "ALICE.eth", search = "", method = "GET") {
	return new Request(`https://history.test/api/v1/names/${name}/renewals${search}`, { method });
}
function facts(label = "alice", fromCctp = false) {
	return {
		contract_address: HUB_CHAIN.gatewayAddress!.toLowerCase(),
		label_hash: keccak256(stringToHex(label)),
		wallet_address: depositAddress(label).toLowerCase(),
		executor_address: executor,
		label,
		duration: "100",
		amount_received: "1000000",
		gas_allowance: "100000",
		amount_applied: "900000",
		remainder: "0",
		from_cctp: String(fromCctp),
		new_expiry: "1900000000",
	};
}
function log(label: string, index: number, fromCctp: boolean) {
	return {
		address: HUB_CHAIN.gatewayAddress!,
		logIndex: `0x${index.toString(16)}`,
		blockNumber: "0x64",
		blockHash,
		transactionHash: hash,
		transactionIndex: "0x0",
		removed: false,
		data: encodeAbiParameters(
			parseAbiParameters("string,uint64,uint256,uint256,uint256,uint256,bool"),
			[label, 100n, 1000000n, 100000n, 900000n, 0n, fromCctp],
		),
		topics: encodeEventTopics({
			abi: renewalAbi,
			eventName: "Renewed",
			args: {
				labelHash: keccak256(stringToHex(label)),
				wallet: depositAddress(label) as `0x${string}`,
				executor,
			},
		}),
	};
}
function claim() {
	return {
		...log("alice", 2, false),
		data: encodeAbiParameters(parseAbiParameters("uint32,uint256,uint256,uint256"), [
			6,
			1000000n,
			0n,
			1000000n,
		]),
		topics: encodeEventTopics({
			abi: claimAbi,
			eventName: "CCTPClaimed",
			args: { nonce: `0x${"0".repeat(63)}7`, wallet: depositAddress("alice") as `0x${string}` },
		}),
	};
}
function helperLog(label: string, index: number, wrongWallet = false) {
	return {
		...log(label, index, false),
		data: "0x",
		topics: encodeEventTopics({
			abi: helperAbi,
			eventName: "HelperUsed",
			args: {
				helper,
				labelHash: keccak256(stringToHex(label)),
				wallet: (wrongWallet ? executor : depositAddress(label)) as `0x${string}`,
			},
		}),
	};
}
function ensLog(
	label: string,
	index: number,
	expiry: bigint,
	options: {
		wrongDuration?: boolean;
		wrongAmount?: boolean;
		wrongReferrer?: boolean;
		wrongToken?: boolean;
		fakeEns?: boolean;
	} = {},
) {
	return {
		...log(label, index, false),
		address: options.fakeEns ? executor : HUB_CHAIN.ensRegistrarAddress!,
		topics: encodeEventTopics({
			abi: ensAbi,
			eventName: "NameRenewed",
			args: {
				tokenId: 42n,
				referrer: (options.wrongReferrer
					? `0x${"ff".repeat(32)}`
					: HUB_CHAIN.ensReferrer!) as `0x${string}`,
			},
		}),
		data: encodeAbiParameters(parseAbiParameters("string,uint64,uint64,address,uint256"), [
			label,
			options.wrongDuration ? 101n : 100n,
			expiry,
			(options.wrongToken ? executor : HUB_CHAIN.usdcAddress) as `0x${string}`,
			options.wrongAmount ? 899999n : 900000n,
		]),
	};
}
function rpc(
	t: TestContext,
	options: {
		outage?: boolean;
		wrongChain?: boolean;
		reorg?: boolean;
		missing?: boolean;
		forged?: boolean;
		claimMismatch?: boolean;
		timestampMismatch?: boolean;
		finalityLag?: boolean;
		missingFinality?: boolean;
		badFinalityHash?: boolean;
		wrongDuration?: boolean;
		wrongAmount?: boolean;
		wrongReferrer?: boolean;
		wrongToken?: boolean;
		fakeEns?: boolean;
		missingEns?: boolean;
		duplicateEns?: boolean;
		wrongHelperWallet?: boolean;
		unsupportedMetadata?: boolean;
		archiveFailure?: boolean;
		unsupportedCode?: boolean;
		wrongLogMembership?: boolean;
		removedLog?: boolean;
	} = {},
) {
	const calls: string[] = [];
	const mock = t.mock.method(
		globalThis,
		"fetch",
		async (_url: string | URL | Request, init?: RequestInit) => {
			if (options.outage) throw new Error("private provider credential");
			assert.ok(init?.signal);
			const payload = JSON.parse(String(init.body));
			const answer = (call: { id: number; method: string; params: any[] }) => {
				calls.push(call.method);
				let result: unknown;
				if (call.method === "eth_chainId")
					result = options.wrongChain ? "0x1" : `0x${HUB_CHAIN.chainId.toString(16)}`;
				else if (call.method === "eth_getTransactionReceipt")
					result = options.missing
						? null
						: {
								transactionHash: call.params[0],
								blockHash,
								blockNumber: "0x64",
								transactionIndex: "0x0",
								status: "0x1",
								type: "0x2",
								from: executor,
								to: HUB_CHAIN.gatewayAddress,
								cumulativeGasUsed: "0x100",
								gasUsed: "0x100",
								effectiveGasPrice: "0x1",
								logsBloom: `0x${"00".repeat(256)}`,
								logs: [
									...(options.duplicateEns ? [ensLog("alice", 1, 1900000000n)] : []),
									claim(),
									...(options.missingEns ? [] : [ensLog("alice", 3, 1900000000n, options)]),
									helperLog("alice", 4, options.wrongHelperWallet),
									log("alice", 5, true),
									ensLog("alice", 7, 1900000100n, options),
									helperLog("alice", 8, options.wrongHelperWallet),
									log("alice", 9, false),
									ensLog("steve", 10, 1900000200n),
									helperLog("steve", 11),
									log("steve", 12, false),
								]
									.map((log) =>
										options.wrongLogMembership
											? { ...log, blockHash: `0x${"ee".repeat(32)}` }
											: options.removedLog
												? { ...log, removed: true }
												: log,
									)
									.map((log) =>
										options.forged && log.logIndex === "0x9" ? { ...log, address: executor } : log,
									)
									.map((log) =>
										options.claimMismatch && log.logIndex === "0x2"
											? {
													...log,
													data: encodeAbiParameters(
														parseAbiParameters("uint32,uint256,uint256,uint256"),
														[3, 1000000n, 0n, 1000000n],
													),
												}
											: log,
									),
							};
				else if (call.method === "eth_getBlockByNumber")
					result =
						call.params[0] === "finalized" && options.missingFinality
							? null
							: {
									number: call.params[0] === "finalized" && options.finalityLag ? "0x63" : "0x64",
									hash:
										options.reorg || (call.params[0] === "finalized" && options.badFinalityHash)
											? `0x${"56".repeat(32)}`
											: blockHash,
									timestamp: `0x${(BigInt(blockTime.getTime() / 1000) + (options.timestampMismatch ? 1n : 0n)).toString(16)}`,
									transactions: [],
									gasLimit: "0x10000",
									gasUsed: "0x100",
									size: "0x1",
									difficulty: "0x0",
									extraData: "0x",
									parentHash: blockHash,
								};
				else if (call.method === "eth_getCode") {
					assert.equal(call.params[0].toLowerCase(), helper.toLowerCase());
					assert.equal(call.params[1], "0x64");
					result = options.unsupportedCode ? "0x1234" : helperRuntime;
				} else if (call.method === "eth_call") {
					if (options.archiveFailure) throw new Error("private provider credential");
					assert.equal(
						call.params[0].to.toLowerCase(),
						helper.toLowerCase(),
						"read the helper selected in this receipt",
					);
					assert.equal(call.params[1], "0x64", "metadata reads use the renewal block, not latest");
					const name = ["ethRegistrar", "ethRenewerV1", "referrer"].find(
						(name) => toFunctionSelector(name + "()") === call.params[0].data,
					)!;
					assert.ok(name, "only known metadata reads are allowed");
					const value =
						name === "ethRegistrar"
							? options.unsupportedMetadata
								? executor
								: HUB_CHAIN.ensRegistrarAddress!
							: name === "ethRenewerV1"
								? HUB_CHAIN.ensRenewerV1Address!
								: HUB_CHAIN.ensReferrer!;
					result = encodeFunctionResult({
						abi: helperAbi,
						functionName: name as "ethRegistrar" | "ethRenewerV1" | "referrer",
						result: value as `0x${string}`,
					});
				} else throw new Error("unexpected RPC method");
				return { id: call.id, jsonrpc: "2.0", result };
			};
			return Response.json(Array.isArray(payload) ? payload.map(answer) : answer(payload));
		},
	);
	return { calls, mock };
}
async function fixture(t: TestContext) {
	const db = new PGlite();
	t.after(() => db.close());
	for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
		.filter((file) => /^000[0-8]_.*\.sql$/.test(file))
		.sort())
		await db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
	const queries: string[] = [];
	// Replace only transport: the route's real SQL and transaction run in PostgreSQL.
	t.mock.method(Pool.prototype, "connect", async () => ({
		query: async (sql: string, values: unknown[] = []) => {
			queries.push(sql);
			return db.query(sql, values);
		},
		release: () => {},
	}));
	for (const [label, id] of [
		["alice", 1],
		["steve", 2],
	] as const)
		await db.query(
			"INSERT INTO names(id,normalized_label,display_name,label_hash,namehash,deposit_address,current_expiry,ens_synced_at) VALUES($1,$2,$3,$4,$5,$6,'2030-03-17T17:46:40Z','2026-10-05T13:00:00Z')",
			[
				`00000000-0000-0000-0000-${String(id).padStart(12, "0")}`,
				label,
				`${label}.eth`,
				keccak256(stringToHex(label)),
				keccak256(stringToHex(label + ".eth")),
				depositAddress(label),
			],
		);
	for (const [label, id, index, cross] of [
		["alice", 1, 5, true],
		["alice", 1, 9, false],
		["steve", 2, 12, false],
	] as const) {
		await db.query(
			"INSERT INTO chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,facts) VALUES($1,'namepass','Renewed',11155111,$2,$3,100,$4,'c',$5)",
			[`renewal-${index}`, hash, index, blockTime, JSON.stringify(facts(label, cross))],
		);
		await db.query(
			"INSERT INTO flows(id,name_id,origin_chain_id,trigger,status,amount_detected,amount_processed,cctp_nonce,renewal_event_id) VALUES($1,$2,$3,'external','settled',1000000,1000000,$4,$5)",
			[
				`10000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
				`00000000-0000-0000-0000-${String(id).padStart(12, "0")}`,
				cross ? 84532 : 11155111,
				cross ? "7" : null,
				`renewal-${index}`,
			],
		);
	}
	return { db, queries };
}
test("history methods, disabled state and bad input use JSON/CORS without DB or RPC", async (t) => {
	setup(t, "");
	const connect = t.mock.method(Pool.prototype, "connect", () => {
		throw new Error("must not connect");
	});
	const network = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("must not fetch");
	});
	assert.equal((await route.fetch(request())).status, 503);
	assert.equal((await route.fetch(request("alice.eth", "", "POST"))).status, 405);
	const preflight = await route.fetch(request("alice.eth", "", "OPTIONS"));
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
	process.env.NAMEPASS_PUBLIC_HISTORY_ENABLED = "1";
	for (const [name, search] of [
		["sub.alice.eth", ""],
		["alice.eth", "?limit=0"],
		["alice.eth", "?limit=101"],
		["alice.eth", "?limit=1.0"],
		["alice.eth", "?limit=1&limit=2"],
		["alice.eth", "?page=1"],
		["alice.eth", "?cursor="],
	])
		assert.equal((await route.fetch(request(name, search))).status, 400);
	assert.equal(connect.mock.callCount(), 0);
	assert.equal(network.mock.callCount(), 0);
});
test("history reads established schema, proves exact event/provenance, and paginates equal timestamps", async (t) => {
	setup(t);
	const { db, queries } = await fixture(t);
	const network = rpc(t);
	const first = await route.fetch(request("ALICE.eth", "?limit=1"));
	assert.equal(first.status, 200, await first.clone().text());
	assert.equal(first.headers.get("cache-control"), "no-store");
	const page = await first.json();
	assert.ok(valid(page), JSON.stringify(valid.errors));
	assert.equal(page.name, "alice.eth");
	assert.equal(page.expiryUpdatedAt, null);
	assert.equal(page.currentExpiry, "2030-03-17T17:46:40.000Z");
	assert.equal(page.items.length, 1);
	assert.equal(page.items[0].renewalId, `11155111:${hash}:9`);
	assert.equal(page.items[0].sourceChainId, "11155111");
	assert.equal(page.items[0].status, "complete");
	assert.equal(page.items[0].expiry, "2030-03-17T17:48:20.000Z");
	assert.equal(first.headers.get("retry-after"), null);
	const second = await route.fetch(request("alice", `?limit=1&cursor=${page.nextCursor}`));
	assert.equal(second.status, 200, await second.clone().text());
	const older = await second.json();
	assert.ok(valid(older), JSON.stringify(valid.errors));
	assert.equal(older.items[0].renewalId, `11155111:${hash}:5`);
	assert.equal(older.items[0].sourceChainId, "84532");
	assert.equal(older.items[0].expiry, "2030-03-17T17:46:40.000Z");
	assert.equal(older.items[0].status, "complete");
	assert.equal(older.nextCursor, null);
	assert.equal((await route.fetch(request("steve.eth", `?cursor=${page.nextCursor}`))).status, 400);
	const all = await (await route.fetch(request())).json();
	assert.equal(all.items.length, 2);
	assert.equal(
		network.calls.filter((x) => x === "eth_getTransactionReceipt").length,
		3,
		"same transaction is fetched once per request, including both renewal events",
	);
	assert.equal(
		network.calls.filter((method) => method === "eth_call").length,
		9,
		"the selected helper/block metadata is read once per request, including shared receipt events",
	);
	assert.ok(queries.some((q) => q === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
	assert.ok(
		queries.every((q) => /^(SELECT|BEGIN|COMMIT|ROLLBACK)/.test(q.trim())),
		"history must not write any records",
	);
	assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM flows")).rows[0].n, 3);
	assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM names")).rows[0].n, 2);
});
test("a canonical renewal awaits finality without hiding its proven event-specific expiry", async (t) => {
	setup(t);
	await fixture(t);
	rpc(t, { finalityLag: true });
	const response = await route.fetch(request());
	assert.equal(response.status, 200, await response.clone().text());
	const body = await response.json();
	assert.ok(valid(body), JSON.stringify(valid.errors));
	assert.deepEqual(
		body.items.map((item: any) => item.status),
		["processing", "processing"],
	);
	assert.deepEqual(
		body.items.map((item: any) => item.expiry),
		["2030-03-17T17:48:20.000Z", "2030-03-17T17:46:40.000Z"],
	);
	assert.equal(response.headers.get("retry-after"), "5");
});
test("late indexing, corrected events and changing expiry do not cause cursor skips or false freshness", async (t) => {
	setup(t);
	const { db } = await fixture(t);
	rpc(t);
	const page = await (await route.fetch(request("alice.eth", "?limit=1"))).json();
	// Remove the pending older row, then deliver it after the first page was already read.
	await db.query("UPDATE chain_events SET canonical=false WHERE event_id='renewal-5'");
	assert.equal((await (await route.fetch(request())).json()).items.length, 1);
	await db.query("UPDATE chain_events SET canonical=true WHERE event_id='renewal-5'");
	const late = await (await route.fetch(request("alice", `?cursor=${page.nextCursor}`))).json();
	assert.equal(late.items[0].renewalId, `11155111:${hash}:5`);
	for (const expiry of ["2031-01-01T00:00:00Z", "2029-01-01T00:00:00Z", null]) {
		await db.query("UPDATE names SET current_expiry=$1 WHERE normalized_label='alice'", [expiry]);
		const body = await (await route.fetch(request())).json();
		assert.equal(body.expiryUpdatedAt, null);
		assert.equal(body.currentExpiry, expiry ? new Date(expiry).toISOString() : null);
	}
	const missing = await route.fetch(request("unknown.eth"));
	assert.equal(missing.status, 404);
});
test("receipt/provider failures and inconsistent provenance return retryable 503, never guessed history", async (t) => {
	setup(t);
	const { db } = await fixture(t);
	for (const option of [
		"outage",
		"wrongChain",
		"reorg",
		"missing",
		"forged",
		"claimMismatch",
		"timestampMismatch",
		"missingFinality",
		"badFinalityHash",
		"wrongDuration",
		"wrongAmount",
		"wrongReferrer",
		"wrongToken",
		"fakeEns",
		"missingEns",
		"duplicateEns",
		"wrongHelperWallet",
		"unsupportedMetadata",
		"archiveFailure",
		"unsupportedCode",
		"wrongLogMembership",
		"removedLog",
	] as const) {
		const mock = rpc(t, { [option]: true });
		const response = await route.fetch(request());
		assert.equal(response.status, 503, option);
		assert.equal(response.headers.get("retry-after"), "5");
		const body = await response.json();
		assert.equal(body.error.code, "history_unavailable");
		assert.ok(!JSON.stringify(body).includes("private provider"));
		mock.mock.mock.restore();
	}
	rpc(t);
	await db.query("UPDATE flows SET origin_chain_id=421614 WHERE renewal_event_id='renewal-5'");
	assert.equal((await route.fetch(request())).status, 503);
});
test("two stalled history reads enforce capacity and release it after failure", async (t) => {
	setup(t);
	let reject!: (error: Error) => void;
	const stalled = new Promise<never>((_resolve, r) => {
		reject = r;
	});
	t.mock.method(Pool.prototype, "connect", () => stalled);
	const pending = [route.fetch(request()), route.fetch(request())];
	const busy = await route.fetch(request());
	assert.equal(busy.status, 429);
	assert.equal(busy.headers.get("retry-after"), "5");
	reject(new Error("unavailable"));
	assert.deepEqual(
		(await Promise.all(pending)).map((r) => r.status),
		[503, 503],
	);
	assert.equal((await route.fetch(request())).status, 503);
});

test(
	"real PostgreSQL history connection is read-only and serves activated empty names without RPC",
	{ skip: !process.env.TEST_DATABASE_URL },
	async (t) => {
		const base = new URL(process.env.TEST_DATABASE_URL!);
		assert.ok(
			["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
			"disposable history fixture must be local",
		);
		const fixtureName = `namepass_history_${crypto.randomUUID().replace(/-/g, "")}`;
		const admin = new Pool({ connectionString: base.toString() });
		await admin.query(`CREATE DATABASE "${fixtureName}"`);
		base.pathname = `/${fixtureName}`;
		base.searchParams.set(
			"options",
			"-c default_transaction_read_only=off -c statement_timeout=60000",
		);
		const db = new Pool({ connectionString: base.toString() });
		t.after(async () => {
			await db.end();
			await admin.query(`DROP DATABASE "${fixtureName}"`);
			await admin.end();
		});
		for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
			.filter((file) => /^000[0-8]_.*\.sql$/.test(file))
			.sort())
			await db.query(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
		await db.query(
			"INSERT INTO names(normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at) VALUES('alice','alice.eth',$1,$2,$3,now())",
			[
				keccak256(stringToHex("alice")),
				keccak256(stringToHex("alice.eth")),
				depositAddress("alice"),
			],
		);
		const { spawn } = await import("node:child_process");
		const { createRequire } = await import("node:module");
		const require = createRequire(import.meta.url);
		const script = `
 import assert from 'node:assert/strict';import {Pool} from 'pg';import route from './routes/api/v1/names/[name]/renewals.ts';
 const connect=Pool.prototype.connect;let pool;let reads=0;
 Pool.prototype.connect=async function(...args){assert.equal(args.length,0);pool=this;const client=await connect.call(this);assert.equal((await client.query("SELECT current_setting('transaction_read_only') AS value")).rows[0].value,'on');reads++;return client;};
 globalThis.fetch=async()=>{throw new Error('empty history must not call RPC');};
 try {const response=await route.fetch(new Request('https://history.test/api/v1/names/ALICE.eth/renewals'));assert.equal(response.status,200,await response.clone().text());assert.deepEqual(await response.json(),{name:'alice.eth',currentExpiry:null,expiryUpdatedAt:null,items:[],nextCursor:null});assert.equal((await route.fetch(new Request('https://history.test/api/v1/names/unknown.eth/renewals'))).status,404);assert.equal(reads,2);console.log(JSON.stringify({readOnly:true,emptyHistory:true,unknownName:404}));}finally{if(pool)await pool.end();}
 `;
		const child = spawn(
			process.execPath,
			["--import", require.resolve("tsx"), "--input-type=module", "-e", script],
			{
				cwd: new URL("../", import.meta.url),
				env: {
					...process.env,
					DATABASE_URL: base.toString(),
					NAMEPASS_PUBLIC_HISTORY_ENABLED: "1",
					NAMEPASS_MAINTENANCE: "0",
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		const code = await new Promise<number | null>((resolve, reject) => {
			child.on("error", reject);
			child.on("close", resolve);
		});
		assert.equal(code, 0, output);
		assert.match(output, /"readOnly":true/);
		const counts = (
			await db.query(
				"SELECT (SELECT count(*)::int FROM names) AS names,(SELECT count(*)::int FROM chain_events) AS events,(SELECT count(*)::int FROM flows) AS flows",
			)
		).rows[0];
		assert.deepEqual(counts, { names: 1, events: 0, flows: 0 });
	},
);

test("failed database reads discard the connection and sanitize retryable errors", async (t) => {
	setup(t);
	const released: boolean[] = [];
	t.mock.method(Pool.prototype, "connect", async () => ({
		query: async (sql: string) => {
			if (sql.startsWith("SELECT")) throw new Error("private database credential");
			return { rows: [] };
		},
		release: (discard: boolean) => released.push(discard),
	}));
	const response = await route.fetch(request());
	assert.equal(response.status, 503);
	assert.equal((await response.json()).error.code, "history_unavailable");
	assert.equal(response.headers.get("retry-after"), "5");
	assert.deepEqual(released, [true]);
});
