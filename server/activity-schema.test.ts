import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import activityRoute from "../routes/api/activity";
import nameActivityRoute from "../routes/api/names/[label]/activity";

test("activity HTTP routes read populated pre-API schema without an API migration", async (t) => {
	const fixture = new PGlite();
	const previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/fixture";
	t.after(async () => {
		if (previousUrl === undefined) delete process.env.DATABASE_URL;
		else process.env.DATABASE_URL = previousUrl;
		await fixture.close();
	});

	// Pin the established schema independently of future API migrations.
	for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
		.filter((file) => /^000[0-8]_.*\.sql$/.test(file)).sort()) {
		await fixture.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
	}
	// Only replace the wire transport. Real route queries execute in PostgreSQL.
	t.mock.method(Pool.prototype, "query", async (config: unknown, values: unknown[] = []) => {
		const request = typeof config === "string" ? { text: config } : config as { text: string; rowMode?: string };
		const result = await fixture.query(request.text, values, {
			rowMode: request.rowMode === "array" ? "array" : "object",
		});
		return {
			...result,
			rows: request.rowMode === "array"
				? result.rows.map((row) => (row as unknown[]).map((value) => {
					return value instanceof Date ? value.toISOString() : value;
				}))
				: result.rows,
		};
	});
	await fixture.exec(`
 insert into names(id,normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at)
 values('00000000-0000-0000-0000-000000000001','example','example.eth','labelhash','namehash','0x1111111111111111111111111111111111111111','2026-10-01T00:00:00Z');
 insert into chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts)
 values('source','deposit','Transfer',84532,'sourcehash',0,10,'2026-10-01T00:00:00Z','c',true,'{}'),
 ('renewal','namepass','Renewed',11155111,'renewalhash',0,20,'2026-10-01T00:01:00Z','c',true,
 '{"label_hash":"labelhash","executor_address":"0x2222222222222222222222222222222222222222","amount_received":"1000000","gas_allowance":"100000","amount_applied":"900000","duration":"12345","from_cctp":"true","new_expiry":"1900000000"}');
 insert into deposits(event_id,name_id,chain_id,token_address,sender_address,amount,tx_hash,log_index,block_number,block_time,source,status)
 values('source','00000000-0000-0000-0000-000000000001',84532,'0x3333333333333333333333333333333333333333','0x4444444444444444444444444444444444444444',1000000,'sourcehash',0,10,'2026-10-01T00:00:00Z','goldsky','finalized');
 insert into flows(name_id,origin_chain_id,trigger,status,amount_detected,deposit_event_id,renewal_event_id)
 values('00000000-0000-0000-0000-000000000001',84532,'automatic','settled',1000000,'source','renewal');
 `);
	for (const [route, url] of [
		[activityRoute, "http://localhost/api/activity?limit=2"],
		[nameActivityRoute, "http://localhost/api/names/example.eth/activity?limit=2"],
	] as const) {
		const response = await route.fetch(new Request(url));
		assert.equal(response.status, 200, await response.clone().text());
		const body = await response.json();
		const renewals = route === activityRoute
			? body.items.map((item: { renewal: unknown }) => item.renewal)
			: body.renewals;
		assert.equal(route === activityRoute ? body.items[0].name.displayName : body.name.displayName, "example.eth");
		assert.equal(renewals.length, 1);
		assert.equal(renewals[0].depositTxHash, "sourcehash");
		assert.equal(renewals[0].renewalTxHash, "renewalhash");
		assert.equal(renewals[0].amountReceived, "1000000");
		assert.equal(renewals[0].durationSeconds, "12345");
	}
});
