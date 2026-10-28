import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

/* Source inspection matches deposit and watched addresses exactly, so a stored
   checksummed address would silently drop out of transaction status. */
test("the database rejects mixed-case deposit and watched addresses", async (t) => {
	const pg = new PGlite();
	t.after(() => pg.close());
	for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
		.filter((file) => /^\d{4}_.*\.sql$/.test(file)).sort()) {
		await pg.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
	}
	const checksummed = "0xf230ec27Fb20d971ffbefA5b6c2Bc373D6d818B4";
	const insertName = (label: string, address: string) => pg.query(
		`INSERT INTO names(normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at)
		 VALUES($1::text,$1::text || '.eth',$2,$3,$4,now())`,
		[label, `0x${label.padStart(64, "0")}`, `0x${label.padStart(64, "1")}`, address],
	);
	await assert.rejects(insertName("aa", checksummed), /names_deposit_address_lowercase/);
	await insertName("bb", checksummed.toLowerCase());
	await assert.rejects(
		pg.query("INSERT INTO goldsky.watched_addresses(value) VALUES($1)", [checksummed]),
		/watched_addresses_value_lowercase/,
	);
	await pg.query("INSERT INTO goldsky.watched_addresses(value) VALUES($1)", [checksummed.toLowerCase()]);
});
