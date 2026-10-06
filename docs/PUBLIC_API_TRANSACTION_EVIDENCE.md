# Combined transaction evidence

Date: 2026-10-06. Private read-only operator. No transaction-status route or API enable flag is added.

## Interface

Supply `DATABASE_URL` and the configured source/hub RPC variables securely. Run:

```bash
node --import tsx scripts/public-api/transaction-evidence.ts '<manifest-file>'
```

The JSON manifest contains `chainId`, `transactionHash`, a decimal `throughBlock`, optional
`rangeMode` (`short` or explicitly `extended`), and `renewals`: candidate `processingId` and
`renewalId` pairs. Each event identifier uses `chainId:transactionHash:logIndex`. These are hints
for finding receipts. They cannot supply evidence, skip missing calls or close a deposit window.
Extra hints are ignored; every required call must still have a proven exact renewal.

The operator calls the existing [source inspector](PUBLIC_API_DEPOSIT_EVIDENCE.md),
[allocation verifier](PUBLIC_API_ALLOCATION.md) and [renewal verifier](PUBLIC_API_RENEWAL_EVIDENCE.md).
It imports the two chain inspectors and invokes the existing source CLI twice. The source child
gets only PATH, the database URL and its selected source RPC variable. It resolves `tsx` from the
repository, so the command works when started outside the repository. It has no signer, Workflow,
activation, ingestion, broadcast or write-query path.

## Joins and correction checks

A nonempty receipt set must be closed and source-finalized before chain joins run. For each
source recipient, the allocation verifier must enumerate the exact credits in that receipt.
Name, address, chain, transaction, source block/hash, credit position and exact amount must agree.
Missing or extra credits cannot be hidden by a renewed first member.

`allocationLogIndex` is a private source identity for the authoritative credit stream. Native Arc
funding uses its system-log position, while its public `logIndex` remains null. A unique Arc
ERC-20 mirror retains its public ERC-20 position and joins to its matching system credit. Equal
movements with several mirrors have no guessed positional pairing: that join stays unresolved.
Sepolia, Base and Arbitrum credits use their ERC-20 position.

Each deposit lists every processing call after its credit through its first verified full-wallet
drain. Every required call must join to an exact renewal. Processing identities, receipt blocks,
wallet/name, direct renewal event or CCTP message index must agree across the inspectors. Processing
and renewal finality remain required. The factory, wallet, gateway, helper and ENS checks stay in
the underlying receipt verifiers.

Pooled credits may share a whole renewal event. Its `renewalId` appears once in the transaction's
result list and in each applicable deposit's references. Split credits retain all applicable
identifiers. There is no invented per-deposit amount or duration allocation. Distinct events in
one renewal transaction retain distinct identifiers.

The allocation verifier now retains every block identity read for its receipts and boundaries.
After all joins, the operator repeats source/index enumeration and rejects a changed membership
result. It then rechecks every retained source, allocation, processing, renewal and numbered
finality block. Conflicting hashes at one chain/height or changed canonical blocks invalidate the
whole inspection. Each invocation runs fresh reads; it has no completed-result cache or saved cursor.

`evidenceComplete` is a private operator result after these final checks, not an API `status`.
Open source sets, ambiguous allocation identities, missing joins, unfinished slices and pending
finality yield false. Provider failure, resource limits or a correction yield sanitized
`transaction_inspection_unavailable` with a fixed diagnostic stage and no successful stdout.
The pure join function assembles results; its production CLI performs the final rechecks.

## Resource budget

| Limit | Whole transaction invocation |
| --- | --- |
| RPC reads | 256 total, including both source inspections and final block rechecks |
| Circle reads | 16 public testnet message responses |
| Deadline | One 90-second cancellation deadline |
| Source members / wallets | 16 / 8 |
| Processing-to-renewal candidates | 16 unique calls |
| Final block rechecks | 64 distinct chain/height pairs |
| Manifest / HTTP response / source-child output | One MiB each |

All reads are sequential and have no retries. Source inspections retain their enforced read-only
repeatable-read snapshots and release the database before RPC. Allocation and renewal reads keep
their existing range, receipt and local deadline caps. The caller reserves each inspector's maximum
RPC budget before starting it; individual transport calls also enforce the transaction-wide cap.
The global deadline cancels both transports and source children. Partial evidence is not printed
when an inspection fails. No API polling request inherits this operator budget.

## Verification and remaining gates

The real CLI freshly verified all seven existing indexed single-deposit payments: six native Arc
payments and one direct Sepolia payment. Each passed source membership/finality, exact credit/call
joins, complete allocation, finalized renewal verification, second source snapshot and final block
rechecks. The audit used 432 RPC reads and six Circle responses. Simple cross-chain samples used
53–54 RPC reads and about 10–11 seconds; the direct sample used 44 reads and about 5.1 seconds.
The delayed sample used 119 reads and about 21.7 seconds, including startup. See the checksum-pinned
[operator evidence](deployments/2026-10-06/public-api-transaction-operator.json).

The first whole-audit attempt failed before the first sample because the source child resolved
`tsx` from the launch directory. Repository-relative resolution fixed it; the fresh audit then
passed. The CLI did not retry an individual request or accept the failed attempt as evidence.

Composition regressions cover all seven recorded paths, staggered/missing source evidence,
unfinalized sources/results, unfinished windows, missing calls, shared renewals, split calls,
same-transaction event identities, amount/wallet/block mismatches and CCTP positions. Removing
the source-set guard makes the false-completion regression fail. Existing receipt-verifier tests
cover the underlying onchain proof; recorded composition fixtures do not replace those tests.
The real PostgreSQL/serialized-HTTP fixture runs the combined CLI from outside the repository,
keeps staggered indexing incomplete, and changes canonical index evidence between snapshots.
The changed evidence must fail without successful output.

This is an operator audit of existing payments, not hosted HTTP capacity evidence. Public status
still needs bounded candidate discovery and a measured public request/polling strategy, including
long waits, corrections, shared request load and unsupported evidence. Fresh multi-deposit,
pooled/split, activation-propagation and Base/Arbitrum hosted canaries remain release gates and
require user-signed funding where needed. No storage worker or schema is introduced speculatively.
Provider receipt/range completeness and configured-provider finality remain trust boundaries.
The published full-source-set and shared-renewal contracts remain unchanged. Status stays absent;
quote, address and history public flags remain off.
