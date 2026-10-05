import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, parseAbi, type Hex } from "viem";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import route from "../routes/api/v1/quote";
import { SERVER_CHAINS, HUB_CHAIN } from "../src/lib/chains";

const helper = "0x7Bfee7c257ff48f8D787A61F15925e24743C8F88";
const minter = "0xb43db544E2c27092c107639Ad201b3dEfAbcF192";
const blockHash = `0x${"11".repeat(32)}`;
const code = readFileSync(new URL("../test/fixtures/public-quote/helper-runtime.hex", import.meta.url), "utf8").trim();
const fixtureAbi = parseAbi([
	"function currentHelper() view returns (address)", "function gateway() view returns (address)",
	"function pointer() view returns (address)", "function factory() view returns (address)",
	"function paymentToken() view returns (address)", "function interfaceVersion() view returns (uint256)",
	"function GAS_ALLOWANCE() view returns (uint256)",
	"function quote(string label,uint256 budget) view returns (uint64 duration,uint256 needed)",
	"function usdc() view returns (address)", "function tokenMessenger() view returns (address)",
	"function l1Helper() view returns (address)", "function finality() view returns (uint32)",
	"function localMinter() view returns (address)",
	"function burnLimitsPerMessage(address token) view returns (uint256)",
	"error NameNotRenewable()", "error DurationOverflow()", "error InsufficientAmount()",
]);
const spec = JSON.parse(readFileSync(new URL("../docs/api/openapi.json", import.meta.url), "utf8"));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validResponse = ajv.compile(spec.components.schemas.QuoteResponse);
function enabled(t: TestContext, value = "1") {
	const saved = { ...process.env };
	process.env.NAMEPASS_PUBLIC_QUOTE_ENABLED = value;
	for (const chain of SERVER_CHAINS) process.env[chain.rpcEnv] = `https://rpc.test/${chain.chainId}`;
	t.after(() => { for (const key of ["NAMEPASS_PUBLIC_QUOTE_ENABLED", ...SERVER_CHAINS.map(chain => chain.rpcEnv)]) {
		if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
	} });
}
function request(input: unknown = { name: "STEVE.eth", chainId: "11155111", amount: "1000000" }, init?: RequestInit) {
	return new Request("https://quote.test/api/v1/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), ...init });
}
type Options = { pointerMismatch?: boolean; unsupportedCode?: boolean; wrongChain?: boolean; finality?: number; burnLimit?: bigint; revert?: "NameNotRenewable" | "DurationOverflow" | "InsufficientAmount"; applied?: bigint; reorg?: boolean; outage?: boolean; zeroDuration?: boolean };
function fixture(t: TestContext, options: Options = {}) {
	const operations: Array<{ method: string; params?: unknown[] }> = [];
	let confirmations = 0;
	const mock = t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
		if (options.outage) throw new Error("secret provider URL must not appear in the response");
		const url = String(input);
		assert.equal(new URL(url).hostname, "rpc.test", "quotes must not depend on Circle fee or gas-pricing services");
		const chainId = Number(new URL(url).pathname.slice(1));
		const chain = SERVER_CHAINS.find(chain => chain.chainId === chainId)!;
		const payload = JSON.parse(String(init?.body));
		const replies = (Array.isArray(payload) ? payload : [payload]).map((call: { id: number; method: string; params: unknown[] }) => {
			operations.push(call);
			let result: unknown;
			if (call.method === "eth_chainId") result = `0x${(options.wrongChain ? 1 : chainId).toString(16)}`;
			else if (call.method === "eth_getBlockByNumber") {
				if (call.params[0] !== "latest") confirmations++;
				result = { number: "0x64", hash: options.reorg && confirmations ? `0x${"22".repeat(32)}` : blockHash, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, transactions: [], gasLimit: "0x10000", gasUsed: "0x0", size: "0x0", difficulty: "0x0", extraData: "0x", parentHash: blockHash };
			} else if (call.method === "eth_getCode") {
				assert.equal(call.params[1], "0x64", "helper code must be block pinned");
				result = options.unsupportedCode ? "0x00" : code;
			} else {
				assert.equal(call.method, "eth_call", "quotes must never sign, submit or scan transaction history");
				assert.equal(call.params[1], "0x64", "each contract read must use its chain snapshot");
				const decoded = decodeFunctionData({ abi: fixtureAbi, data: (call.params[0] as { data: Hex }).data });
				if (decoded.functionName === "quote") {
					assert.deepEqual(decoded.args, ["steve", 900000n], "gateway receives the budget after the protocol allowance");
					if (options.revert) return { jsonrpc: "2.0", id: call.id, error: { code: 3, message: "execution reverted", data: encodeErrorResult({ abi: fixtureAbi, errorName: options.revert }) } };
				}
				const values: Record<string, unknown> = {
					currentHelper: helper, gateway: options.pointerMismatch ? minter : HUB_CHAIN.gatewayAddress,
					pointer: HUB_CHAIN.pointerAddress, factory: HUB_CHAIN.factoryAddress, paymentToken: HUB_CHAIN.usdcAddress,
					interfaceVersion: 1n,
					GAS_ALLOWANCE: 100000n,
					quote: [options.zeroDuration ? 0n : 3547790n, options.applied ?? 900000n], usdc: chain.usdcAddress,
					tokenMessenger: chain.tokenMessengerAddress, l1Helper: HUB_CHAIN.gatewayAddress,
					finality: options.finality ?? 2000, localMinter: minter,
					burnLimitsPerMessage: options.burnLimit ?? 10000000000000n,
				};
				result = encodeFunctionResult({ abi: fixtureAbi, functionName: decoded.functionName, result: values[decoded.functionName] as never });
			}
			return { jsonrpc: "2.0", id: call.id, result };
		});
		return Response.json(Array.isArray(payload) ? replies : replies[0]);
	});
	return { mock, operations };
}

