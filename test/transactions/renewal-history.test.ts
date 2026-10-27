import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../../server/db/client", () => ({ database: state.database }));
vi.mock("../../server/chain", async (original) => ({
	...await original<typeof import("../../server/chain")>(),
	readEnsState: async () => ({ expiry: new Date(1_800_000_000_000), renewableBy: "registrar" }),
	readNativeUsdcBalanceSnapshots: async () => [],
}));

import activate from "../../routes/api/names/activate";
import { labelHash } from "../../server/chain";
import { ingestGoldskyEvent, postgresGoldskyStore, reconcileStoredRenewals, type GoldskyEvent } from "../../server/goldsky";
import { depositAddress } from "../../src/lib/namepass";

function renewal(id: string, label = "alice", fromCctp = false): GoldskyEvent {
	return {
		eventId: id, eventFamily: "namepass", eventType: "Renewed", chainId: 11155111,
		blockNumber: "10", blockTime: new Date(1_700_000_000_000), txHash: `tx-${id}`, logIndex: 2,
		gsOp: "c", payload: {}, facts: {
			label, label_hash: labelHash(label), wallet_address: depositAddress(label).toLowerCase(),
			duration: "100", amount_received: "1000000", amount_applied: "900000",
			gas_allowance: "100000", remainder: "0", from_cctp: String(fromCctp),
		},
	};
}

async function fixture() {
	const pg = new PGlite();
	for (const file of readdirSync(new URL("../../drizzle/", import.meta.url))
		.filter(file => /^\d{4}_.*\.sql$/.test(file)).sort()) {
		await pg.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8"));
	}
	const queries: string[] = [];
	state.database.mockReturnValue(drizzle(pg, { logger: { logQuery: query => queries.push(query) } }));
	const activateName = async (name: string) => activate.fetch(new Request("https://namepass.test/api/names/activate", {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
	}));
	return { pg, queries, activateName };
}

test("activation never replays history; recovery bounds work, skips settled events, and saves progress", async () => {
	const { pg, queries, activateName } = await fixture();
	try {
		// Authenticated events can arrive before activation, including an incomplete bundle.
		const pendingClaim = renewal("000-pending-claim", "alice", true);
		for (const event of [pendingClaim, ...Array.from({ length: 30 }, (_, i) => renewal(`alice-${i}`)),
			renewal("bob-1", "bob"), renewal("bob-2", "bob"), renewal("unactivated", "charlie"),
			{ ...renewal("deleted"), gsOp: "d" as const }]) {
			await ingestGoldskyEvent(postgresGoldskyStore, event);
		}
		queries.length = 0;
		expect((await activateName("alice")).status).toBe(201);
		expect((await activateName("alice")).status).toBe(200);
		expect((await activateName("bob")).status).toBe(201);
		expect(queries.some(query => query.includes('"chain_events"'))).toBe(false);
		expect((await pg.query("select * from flows")).rows).toHaveLength(0);

		// A live projection is already complete and must not be rewritten by history repair.
		await ingestGoldskyEvent(postgresGoldskyStore, renewal("already-settled"));
		await pg.exec(`create table history_writes (kind text);
			create function record_history_write() returns trigger language plpgsql as $$
			begin insert into history_writes values (TG_TABLE_NAME); return new; end $$;
			create trigger track_aggregate after update of lifetime_received on names
				for each row execute function record_history_write();
			create trigger track_flow after update on flows
				for each row execute function record_history_write();`);
		const checkpointCount = async () => (await pg.query<{ n: number }>(
			"select count(*)::int as n from chain_events where renewal_reconciled_at is not null",
		)).rows[0].n;
		await reconcileStoredRenewals();
		expect(await checkpointCount()).toBe(25);
		expect((await pg.query<{ n: number }>("select count(*)::int as n from flows")).rows[0].n).toBe(25);
		expect((await pg.query("select * from history_writes where kind='names'")).rows).toHaveLength(1);
		expect((await pg.query("select * from history_writes where kind='flows'")).rows).toHaveLength(0);
		await reconcileStoredRenewals();
		expect(await checkpointCount()).toBe(33);
		expect((await pg.query<{ n: number }>("select count(*)::int as n from flows")).rows[0].n).toBe(33);
		const totals = await pg.query("select normalized_label, lifetime_received::text, lifetime_applied::text, renewal_count::int from names order by normalized_label");
		expect(totals.rows).toEqual([
			{ normalized_label: "alice", lifetime_received: "32000000", lifetime_applied: "28800000", renewal_count: 32 },
			{ normalized_label: "bob", lifetime_received: "2000000", lifetime_applied: "1800000", renewal_count: 2 },
		]);
		await pg.exec("truncate history_writes");
		await reconcileStoredRenewals();
		expect((await pg.query("select * from history_writes")).rows).toHaveLength(0);
		queries.length = 0;
		expect((await activateName("alice")).status).toBe(200);
		expect(queries.some(query => query.includes('"chain_events"'))).toBe(false);

		// The checkpoint must not suppress an eventual claim webhook or a reorg.
		await ingestGoldskyEvent(postgresGoldskyStore, {
			...pendingClaim, eventId: "late-claim", eventType: "CCTPClaimed", logIndex: 1,
			facts: { wallet_address: pendingClaim.facts.wallet_address, source_domain: "6", nonce: "1",
				burn_amount: "1100000", fee_executed: "100000", minted_amount: "1000000" },
		});
		expect((await pg.query("select * from flows where renewal_event_id='000-pending-claim' and status='settled'")).rows).toHaveLength(1);
		await ingestGoldskyEvent(postgresGoldskyStore, { ...renewal("alice-0"), gsOp: "d" });
		expect((await pg.query<{ n: number }>("select renewal_count::int as n from names where normalized_label='alice'")).rows[0].n).toBe(31);
		await ingestGoldskyEvent(postgresGoldskyStore, renewal("alice-0"));
		expect((await pg.query<{ n: number }>("select renewal_count::int as n from names where normalized_label='alice'")).rows[0].n).toBe(32);
	} finally { await pg.close(); }
}, 30_000);

test("a failed aggregate refresh rolls back projections and historical checkpoints together", async () => {
	const { pg, activateName } = await fixture();
	try {
		await ingestGoldskyEvent(postgresGoldskyStore, renewal("retry"));
		expect((await activateName("alice")).status).toBe(201);
		await pg.exec(`create function reject_history() returns trigger language plpgsql as $$
			begin raise exception 'fixture aggregate failure'; end $$;
			create trigger reject_history before update of lifetime_received on names
				for each row execute function reject_history();`);
		await expect(reconcileStoredRenewals()).rejects.toThrow();
		expect((await pg.query("select * from flows")).rows).toHaveLength(0);
		expect((await pg.query("select * from chain_events where renewal_reconciled_at is not null")).rows).toHaveLength(0);
		await pg.exec("drop trigger reject_history on names");
		await reconcileStoredRenewals();
		expect((await pg.query("select * from flows where status='settled'")).rows).toHaveLength(1);
		expect((await pg.query("select * from chain_events where renewal_reconciled_at is not null")).rows).toHaveLength(1);
	} finally { await pg.close(); }
}, 30_000);
