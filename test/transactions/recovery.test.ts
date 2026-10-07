import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { expect, test, vi } from "vitest";

// Replace only the external Workflow control API. SQL, leases and ownership are real.
const sdk = vi.hoisted(() => ({
	attempts: [] as string[],
	runs: new Map<string, string>(),
	failOnce: new Set<string>(),
	barrier: undefined as undefined | (() => Promise<void>),
}));
vi.mock("workflow/api", () => ({
	getRun: (id: string) => ({ exists: Promise.resolve(sdk.runs.has(id)), status: Promise.resolve(sdk.runs.get(id)) }),
	start: async (_workflow: unknown, [flowId]: [string]) => {
		sdk.attempts.push(flowId);
		const barrier = sdk.barrier;
		sdk.barrier = undefined;
		await barrier?.();
		if (sdk.failOnce.delete(flowId)) throw new Error("fixture scheduling outage");
		const runId = `fixture_${flowId}`;
		sdk.runs.set(runId, "running");
		return { runId };
	},
}));

test.skipIf(!process.env.TEST_DATABASE_URL)(
	"real PostgreSQL recovery preserves flow identity and ownership across scheduling failures and concurrent calls",
	async () => {
		const source = new URL(process.env.TEST_DATABASE_URL!);
		expect(["127.0.0.1", "localhost", "[::1]"]).toContain(source.hostname);
		const databaseName = `namepass_recovery_${randomUUID().replace(/-/g, "")}`;
		const admin = new Pool({ connectionString: source.toString() });
		await admin.query(`CREATE DATABASE "${databaseName}"`);
		source.pathname = `/${databaseName}`;
		const fixture = new Pool({ connectionString: source.toString() });
		const priorUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = source.toString();
		let applicationPool: Pool | undefined;
		const fetchGuard = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network or signing work"));
		try {
			for (const file of readdirSync(new URL("../../drizzle/", import.meta.url))
				.filter(file => /^000[0-8]_.*\.sql$/.test(file)).sort()) {
				await fixture.query(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8"));
			}
			const { database } = await import("../../server/db/client");
			const { recoverOperations } = await import("../../server/operations");
			applicationPool = (database() as ReturnType<typeof database> & { $client: Pool }).$client;
			const now = new Date();
			const old = new Date(now.getTime() - 10 * 60_000);
			const cases = [
				{ key: "unowned", owner: null, at: now, status: "queued" },
				{ key: "stale_marker", owner: "starting:interrupted", at: old, status: "queued" },
				{ key: "scheduling_failure", owner: null, at: now, status: "queued" },
				{ key: "completed_owner", owner: "old_completed", at: old, status: "queued" },
				{ key: "active_owner", owner: "active_pending", at: old, status: "queued" },
				{ key: "fresh_marker", owner: "starting:recent", at: now, status: "queued" },
				{ key: "cancelled", owner: null, at: old, status: "cancelled" },
			];
			const ids = new Map<string, string>();
			for (const [index, item] of cases.entries()) {
				const nameId = randomUUID(), flowId = randomUUID(); ids.set(item.key, flowId);
				const address = `0x${(index + 1).toString(16).padStart(40, "0")}`;
				const hash = `0x${(index + 1).toString(16).padStart(64, "0")}`;
				await fixture.query("INSERT INTO names(id,normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at) VALUES($1,$2,$3,$4,$4,$5,$6)", [nameId, item.key, `${item.key}.eth`, hash, address, now]);
				await fixture.query("INSERT INTO flows(id,name_id,origin_chain_id,trigger,status,amount_detected,workflow_run_id,updated_at) VALUES($1,$2,11155111,'automatic',$3,500000,$4,$5)", [flowId, nameId, item.status, item.owner, item.at]);
			}
			sdk.runs.set("old_completed", "completed"); sdk.runs.set("active_pending", "pending");
			sdk.failOnce.add(ids.get("scheduling_failure")!);
			let entered!: () => void, release!: () => void;
			const started = new Promise<void>(resolve => { entered = resolve; });
			const paused = new Promise<void>(resolve => { release = resolve; });
			sdk.barrier = async () => { entered(); await paused; };
			const first = recoverOperations(now);
			await Promise.race([started, first.then(() => { throw new Error("Recovery finished without claiming a fixture flow."); })]);
			try {
				const concurrent = await recoverOperations(now);
				expect(concurrent.skipped).toBe(true);
			} finally { release(); }
			expect((await first).failed).toBe(1);
			const row = async (key: string) => (await fixture.query("SELECT id,status,workflow_run_id FROM flows WHERE id=$1", [ids.get(key)])).rows[0];
			expect((await row("scheduling_failure")).workflow_run_id).toBeNull();
			await recoverOperations(new Date());
			for (const key of ["unowned", "stale_marker", "completed_owner", "scheduling_failure"]) {
				const stored = await row(key);
				expect(stored.id).toBe(ids.get(key));
				expect(stored.workflow_run_id).toBe(`fixture_${ids.get(key)}`);
				expect(sdk.attempts.filter(id => id === stored.id)).toHaveLength(key === "scheduling_failure" ? 2 : 1);
			}
			expect((await row("active_owner")).workflow_run_id).toBe("active_pending");
			expect((await row("fresh_marker")).workflow_run_id).toBe("starting:recent");
			expect((await row("cancelled")).status).toBe("cancelled");
			for (const key of ["active_owner", "fresh_marker", "cancelled"]) expect(sdk.attempts).not.toContain(ids.get(key));
			expect((await fixture.query("SELECT count(*)::int AS n FROM flows")).rows[0].n).toBe(cases.length);
			expect((await fixture.query("SELECT count(*)::int AS n FROM transaction_intents")).rows[0].n).toBe(0);
			expect(fetchGuard).not.toHaveBeenCalled();
		} finally {
			fetchGuard.mockRestore();
			if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
			await applicationPool?.end(); await fixture.end();
			await admin.query(`DROP DATABASE "${databaseName}"`); await admin.end();
		}
	}, 30_000,
);
