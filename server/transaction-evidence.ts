import { HUB_CHAIN } from "../src/lib/chains";
import type { inspectAllocation } from "./allocation-evidence";
import type { inspectProcessingRenewal } from "./processing-renewal-evidence";
import type {
	sourceDepositEvidence,
	sourceFinalityEvidence,
} from "./source-deposit-evidence";

export type SourceInspection = {
	readOnly: boolean;
	rpcCalls: number;
	databaseSnapshotAt: string;
	evidence: ReturnType<typeof sourceDepositEvidence>;
	sourceFinality: ReturnType<typeof sourceFinalityEvidence>;
};
export type AllocationInspection = Awaited<
	ReturnType<typeof inspectAllocation>
>;
export type RenewalInspection = Awaited<
	ReturnType<typeof inspectProcessingRenewal>
>;
function fail(): never {
	throw new Error("inconsistent_transaction_evidence");
}

/** Joins fresh inspector results. The CLI must recheck the returned blocks and source snapshot before publishing. */
export function joinTransactionEvidence(
	source: SourceInspection,
	allocations: AllocationInspection[],
	renewals: RenewalInspection[],
	completion: "finalized" | "confirmed" = "finalized",
) {
	const e = source.evidence;
	if (
		!source.readOnly ||
		source.sourceFinality.sourceBlock.number !== e.blockNumber ||
		source.sourceFinality.sourceBlock.hash !== e.blockHash ||
		new Set(e.members.map((m) => m.sourceId)).size !== e.members.length
	)
		fail();
	const reasons = new Set<string>();
	if (
		!e.receiptSetClosed ||
		!e.representationComplete ||
		!e.members.length ||
		e.unregisteredRecipients.length ||
		e.missingIndexedMembers.length ||
		e.unmatchedIndexedRows.length ||
		e.unwatchedAddresses.length ||
		e.issues.length
	)
		reasons.add("source_set_open");
	if (completion === "finalized" && !source.sourceFinality.providerFinalized)
		reasons.add("source_not_finalized");
	if (e.members.some((m) => m.allocationLogIndex === null))
		reasons.add("ambiguous_source_allocation_identity");
	const blocks = new Map<
		string,
		{ chainId: string; number: string; hash: string }
	>();
	const addBlock = (chainId: string, number: string, hash: string) => {
		if (
			!/^[1-9][0-9]*$/.test(chainId) ||
			!/^(0|[1-9][0-9]*)$/.test(number) ||
			!/^0x[0-9a-f]{64}$/.test(hash)
		)
			fail();
		const key = `${chainId}:${number}`,
			previous = blocks.get(key);
		if (previous && previous.hash !== hash) fail();
		blocks.set(key, { chainId, number, hash });
	};
	addBlock(e.chainId, e.blockNumber, e.blockHash);
	addBlock(
		e.chainId,
		source.sourceFinality.finalizedBlock.number,
		source.sourceFinality.finalizedBlock.hash,
	);
	const wallets = new Set(e.members.map((m) => m.name));
	const byWallet = new Map<string, AllocationInspection>();
	for (const a of allocations) {
		if (
			!wallets.has(a.name) ||
			byWallet.has(a.name) ||
			a.chainId !== e.chainId ||
			a.transactionHash !== e.transactionHash ||
			a.fromBlock !== e.blockNumber ||
			a.fromBlockHash !== e.blockHash ||
			!a.blocks.length
		)
			fail();
		byWallet.set(a.name, a);
		for (const b of a.blocks) addBlock(a.chainId, b.number, b.hash);
		if (
			!a.blocks.some(
				(b) => b.number === a.fromBlock && b.hash === a.fromBlockHash,
			) ||
			!a.blocks.some(
				(b) => b.number === a.throughBlock && b.hash === a.throughBlockHash,
			)
		)
			fail();
		const members = e.members.filter((m) => m.name === a.name);
		if (
			a.deposits.length !== members.length ||
			new Set(a.deposits.map((d) => d.movementId)).size !== a.deposits.length ||
			new Set(a.processingCalls.map((c) => c.processingId)).size !==
				a.processingCalls.length
		)
			fail();
		for (const m of members) {
			if (m.allocationLogIndex === null) {
				reasons.add("ambiguous_source_allocation_identity");
				continue;
			}
			const d = a.deposits.find(
				(d) => d.receiptLogIndex === m.allocationLogIndex,
			);
			if (
				!d ||
				d.movementId !==
					`${e.chainId}:${e.transactionHash}:${m.allocationLogIndex}` ||
				d.amount !== m.amount ||
				a.depositAddress !== m.address
			)
				fail();
		}
	}
	const byCall = new Map<string, RenewalInspection>();
	const byRenewal = new Map<string, RenewalInspection>();
	for (const r of renewals) {
		if (byCall.has(r.processingId)) fail();
		byCall.set(r.processingId, r);
		const previous = byRenewal.get(r.renewalId);
		if (
			previous &&
			(previous.name !== r.name ||
				previous.depositAddress !== r.depositAddress ||
				previous.secondsAdded !== r.secondsAdded ||
				previous.expiry !== r.expiry ||
				previous.amountApplied !== r.amountApplied ||
				previous.renewalFee !== r.renewalFee ||
				previous.renewalBlockHash !== r.renewalBlockHash)
		)
			fail();
		byRenewal.set(r.renewalId, r);
	}
	const needed = new Set<string>();
	const deposits = e.members.map((m) => {
		const a = byWallet.get(m.name);
		const d = a?.deposits.find(
			(d) => d.receiptLogIndex === m.allocationLogIndex,
		);
		if (!a || !d) reasons.add("allocation_missing");
		const ids: string[] = [];
		if (d) {
			if (!d.windowClosed || !d.processingCallIds.length)
				reasons.add("allocation_open");
			if (new Set(d.processingCallIds).size !== d.processingCallIds.length)
				fail();
			for (const id of d.processingCallIds) {
				needed.add(id);
				const c = a!.processingCalls.find((c) => c.processingId === id),
					r = byCall.get(id);
				if (!c) fail();
				if (!r) {
					reasons.add("renewal_missing");
					continue;
				}
				if (
					r.name !== m.name ||
					r.depositAddress !== m.address ||
					r.sourceChainId !== e.chainId ||
					r.processingId !==
						`${e.chainId}:${c.transactionHash}:${c.logIndex}` ||
					r.processingBlockNumber !== c.blockNumber ||
					!a!.blocks.some(
						(b) =>
							b.number === c.blockNumber && b.hash === r.processingBlockHash,
					) ||
					r.chainId !== String(HUB_CHAIN.chainId) ||
					!r.renewalId.startsWith(`${r.chainId}:${r.transactionHash}:`) ||
					(c.directRenewalId !== null && c.directRenewalId !== r.renewalId) ||
					(c.cctpMessageIndex !== null &&
						r.cctp?.messageIndex !== c.cctpMessageIndex)
				)
					fail();
				if (completion === "finalized" && !r.providerFinalized)
					reasons.add("renewal_not_finalized");
				addBlock(e.chainId, r.processingBlockNumber, r.processingBlockHash);
				addBlock(r.chainId, r.renewalBlockNumber, r.renewalBlockHash);
				for (const b of r.anchors) addBlock(b.chainId, b.number, b.hash);
				ids.push(r.renewalId);
			}
		}
		return {
			sourceId: m.sourceId,
			name: m.name,
			amount: m.amount,
			indexedEventId: m.indexedEventId,
			processingCallIds: d?.processingCallIds ?? [],
			renewalIds: [...new Set(ids)],
		};
	});
	if ([...byCall.keys()].some((id) => !needed.has(id))) fail();
	return {
		scope: "one transaction source-to-renewal operator evidence" as const,
		chainId: e.chainId,
		transactionHash: e.transactionHash,
		evidenceComplete: reasons.size === 0,
		reasons: [...reasons],
		deposits,
		// Whole shared events appear once; per-deposit references retain their shared identities.
		renewals: [...byRenewal.values()],
		blocks: [...blocks.values()],
		limitations:
			"Private evidence only. Source snapshots and all blocks require a final recheck. Provider completeness and finality are trusted; hosted canaries and public polling capacity remain release gates.",
	};
}