test("disabled quotes, CORS preflight and wrong methods require no provider or database", async t => {
	enabled(t, "");
	const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
	const disabled = await route.fetch(request());
	assert.equal(disabled.status, 503);
	assert.equal((await disabled.json()).error.code, "api_unavailable");
	assert.equal(disabled.headers.get("retry-after"), "5");
	assert.equal(disabled.headers.get("access-control-allow-origin"), "*");
	const preflight = await route.fetch(new Request("https://quote.test/api/v1/quote", { method: "OPTIONS" }));
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
	assert.equal(preflight.headers.get("access-control-expose-headers"), "Retry-After");
	assert.equal((await route.fetch(new Request("https://quote.test/api/v1/quote"))).status, 405);
	assert.equal(mock.mock.callCount(), 0);
});

test("invalid names, chain IDs, amounts and oversized bodies stop before RPC", async t => {
	enabled(t);
	const { mock } = fixture(t);
	for (const input of [
		{ name: "sub.steve.eth", chainId: "11155111", amount: "1000000" },
		{ name: "steve.eth", chainId: "1", amount: "1000000" },
		...['1.5', '-1', '01', ((1n << 256n)).toString()].map(amount => ({ name: "steve.eth", chainId: "11155111", amount })),
		{ name: "steve.eth", chainId: 11155111, amount: "1000000" },
		{ name: "steve.eth", chainId: "11155111", amount: 1000000 },
		{ name: "steve.eth", chainId: "11155111", amount: "1000000", extra: true },
	]) assert.equal((await route.fetch(request(input))).status, 400);
	assert.equal((await route.fetch(request({ name: "steve.eth", chainId: "11155111", amount: "499999" }))).status, 422);
	assert.equal((await route.fetch(request({}, { body: " ".repeat(8193) }))).status, 413);
	assert.equal((await route.fetch(request({}, { headers: { "content-type": "text/plain" } }))).status, 415);
	assert.equal(mock.mock.callCount(), 0);
});

test("valid quotes preserve exact integer fields, normalization, pinned reads and the OpenAPI shape", async t => {
	enabled(t);
	const { operations } = fixture(t);
	const before = Date.now();
	const response = await route.fetch(request());
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(validResponse(body), true, JSON.stringify(validResponse.errors));
	assert.deepEqual({ ...body, expiresAt: undefined }, { name: "steve.eth", chainId: "11155111", amount: "1000000", secondsAdded: "3547790", amountApplied: "900000", renewalFee: "100000", bridgeFee: "0", roundingRemainder: "0", pricingBlock: "100", estimate: true, expiresAt: undefined });
	assert.ok(Date.parse(body.expiresAt) >= before + 60000 && Date.parse(body.expiresAt) <= Date.now() + 60000);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.ok(operations.length <= 24);
});

test("cross-chain quotes enforce the live per-message ceiling and zero-fee standard route", async t => {
	enabled(t);
	fixture(t, { burnLimit: 1000000n });
	const input = { name: "steve.eth", chainId: "5042002", amount: "1000000" };
	assert.equal((await route.fetch(request(input))).status, 200);
	const above = await route.fetch(request({ ...input, amount: "1000001" }));
	assert.equal(above.status, 422);
	assert.equal((await above.json()).error.details.maximumAmount, "1000000");
});

for (const [title, options] of Object.entries({
	"wrong network": { wrongChain: true }, "mismatched pointer": { pointerMismatch: true },
	"unknown helper": { unsupportedCode: true }, "inconsistent quote amount": { applied: 900001n },
	"changed block hash": { reorg: true }, "provider outage": { outage: true },
	"unsupported finality": { finality: 1000 }, "disabled burns": { burnLimit: 0n },
})) test(`${title} returns retryable 503 without invented prices`, async t => {
	enabled(t);
	fixture(t, options);
	const response = await route.fetch(request({ name: "steve.eth", chainId: "5042002", amount: "1000000" }));
	assert.equal(response.status, 503);
	assert.equal(response.headers.get("retry-after"), "5");
	const text = await response.text();
	assert.ok(!text.includes("rpc.test") && !text.includes("secret provider"));
});

test("unrenewable names and zero durations are 422, never fallback quotes", async t => {
	enabled(t);
	for (const options of [{ revert: "NameNotRenewable" as const }, { revert: "DurationOverflow" as const }, { revert: "InsufficientAmount" as const }, { zeroDuration: true }]) {
		const { mock } = fixture(t, options);
		assert.equal((await route.fetch(request())).status, 422);
		mock.mock.restore();
	}
});

test("rounding remainder comes from the gateway amount, without a second pricing calculation", async t => {
	enabled(t);
	fixture(t, { applied: 899999n });
	const response = await route.fetch(request());
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.roundingRemainder, "1");
	assert.equal(BigInt(body.amountApplied) + BigInt(body.renewalFee) + BigInt(body.bridgeFee) + BigInt(body.roundingRemainder), BigInt(body.amount));
});

test("two stalled bodies exhaust capacity and cancellation releases it without RPC", async t => {
	enabled(t);
	const { mock } = fixture(t);
	const controllers = [new AbortController(), new AbortController()];
	const pending = controllers.map(controller => route.fetch(request({}, { body: new ReadableStream(), duplex: "half", signal: controller.signal } as RequestInit)));
	const busy = await route.fetch(request());
	assert.equal(busy.status, 429);
	assert.equal(busy.headers.get("retry-after"), "5");
	controllers.forEach(controller => controller.abort());
	for (const response of await Promise.all(pending)) assert.equal(response.status, 503);
	assert.equal(mock.mock.callCount(), 0);
	assert.equal((await route.fetch(request({}))).status, 400);
});
