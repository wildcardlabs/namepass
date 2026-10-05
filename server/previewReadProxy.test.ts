import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { H3 } from "nitro/h3";
import previewReadProxy from "./previewReadProxy";

function environment(t: TestContext, value: string) {
	const previous = process.env.VERCEL_ENV;
	process.env.VERCEL_ENV = value;
	t.after(() => {
		if (previous === undefined) delete process.env.VERCEL_ENV;
		else process.env.VERCEL_ENV = previous;
	});
}

function app() {
	const instance = new H3().use(previewReadProxy);
	instance.on("", "/**", () => new Response("local route", { status: 201 }));
	return instance;
}

test("preview reads reach the fixed testnet origin before local routes, without credentials", async (t) => {
	environment(t, "preview");
	const fetchMock = t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
		assert.equal(url, "https://beta.namepass.com/api/names/alice.eth/activity?page=2&limit=15");
		assert.equal(init?.method, "GET");
		assert.equal(init?.redirect, "error");
		assert.deepEqual(init?.headers, { accept: "application/json" });
		return Response.json({ renewals: [{ eventId: "renewal:1" }] }, {
			status: 200,
			headers: { "set-cookie": "private=secret", "cache-control": "public, max-age=600" },
		});
	});
	const response = await app().request(new Request("https://preview.test/api/names/alice.eth/activity?page=2&limit=15", {
		headers: { cookie: "session=secret", authorization: "Bearer secret" },
	}));
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { renewals: [{ eventId: "renewal:1" }] });
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(response.headers.get("set-cookie"), null);
	assert.equal(fetchMock.mock.callCount(), 1);
});

test("preview never forwards writes, operational APIs or encoded path escapes", async (t) => {
	environment(t, "preview");
	const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
	const instance = app();
	for (const [method, path, status] of [
		["POST", "/api/names/activate", 405],
		["POST", "/api/flows/trigger", 405],
		["GET", "/api/cron/recover", 403],
		["GET", "/api/auth/github", 403],
		["GET", "/api/monitoring", 403],
		["GET", "/api/v1/status/11155111", 403],
		["GET", "/api/names/alice%2Fmonitoring", 403],
		["GET", "/api/names/alice%252Fmonitoring", 403],
	] as const) {
		const response = await instance.request(new Request(`https://preview.test${path}`, { method }));
		assert.equal(response.status, status, `${method} ${path}`);
		if (status === 405) assert.equal(response.headers.get("allow"), "GET");
	}
	assert.equal(fetchMock.mock.callCount(), 0);
});

test("production and development requests retain their local handlers", async (t) => {
	environment(t, "production");
	const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not proxy"); });
	for (const environment of ["production", "development", ""] as const) {
		process.env.VERCEL_ENV = environment;
		const response = await app().request("https://namepass.test/api/activity");
		assert.equal(response.status, 201);
		assert.equal(await response.text(), "local route");
	}
	assert.equal(fetchMock.mock.callCount(), 0);
});

test("preview preserves upstream errors and reports an unavailable backend instead of empty activity", async (t) => {
	environment(t, "preview");
	const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "name_not_found" } }, {
		status: 404, headers: { "retry-after": "5" },
	}));
	const missing = await app().request("https://preview.test/api/names/missing.eth");
	assert.equal(missing.status, 404);
	assert.equal(missing.headers.get("retry-after"), "5");
	assert.equal((await missing.json()).error.code, "name_not_found");
	fetchMock.mock.mockImplementation(async () => { throw new Error("offline"); });
	const failed = await app().request("https://preview.test/api/activity");
	assert.equal(failed.status, 502);
	assert.equal((await failed.json()).error.code, "preview_upstream_unavailable");
});
