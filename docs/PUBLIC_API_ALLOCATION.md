# Deposit-to-renewal allocation review

Date: 2026-10-05. Updated 2026-10-06 with short and extended operator limits.
No status endpoint, migration, worker or public API enable setting is introduced.

## Result

The seven indexed live deposits have a verified simple processing path. Each inspected wallet
window contains one incoming payment and one outgoing processing debit. Its pre-source and
post-processing balances are zero. Receipt identities, amounts and ordered positions match.
This is sample evidence; it does not prove pooling, split processing or hosted index coverage.

Nine of ten settled flows have exact origin events. All nine origin receipts match the indexed
`DepositProcessed` identity, label, wallet, amount and remaining balance. Eight are Arc burns;
each matches the exact source `MessageSent`, Circle's source-transaction response, its ordered
final message, and the hub `CCTPClaimed` and `Renewed` segment. The indexed direct Sepolia flow
has matching processing and renewal events in the same receipt. The remaining external direct
flow has a renewal but no stored origin event or origin hash. Its source relationship is unknown.

Three settled flows have no deposit link. Two have verified Arc origin/settlement relationships,
but neither has an indexed funding deposit. A known renewal does not identify its source deposit.
The seven linked samples do not close that gap, and no records were changed to fill it.

The [dated receipt](deployments/2026-10-05/public-api-allocation-evidence.json) records the sample
identities, canonical block hashes, provider finality anchors and wallet movements.

## Facts and proposed status mapping

| Fact | Meaning for a status response |
| --- | --- |
| `flows.deposit_event_id` | A candidate trigger link, not a complete consumption ledger. |
| Exact factory `DepositProcessed` log | Identifies one processing call; verify its receipt, configured emitter, label, wallet, amount and position. |
| Factory `remaining > 0` | More wallet funds remain after that call. One settled slice cannot prove that a source payment is fully processed. |
| Factory `remaining = 0` | Candidate drain boundary. Verify actual movement, ordering and deployed contract behavior before using it to close a deposit's consumption window. |
| Exact gateway `Renewed` log | One renewal result, identified by chain ID, transaction hash and log index. |
| Stored `settled` or `finalized` enum | Candidate projection only. It cannot replace receipt, allocation or finality evidence. |

The current factory reads the wallet's token balance and processes that balance, capped by
Circle's burn limit off the hub. It does not receive a source deposit ID. The wallet delegates
to the factory; `onlyWalletContext` restricts execution, and its approved payment destinations
are fixed after initialization. These are current source-code properties. The status verifier
must pin the deployed factory/wallet behavior and route configuration before relying on them
as custody evidence. This audit did not independently verify historical factory runtime hashes.

For the first read-only allocation adapter, use a bounded, ordered movement window from the
source credit through a verified full-wallet drain. Verify every outgoing movement in that
window against an exact supported processing call and its renewal. Cover block number,
transaction index and log index; timestamps and block-only comparisons cannot order same-block
payments. Keep source and origin finality separate from hub renewal finality.

Pooling and slicing need no invented per-deposit amount allocation. Several deposits may share
one renewal, and one deposit may require several calls. Report whole, event-specific renewal
results with the same `renewalId` wherever shared. Until the window closes and all applicable
calls are proven, the deposit remains processing. Define shared-window semantics explicitly
in the guide before implementation; do not introduce FIFO or divide renewal duration without
evidence. A call before a source credit cannot be claimed as that payment's renewal.

Missing index members, an unknown debit, an incomplete movement range, an ambiguous call or
an unverified slice prevents completion. A provider failure is retryable unavailability, not
a failed payment. Corrections invalidate dependent source, processing and renewal proofs.
The existing block-only absorption helper remains an operational recovery rule; it is not the
API allocation verifier.

## Exact cross-chain relationship

The origin parser already selects one factory event by its true log index and one
`MessageSent` between the preceding factory event and that event. Its `messageIndex` counts
all messages from the configured transmitter in receipt order. Do not identify a burn by
wallet, amount or transaction hash alone.

