import assert from "node:assert/strict";
import test from "node:test";
import { H3 } from "nitro/h3";
import publicApiBoundary from "./public-api-boundary";
import address from "../routes/api/v1/address";
import quote from "../routes/api/v1/quote";

test("unavailable public API URLs return JSON 404 before the SPA fallback", async () => {
	const app = new H3().use(publicApiBoundary);
	app.on(
		"",
		"/**",
		() =>
			new Response("<!doctype html><title>Namepass</title>", { headers: { "content-type": "text/html" } }),
	);
	for (const path of [
		"/api/v1",
		"/api/v1/status/11155111?transactionHash=0x123",
		"/api/v1/names/steve.eth/renewals",
		"/api/v1/unknown",
		"/api/v1/quote/unknown",
	]) {
		for (const method of ["GET", "POST", "OPTIONS"]) {
			const response = await app.request(new Request(`https://namepass.test${path}`, { method }));
			assert.equal(response.status, 404, `${method} ${path}`);
			assert.match(response.headers.get("content-type")!, /application\/json/);
			assert.equal(response.headers.get("cache-control"), "no-store");
			assert.equal(response.headers.get("access-control-allow-origin"), "*");
			assert.equal((await response.json()).error.code, "api_not_found");
		}
	}
	for (const path of ["/", "/docs", "/docs/reference", "/terms", "/api/activity", "/api/v10/unknown"]) {
		const response = await app.request(`https://namepass.test${path}`);
		assert.equal(response.status, 200);
		assert.match(await response.text(), /<!doctype html>/);
	}
});

test("implemented adapters retain their own methods and CORS preflight", async () => {
	const app = new H3().use(publicApiBoundary);
	app.on("", "/api/v1/address", (event) => address.fetch(event.req));
	app.on("", "/api/v1/quote", (event) => quote.fetch(event.req));
	for (const path of ["/api/v1/address", "/api/v1/quote"]) {
		const get = await app.request(`https://namepass.test${path}`);
		assert.equal(get.status, 405);
		assert.equal((await get.json()).error.code, "method_not_allowed");
		const preflight = await app.request(new Request(`https://namepass.test${path}`, { method: "OPTIONS" }));
		assert.equal(preflight.status, 204);
		assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
	}
});
