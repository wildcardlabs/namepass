import assert from "node:assert/strict";
import test from "node:test";
import { publicAddress } from "./public-address";
import { publicQuote } from "./public-quote";
import { publicStatus } from "./public-status";
import { publicHistory } from "./public-history";

const routes = [
	["address", publicAddress, "/api/v1/address", "POST"],
	["quote", publicQuote, "/api/v1/quote", "POST"],
	["status", publicStatus, "/api/v1/status/11155111?transactionHash=0x" + "12".repeat(32), "GET"],
	["history", publicHistory, "/api/v1/names/alice.eth/renewals", "GET"],
] as const;

test("hosted API admission uses configured SDK counters before any provider or database work", async (t) => {
	const saved = { ...process.env };
	const keys = ["VERCEL", "VERCEL_URL", "NODE_ENV", "NAMEPASS_PUBLIC_LIMITS_ENABLED", "NAMEPASS_MAINTENANCE",
		...routes.map(([name]) => `NAMEPASS_PUBLIC_${name.toUpperCase()}_ENABLED`)];
	t.after(() => {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});
	process.env.VERCEL = "1";
	process.env.VERCEL_URL = "namepass-fixture.vercel.app";
	process.env.NODE_ENV = "production";
	process.env.NAMEPASS_PUBLIC_LIMITS_ENABLED = "1";
	delete process.env.NAMEPASS_MAINTENANCE;
	for (const [name] of routes) process.env[`NAMEPASS_PUBLIC_${name.toUpperCase()}_ENABLED`] = "1";

	let statuses: Array<number | Error> = [], calls: Array<{ id: string; key: string }> = [];
	t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
		const parsed = new URL(url);
		assert.equal(parsed.hostname, "namepass-fixture.vercel.app");
		assert.match(parsed.pathname, /^\/\.well-known\/vercel\/rate-limit-api\/namepass-v1-/);
		const headers = new Headers(init.headers);
		assert.equal(headers.has("x-rr-authorization"), false);
		assert.equal(headers.has("x-rr-cookie"), false);
		assert.equal(headers.get("x-rr-host"), "namepass-fixture.vercel.app");
		calls.push({ id: parsed.pathname.split("/").slice(-1)[0]!, key: headers.get("x-vercel-rate-limit-key")! });
		const status = statuses.shift();
		assert.ok(status !== undefined, "Unexpected SDK, RPC or other network call");
		if (status instanceof Error) throw status;
		return new Response(null, { status });
	});
	t.mock.method(console, "warn", () => {});
	for (const [name, route, path, method] of routes) {
		const request = () => new Request("https://caller-controlled.example" + path, {
			method, headers: { "content-type": "application/json", "x-real-ip": "192.0.2.1",
				host: "attacker.example", authorization: "Bearer private-value", cookie: "private=value",
				"x-vercel-rate-limit-key": "caller-selected" },
			...(method === "POST" ? { body: JSON.stringify({ name: "alice.eth", chainId: "11155111", amount: "500000" }) } : {}),
		});
		for (const scenario of [
			{ statuses: [429], http: 429, code: "rate_limited", calls: 1 },
			{ statuses: [204, 429], http: 429, code: "rate_limited", calls: 2 },
			{ statuses: [404], http: 503, code: "rate_limit_unavailable", calls: 1 },
			{ statuses: [204, 404], http: 503, code: "rate_limit_unavailable", calls: 2 },
			{ statuses: [new Error("private-provider-detail")], http: 503, code: "rate_limit_unavailable", calls: 1 },
		]) {
			calls = []; statuses = [...scenario.statuses];
			const response = await route.fetch(request());
			assert.equal(response.status, scenario.http, name);
			const body = await response.json();
			assert.equal(body.error.code, scenario.code);
			assert.match(body.requestId, /^[0-9a-f-]{36}$/);
			assert.equal(JSON.stringify(body).includes("private"), false);
			assert.equal(response.headers.get("access-control-allow-origin"), "*");
			assert.equal(response.headers.get("cache-control"), "no-store");
			assert.equal(response.headers.get("retry-after"), scenario.http === 429 ? "60" : "5");
			assert.equal(calls.length, scenario.calls);
			assert.equal(calls[0]!.id, `namepass-v1-${name}-ip`);
			assert.ok(calls[0]!.key.startsWith("192.0.2.1-"));
			if (calls.length === 2) {
				assert.equal(calls[1]!.id, `namepass-v1-${name}-budget`);
				assert.ok(calls[1]!.key.startsWith("all-callers-"));
			}
		}
		// Two allowed counters must reach ordinary validation, without a DB/RPC read.
		calls = []; statuses = [204, 204];
		const invalidPath = name === "status" ? "/api/v1/status/11155111?transactionHash=bad"
			: name === "history" ? "/api/v1/names/bad..eth/renewals" : path;
		const allowed = await route.fetch(new Request("https://test.example" + invalidPath, {
			method, headers: { "content-type": "application/json", "x-real-ip": "192.0.2.1" },
			...(method === "POST" ? { body: JSON.stringify({ name: "" }) } : {}),
		}));
		assert.equal(allowed.status, 400, name);
		assert.equal(calls.length, 2);
		for (const field of ["host", "ip"] as const) {
			calls = []; statuses = [];
			if (field === "host") process.env.VERCEL_URL = "attacker.example/path";
			const missing = await route.fetch(new Request("https://test.example" + path, {
				method, headers: { "content-type": "application/json", ...(field === "host" ? { "x-real-ip": "192.0.2.1" } : {}) },
			}));
			assert.equal(missing.status, 503);
			assert.equal((await missing.json()).error.code, "rate_limit_unavailable");
			assert.equal(calls.length, 0);
			process.env.VERCEL_URL = "namepass-fixture.vercel.app";
		}
		delete process.env.NAMEPASS_PUBLIC_LIMITS_ENABLED;
		calls = []; statuses = [];
		const response = await route.fetch(request());
		assert.equal(response.status, 503);
		assert.equal((await response.json()).error.code, "rate_limit_unavailable");
		assert.equal(calls.length, 0);
		assert.equal((await route.fetch(new Request("https://test.example" + path, { method: "OPTIONS" }))).status, 204);
		assert.equal(calls.length, 0);
		process.env.NAMEPASS_PUBLIC_LIMITS_ENABLED = "1";
	}
});