Circle assigns the final nonce offchain. Its [technical guide](https://developers.circle.com/cctp/references/technical-guide)
defines the message fields; the [messages endpoint](https://developers.circle.com/api-reference/cctp/all/get-messages-v2)
defines ascending log-index order for messages in one source transaction. This audit queried
that endpoint by source domain and exact origin hash. It checked response source hash, message
count, ordered index, final message bytes and nonce against the stored candidate. Equal-value
burns still need that exact positional binding.

The source and final messages match in all immutable bytes: versions, domains, sender,
recipient, destination caller, minimum finality, token, mint recipient, amount, source wallet,
maximum fee and complete label hook. The nonce, executed finality, executed fee and expiration
are attestation fields, so they cannot be required to equal their source placeholders. The hub
claim matches the final nonce, domain, wallet, burn amount, fee and minted amount; its renewal
matches that minted amount in the same helper-call segment.

All eight samples have zero executed bridge fee. This discovery does not query fee pricing or
change automation's Standard-transfer policy. A successful configured destination contract
supplies the onchain acceptance evidence; the future verifier must retain that trust boundary.

## Verification limits and next implementation

The audit used one enforced repeatable-read, read-only database snapshot and read-only RPC/
Circle requests. It checked 25 unique successful receipts against their canonical blocks,
48 bounded transfer-log queries, 14 historical `balanceOf` reads and eight Circle message
responses. Six wallet windows use Arc's authoritative eighteen-decimal system stream; one
uses Sepolia's six-decimal token stream. Mirrors are not counted again. Each relevant returned
movement was also found at the exact position in its successful receipt. Conservation agrees
with both boundary balances in all seven windows.

The longest sample spans 17,097 blocks and takes 36 transfer-log requests alone. This is an
operator audit, not a suitable unbounded per-poll API strategy. The adapter needs a hard range,
request and deadline budget, with truthful pending/unavailable behavior when the proof exceeds
that budget. Do not add a background verifier or stored allocation table without a measured
need and separate review.

All observed source-processing and hub-renewal blocks are below their provider's `finalized`
anchors. This is capability evidence for these Arc/Sepolia samples, not a reviewed policy for
all routes. No Base/Arbitrum payments, pooled or split live payments, same-block funding,
late watch propagation, distributed load or correction rehearsal was exercised.

The bounded verifier below implements the source-to-processing part of this model. Shared
finalized renewal joins remain separate. Keep public status disabled until source-set/coverage
rules, finality policy and exact hosted end-to-end verification pass. No new contract is required.

## Bounded source-to-processing verifier — 2026-10-06

The operator CLI now implements that consumption-window check without reading or modifying
the database. Run it with the selected chain's RPC variable supplied securely:

```bash
node --import tsx scripts/public-api/allocations.ts 11155111 steve '<source-hash>' '<decimal-end-block>'
```

It queries both movement directions from the source block through the supplied boundary.
The window is limited to 2,048 blocks, in 512-block ranges; 256 distinct movements, 16 receipts,
64 total RPC requests and one 15-second deadline bound the work. The transport has a one-MiB
response limit and no retries. Only chain/block/receipt/log/code reads and `eth_call` are allowed.
Provider errors and credentials are suppressed. No signer, activation, Workflow or database path
is used. The CLI reports failure rather than truncating excess evidence.

The verifier independently fetches the source receipt, checks all returned movement identities
against complete successful receipts and canonical block hashes, and checks for wallet movements
missing from the range result within those receipts. It pins the factory's reviewed runtime at
the source and processing blocks and checks the wallet's exact ERC-1167 runtime at each call.
These reads support the factory custody assumptions; they do not pin every token/Circle/gateway
dependency. Provider range completeness remains a trust prerequisite. A whole omitted transaction
with offsetting movements cannot be ruled out solely by boundary-balance conservation.

Every debit must match one exact factory call segment and amount. Direct calls must contain the
matching gateway renewal and transfer destination; cross-chain calls must contain the matching
source message at its exact ordered index. Balances are replayed in block, transaction and log
order, checked against each reported remainder and the historical boundary balances. Both block
boundaries are rechecked after inspection; a correction prevents a successful proof.

`windowClosed` means the requested source credits reached a verified zero six-decimal token
balance within this window. Each credit lists whole `processingCallIds` after its credit and
through its first drain. Pooled credits share identifiers; split credits list several calls.
No amount or renewal time is apportioned. Later credits do not acquire earlier call identities.
An unfinished slice leaves the window open. The tool also checks unrelated movements in the
same bounded window conservatively; an unknown debit fails inspection.

These are private movement/call identities. Arc uses its authoritative system log positions,
including for ERC-20 mirrors; mapping them to the existing public source-deposit representation
needs a reviewed, unambiguous join. `directRenewalId` is a matched gateway event candidate,
not a finalized ENS result. Cross-chain claim verification, registry/index coverage, source
finality and aggregate transaction completion are deliberately absent from this output.

Nine regression tests cover pooling with prior balances, split calls, later credits, two burns
in one transaction, same-block drains, duplicates, missing/unknown movements, wrong runtime,
corrections, precision and resource limits. The actual CLI is exercised through an HTTP fixture
with serialized receipts and provider-error sanitization. The factory bytecode fixture matches
the historical Sepolia runtime and the reviewed deployment hash; these tests do not execute
Solidity or substitute for live pooled/split funding.

The actual CLI inspected all seven existing indexed payments: six simple windows closed with
14 RPC reads each. The long-delay payment stayed open after 17 reads at the window boundary.
[Operator evidence](deployments/2026-10-06/public-api-allocation-operator.json) records the exact
implementation checksums. The original short mode cannot verify that long payment through its
later processing block. The extended audit below now covers it. A public polling budget or
coverage/resumption strategy remains a status-release decision; no worker or schema was added.

## Extended delayed-payment audit — 2026-10-06

The same read-only CLI accepts an explicit `--extended` flag for operator audits:

```bash
node --import tsx scripts/public-api/allocations.ts 5042002 paramore '<source-hash>' '<decimal-end-block>' --extended
```

The default stays at 2,048 blocks, 64 RPC calls and 15 seconds. Extended mode permits at most
32,768 blocks, 192 RPC calls and one 60-second deadline. Both modes keep the same 512-block
queries, 256 movements, 16 receipts, one-MiB HTTP responses and read-only method whitelist.
Invalid flags and excess evidence fail inspection. There is no saved cursor or trusted client
checkpoint: each audit verifies the whole selected range from the source receipt. Returned
`rangeMode` and `limits` identify the actual budget.

The delayed `paramore.eth` payment now passes from block `63411550` through `63428646`, a
17,097-block inclusive range. Its one three-USDC source credit reaches one exact three-USDC
processing call with a zero remainder. Both boundary balances are zero. The real CLI used
80 RPC calls in approximately 15.2 seconds, including process startup. See the
[extended operator evidence](deployments/2026-10-06/public-api-long-allocation-operator.json).
That processing identifier matches the already reviewed
[processing-to-renewal evidence](deployments/2026-10-06/public-api-processing-renewal-operator.json).
This audit does not refresh that separate proof's provider finality anchors.

The delayed-drain regression fails against the previous short-only implementation. Eleven
allocation tests now cover the extended CLI, pending slices, credits across range boundaries,
unknown debits, changed boundary hashes and hard request/range caps alongside the existing
pooling, split and receipt checks. The longer scan adds no API route, database access, job,
payment work, funding or hosted setting.

This closes the known sample's source-to-processing range gap. It does not prove arbitrary
waiting periods fit a bounded public poll. Public transaction status still needs full source
and indexed membership, watch coverage, reviewed finality, all renewal joins and hosted capacity.
Keep it absent until those gates pass; operator `windowClosed` is not API `complete`.
