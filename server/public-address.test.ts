import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { decodeFunctionData, encodeFunctionResult, parseAbi, zeroAddress, type Hex } from "viem";
import Ajv from "ajv/dist/2020.js";
import route from "../routes/api/v1/address";
import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { database } from "./db/client";
import { activateName } from "./names";

const abi = parseAbi([
	"function currentHelper() view returns (address)",
	"function gateway() view returns (address)",
	"function pointer() view returns (address)",
	"function interfaceVersion() view returns (uint256)",
	"function factory() view returns (address)",
	"function paymentToken() view returns (address)",
	"function ethRegistrar() view returns (address)",
	"function ethRenewerV1() view returns (address)",
	"function referrer() view returns (bytes32)",
	"function nameState(string label) view returns (uint256 expiry,address renewer)",
	"function balanceOf(address account) view returns (uint256)",
]);
const ajv = new Ajv({ strict: false });
const spec = JSON.parse(readFileSync(new URL("../docs/api/openapi.json", import.meta.url), "utf8"));
const validResponse = ajv.compile({
	...spec.components.schemas.AddressResponse,
	$defs: { FundingChain: spec.components.schemas.FundingChain },
	properties: {
		...spec.components.schemas.AddressResponse.properties,
		chains: { type: "array", items: { $ref: "#/$defs/FundingChain" } },
	},
});
function setup(t: TestContext) {
	const keys = [
		"NAMEPASS_PUBLIC_ADDRESS_ENABLED",
		"NAMEPASS_MAINTENANCE",
		"DATABASE_URL",
		...SERVER_CHAINS.map((chain) => chain.rpcEnv),
	];
	const saved = { ...process.env };
	process.env.NAMEPASS_PUBLIC_ADDRESS_ENABLED = "1";
	delete process.env.NAMEPASS_MAINTENANCE;
	delete process.env.DATABASE_URL;
	for (const chain of SERVER_CHAINS) process.env[chain.rpcEnv] = `https://address-rpc.test/${chain.chainId}`;
	t.after(() => {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});
}
function request(input: unknown = { name: "STEVE.eth" }, init?: RequestInit) {
	return new Request("https://address.test/api/v1/address", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
		...init,
	});
}
function rpcFixture(
	t: TestContext,
	options: {
		unrenewable?: boolean;
		v1?: boolean;
		outage?: boolean;
		balancesUnavailable?: boolean;
		balanceBarrier?: () => Promise<void>;
	} = {},
) {
	return t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
		if (options.outage) throw new Error("private provider credentials");
		const url = new URL(String(input));
		assert.equal(url.hostname, "address-rpc.test");
		const chainId = Number(url.pathname.slice(1));
		const payload = JSON.parse(String(init?.body));
		const calls = Array.isArray(payload) ? payload : [payload];
		const replies = [];
		for (const call of calls) {
			let result: unknown;
			if (call.method === "eth_chainId") result = `0x${chainId.toString(16)}`;
			else if (call.method === "eth_blockNumber") result = "0x64";
			else {
				assert.equal(call.method, "eth_call", "activation reads must not send transactions");
				assert.equal(call.params[1], "0x64", "read state at a fixed block");
				const decoded = decodeFunctionData({ abi, data: call.params[0].data as Hex });
				if (decoded.functionName === "balanceOf") {
					if (options.balancesUnavailable) throw new Error("balance unavailable");
					await options.balanceBarrier?.();
				}
				const values: Record<string, unknown> = {
					currentHelper: "0x1111111111111111111111111111111111111111",
					gateway: HUB_CHAIN.gatewayAddress,
					pointer: HUB_CHAIN.pointerAddress,
					interfaceVersion: 1n,
					factory: HUB_CHAIN.factoryAddress,
					paymentToken: HUB_CHAIN.usdcAddress,
					ethRegistrar: HUB_CHAIN.ensRegistrarAddress,
					ethRenewerV1: HUB_CHAIN.ensRenewerV1Address,
					referrer: HUB_CHAIN.ensReferrer,
					nameState: [
						1800000000n,
						options.unrenewable
							? zeroAddress
							: options.v1
								? HUB_CHAIN.ensRenewerV1Address
								: HUB_CHAIN.ensRegistrarAddress,
					],
					balanceOf: 0n,
				};
				result = encodeFunctionResult({
					abi,
					functionName: decoded.functionName,
					result: values[decoded.functionName] as never,
				});
			}
			replies.push({ jsonrpc: "2.0", id: call.id, result });
		}
		return Response.json(Array.isArray(payload) ? replies : replies[0]);
	});
}

