import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	joinTransactionEvidence,
	type SourceInspection,
	type AllocationInspection,
	type RenewalInspection,
} from "./transaction-evidence";

// Recorded independent inspector outputs test composition, not receipt/database verification.
const read = (name: string) =>
	JSON.parse(
		readFileSync(
			new URL(`../docs/deployments/2026-10-06/${name}.json`, import.meta.url),
			"utf8",
		),
	);
const sources = read("public-api-source-finality-operator").rows;
const allocations = [
	...read("public-api-allocation-operator").rows.filter(
		(r: any) => r.evidence.name !== "paramore.eth",
	),
	read("public-api-long-allocation-operator").result,
];
const renewals = read("public-api-processing-renewal-operator").rows;
function fixture(index = 0) {
	const source = structuredClone(sources[index]) as SourceInspection;
	for (const m of source.evidence.members)
		m.allocationLogIndex = m.receiptLogIndex;
	const allocation = structuredClone(
		allocations.find(
			(r: any) =>
				r.evidence.transactionHash === source.evidence.transactionHash,
		).evidence,
	) as AllocationInspection;
	allocation.blocks = [
		{ number: allocation.fromBlock, hash: allocation.fromBlockHash },
		{ number: allocation.throughBlock, hash: allocation.throughBlockHash },
	];
	const ids = new Set(allocation.deposits.flatMap((d) => d.processingCallIds));
	const results = structuredClone(
		renewals
			.filter((r: any) => ids.has(r.evidence.processingId))
			.map((r: any) => r.evidence),
	) as RenewalInspection[];
	return { source, allocations: [allocation], renewals: results };
}
const join = (f: ReturnType<typeof fixture>) =>
	joinTransactionEvidence(f.source, f.allocations, f.renewals);

test("all seven recorded payment paths join exact credits, calls and renewal events", () => {
	for (let i = 0; i < sources.length; i++) {
		const f = fixture(i),
			result = join(f);
		assert.equal(
			result.evidenceComplete,
			true,
			f.source.evidence.members[0].name,
		);
		assert.deepEqual(result.reasons, []);
		assert.deepEqual(result.deposits[0].renewalIds, [f.renewals[0].renewalId]);
		assert.equal(
			result.deposits[0].amount,
			sources[i].evidence.members[0].amount,
		);
		assert.equal(result.renewals[0].secondsAdded, f.renewals[0].secondsAdded);
	}
});

test("a renewed first member cannot complete an open source set, missing allocation or unfinished renewal", () => {
	for (const edit of [
		(f: ReturnType<typeof fixture>) => {
			f.source.evidence.receiptSetClosed = false;
			f.source.evidence.unregisteredRecipients = [
				"0x1111111111111111111111111111111111111111",
			];
		},
		(f: ReturnType<typeof fixture>) => {
			f.source.evidence.representationComplete = false;
			f.source.evidence.missingIndexedMembers = ["late-second-credit"];
		},
		(f: ReturnType<typeof fixture>) => {
			f.source.sourceFinality.providerFinalized = false;
		},
		(f: ReturnType<typeof fixture>) => {
			f.allocations = [];
			f.renewals = [];
		},
		(f: ReturnType<typeof fixture>) => {
			f.allocations[0].deposits[0].windowClosed = false;
		},
		(f: ReturnType<typeof fixture>) => {
			f.renewals = [];
		},
		(f: ReturnType<typeof fixture>) => {
			f.renewals[0].providerFinalized = false;
		},
		(f: ReturnType<typeof fixture>) => {
			f.source.evidence.members[0].allocationLogIndex = null;
			f.allocations = [];
			f.renewals = [];
		},
	]) {
		const f = fixture();
		edit(f);
		assert.equal(join(f).evidenceComplete, false);
	}
	const staggered = fixture();
	const second = {
		...staggered.source.evidence.members[0],
		sourceId: "late-second-credit",
		indexedEventId: null,
		allocationLogIndex: 999,
		receiptLogIndex: 999,
	};
	staggered.source.evidence.members.push(second);
	staggered.source.evidence.receiptSetClosed = false;
	staggered.source.evidence.missingIndexedMembers = [second.sourceId];
	staggered.allocations[0].deposits.push({
		movementId: `${staggered.source.evidence.chainId}:${staggered.source.evidence.transactionHash}:999`,
		receiptLogIndex: 999,
		amount: second.amount!,
		windowClosed: false,
		processingCallIds: [],
	});
	assert.equal(join(staggered).evidenceComplete, false);
});

test("pooled credits reference one whole renewal and split credits retain both exact events", () => {
	const f = fixture(),
		member = f.source.evidence.members[0],
		a = f.allocations[0];
	f.source.evidence.members.push({
		...member,
		sourceId: `${member.sourceId}-second`,
		indexedEventId: "second-indexed-event",
		receiptLogIndex: 999,
		allocationLogIndex: 999,
	});
	a.deposits.push({
		...a.deposits[0],
		movementId: `${a.chainId}:${a.transactionHash}:999`,
		receiptLogIndex: 999,
	});
	const pooled = join(f);
	assert.equal(pooled.evidenceComplete, true);
	assert.equal(pooled.renewals.length, 1);
	assert.deepEqual(
		pooled.deposits[0].renewalIds,
		pooled.deposits[1].renewalIds,
	);
	assert.equal(
		pooled.renewals[0].secondsAdded,
		f.renewals[0].secondsAdded,
		"shared duration stays whole",
	);
	const second = structuredClone(f.renewals[0]),
		call = structuredClone(a.processingCalls[0]);
	second.processingId = `${a.chainId}:0x${"ab".repeat(32)}:55`;
	call.processingId = second.processingId;
	call.transactionHash = `0x${"ab".repeat(32)}`;
	call.logIndex = 55;
	second.renewalId = `${second.chainId}:${second.transactionHash}:999`;
	a.processingCalls.push(call);
	f.renewals.push(second);
	for (const d of a.deposits)
		d.processingCallIds = [...d.processingCallIds, second.processingId];
	const split = join(f);
	assert.equal(split.evidenceComplete, true);
	assert.equal(
		split.renewals.length,
		2,
		"same-transaction events keep distinct log identities",
	);
	assert.deepEqual(split.deposits[0].renewalIds, [
		f.renewals[0].renewalId,
		second.renewalId,
	]);
});

test("amount, identity, block, wallet and CCTP corrections invalidate dependent joins", () => {
	for (const edit of [
		(f: ReturnType<typeof fixture>) => {
			f.allocations[0].deposits[0].amount = "1";
		},
		(f: ReturnType<typeof fixture>) => {
			f.allocations[0].deposits[0].receiptLogIndex++;
		},
		(f: ReturnType<typeof fixture>) => {
			f.source.evidence.blockHash = `0x${"cd".repeat(32)}`;
		},
		(f: ReturnType<typeof fixture>) => {
			f.renewals[0].depositAddress = `0x${"cd".repeat(20)}`;
		},
		(f: ReturnType<typeof fixture>) => {
			f.renewals[0].processingBlockHash = `0x${"cd".repeat(32)}`;
		},
		(f: ReturnType<typeof fixture>) => {
			f.renewals[0].cctp!.messageIndex++;
		},
		(f: ReturnType<typeof fixture>) => {
			f.renewals.push(structuredClone(f.renewals[0]));
		},
		(f: ReturnType<typeof fixture>) => {
			f.allocations[0].blocks = [];
		},
		(f: ReturnType<typeof fixture>) => {
			f.allocations[0].processingCalls[0].directRenewalId = "11155111:wrong:0";
		},
	]) {
		const f = fixture();
		edit(f);
		assert.throws(() => join(f), /inconsistent_transaction_evidence/);
	}
});