test("disabled address API, maintenance, CORS and validation stop before activation", async (t) => {
	setup(t);
	const rpc = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("must not fetch");
	});
	const connect = t.mock.method(Pool.prototype, "connect", () => {
		throw new Error("must not connect");
	});
	process.env.NAMEPASS_PUBLIC_ADDRESS_ENABLED = "";
	const disabled = await route.fetch(request());
	assert.equal(disabled.status, 503);
	assert.equal((await disabled.json()).error.code, "api_unavailable");
	assert.equal(disabled.headers.get("retry-after"), "5");
	assert.equal(disabled.headers.get("access-control-allow-origin"), "*");
	const preflight = await route.fetch(
		new Request("https://address.test/api/v1/address", { method: "OPTIONS" }),
	);
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
	assert.equal(preflight.headers.get("access-control-expose-headers"), "Retry-After");
	const wrongMethod = await route.fetch(new Request("https://address.test/api/v1/address"));
	assert.equal(wrongMethod.status, 405);
	assert.equal(wrongMethod.headers.get("allow"), "POST, OPTIONS");
	process.env.NAMEPASS_PUBLIC_ADDRESS_ENABLED = "1";
	process.env.NAMEPASS_MAINTENANCE = "1";
	assert.equal((await route.fetch(request())).status, 503);
	delete process.env.NAMEPASS_MAINTENANCE;
	for (const input of [
		{ name: "a.eth" },
		{ name: "sub.steve.eth" },
		{ name: 123 },
		{ name: "steve.eth", extra: true },
		[],
		null,
	]) {
		assert.equal((await route.fetch(request(input))).status, 400);
	}
	assert.equal((await route.fetch(request({}, { body: "{" }))).status, 400);
	assert.equal((await route.fetch(request({}, { body: " ".repeat(8193) }))).status, 413);
	assert.equal((await route.fetch(request({}, { headers: { "content-type": "text/plain" } }))).status, 415);
	assert.equal(rpc.mock.callCount(), 0);
	assert.equal(connect.mock.callCount(), 0);
});

test("unrenewable names and ENS outage never write monitoring state", async (t) => {
	setup(t);
	const connect = t.mock.method(Pool.prototype, "connect", () => {
		throw new Error("must not connect");
	});
	const rpc = rpcFixture(t, { unrenewable: true });
	const denied = await route.fetch(request());
	assert.equal(denied.status, 422);
	assert.equal((await denied.json()).error.code, "name_not_renewable");
	rpc.mock.restore();
	rpcFixture(t, { outage: true });
	const offline = await route.fetch(request());
	assert.equal(offline.status, 503);
	assert.equal(offline.headers.get("retry-after"), "5");
	assert.equal((await offline.json()).error.code, "ens_unavailable");
	assert.equal(connect.mock.callCount(), 0);
});

test("cancelled activation RPC reads stop before database writes", async (t) => {
	setup(t);
	const connect = t.mock.method(Pool.prototype, "connect", () => {
		throw new Error("must not connect");
	});
	t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
		assert.ok(init?.signal, "activation must pass its cancellation signal to RPC");
		init.signal.throwIfAborted();
		throw new Error("must not continue");
	});
	await assert.rejects(
		activateName("steve", { requireRenewable: true, readSignal: AbortSignal.abort() }),
		(error: unknown) => (error as { code: string }).code === "ens_unavailable",
	);
	assert.equal(connect.mock.callCount(), 0);
});

test("two stalled address bodies return capacity error, then cancellation releases capacity", async (t) => {
	setup(t);
	const rpc = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("must not fetch");
	});
	const controllers = [new AbortController(), new AbortController()];
	const pending = controllers.map((controller) =>
		route.fetch(
			request({}, { body: new ReadableStream(), signal: controller.signal, duplex: "half" } as RequestInit),
		),
	);
	const response = await route.fetch(request());
	assert.equal(response.status, 429);
	assert.equal(response.headers.get("retry-after"), "5");
	controllers.forEach((controller) => controller.abort());
	assert.deepEqual(
		(await Promise.all(pending)).map((response) => response.status),
		[503, 503],
	);
	assert.equal((await route.fetch(request({ name: "sub.steve.eth" }))).status, 400);
	assert.equal(rpc.mock.callCount(), 0);
});

test(
	"address HTTP activation is idempotent under concurrent real PostgreSQL transactions",
	{ skip: !process.env.TEST_DATABASE_URL },
	async (t) => {
		setup(t);
		const sourceUrl = new URL(process.env.TEST_DATABASE_URL!);
		assert.ok(
			["127.0.0.1", "localhost", "[::1]"].includes(sourceUrl.hostname),
			"disposable fixture database must run locally",
		);
		const fixtureName = `namepass_address_${crypto.randomUUID().replace(/-/g, "")}`;
		const admin = new Pool({ connectionString: sourceUrl.toString() });
		await admin.query(`CREATE DATABASE "${fixtureName}"`);
		sourceUrl.pathname = `/${fixtureName}`;
		const fixture = new Pool({ connectionString: sourceUrl.toString() });
		process.env.DATABASE_URL = sourceUrl.toString();
		t.after(async () => {
			// Close the real application pool via Drizzle's runtime client; no test-only production export.
			await (database() as ReturnType<typeof database> & { $client: Pool }).$client.end();
			await fixture.end();
			await admin.query(`DROP DATABASE "${fixtureName}"`);
			await admin.end();
		});
		for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
			.filter((file) => /^000[0-8]_.*\.sql$/.test(file))
			.sort()) {
			await fixture.query(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
		}
		let balanceReads = 0;
		let release!: () => void;
		const barrier = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("concurrent scans did not reach the barrier")), 10000);
			release = () => {
				clearTimeout(timer);
				resolve();
			};
		});
		const rpc = rpcFixture(t, {
			balanceBarrier: async () => {
				// Both activations have committed registration before either finishes its balance scan.
				if (++balanceReads === 8) release();
				await barrier;
			},
		});
		const responses = await Promise.all([route.fetch(request()), route.fetch(request({ name: "steve" }))]);
		for (const response of responses) {
			assert.equal(response.status, 200, await response.clone().text());
			assert.equal(response.headers.get("cache-control"), "no-store");
			const body = await response.json();
			assert.equal(validResponse(body), true, JSON.stringify(validResponse.errors));
			assert.deepEqual(body, {
				name: "steve.eth",
				depositAddress: "0x5B7516768eD0b04E212041265BB1f11af71841d7",
				subname: "steve.namepass.eth",
				subnameVerified: false,
				chains: [
					{
						chainId: "84532",
						name: "Base Sepolia",
						tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
						minimumAmount: "500000",
					},
					{
						chainId: "421614",
						name: "Arbitrum Sepolia",
						tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
						minimumAmount: "500000",
					},
					{
						chainId: "11155111",
						name: "Sepolia",
						tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
						minimumAmount: "500000",
					},
					{
						chainId: "5042002",
						name: "Arc Testnet",
						tokenAddress: "0x3600000000000000000000000000000000000000",
						minimumAmount: "500000",
					},
				],
			});
		}
		assert.equal((await fixture.query("select count(*)::int as n from names")).rows[0].n, 1);
		assert.equal(
			(await fixture.query("select count(*)::int as n from goldsky.watched_addresses")).rows[0].n,
			1,
		);
		assert.equal((await fixture.query("select count(*)::int as n from balance_snapshots")).rows[0].n, 4);
		assert.equal((await fixture.query("select count(*)::int as n from balance_scan_requests")).rows[0].n, 0);
		assert.equal(
			(await fixture.query("select unscanned_chain_ids from names")).rows[0].unscanned_chain_ids.length,
			0,
		);
		assert.equal((await fixture.query("select count(*)::int as n from flows")).rows[0].n, 0);
		rpc.mock.restore();
		// Unknown balances stay queued for the established recovery path; they are not zero snapshots.
		rpcFixture(t, { v1: true, balancesUnavailable: true });
		const v1 = await route.fetch(request({ name: "vitalik.eth" }));
		assert.equal(v1.status, 200, await v1.clone().text());
		assert.equal((await v1.json()).depositAddress, "0xa61656CA2D2952a46a9d4DA0AAE01d8D7fe988E0");
		assert.equal(
			(await fixture.query("select renewable_by from names where normalized_label='vitalik'")).rows[0]
				.renewable_by,
			"v1",
		);
		assert.equal((await fixture.query("select count(*)::int as n from balance_snapshots")).rows[0].n, 4);
		assert.equal((await fixture.query("select count(*)::int as n from balance_scan_requests")).rows[0].n, 4);
	},
);
