# Transaction status adapter

Date: 2026-10-06. Read-only HTTP adapter merged in PR #135, disabled by default.
Production boundaries are verified in [DEPLOYMENTS.md](DEPLOYMENTS.md#private-transaction-status-adapter--2026-10-06). Public release gates remain open.

`GET /api/v1/status/{chainId}?transactionHash={hash}` runs the existing source, allocation and
renewal verifiers inside a bounded request. No client manifest, processing boundary, caller fee,
background job or saved completion record is accepted. `NAMEPASS_PUBLIC_STATUS_ENABLED=1` is
required. Production flags remain off. Status and history are enabled only on the protected previews recorded in
[DEPLOYMENTS.md](DEPLOYMENTS.md), against isolated `api-staging` through a SELECT-only reader.
Quote and address remain disabled on those read-only previews. Disabled status URLs return JSON 503 rather
than the earlier absent-route 404. OPTIONS returns 204 and unsupported methods return 405.
The preview read proxy leaves this route to its own adapter.

## Field and state sources

| Response | Evidence |
| --- | --- |
| `chainId`, `transactionHash` | Supported source chain and one validated, normalized hash |
| Deposit `name`, `depositAddress` | Canonical source transfer recipient, current registered normalized label and derived wallet |
| Deposit `amount`, `logIndex` | Exact source receipt credit in six-decimal units; native Arc public position is null |
| Deposit `renewals` | Every exact processing call after the credit through its verified full-wallet drain, joined to finalized renewal receipts |
| `renewalId` | Hub chain, lowercase gateway renewal transaction hash and gateway `Renewed` log index, identical to history |
| `secondsAdded`, `expiry` | Whole gateway event duration and associated ENS registration expiry; V1 uses its BaseRegistrar event |

A repeatable-read snapshot supplies the registry, watched addresses, indexed source members and
bounded processing/renewal candidate identities. Flow status, amounts and dates do not establish
completion. Candidates only locate receipts. Their canonical event family, type, source/hub chain,
name and source-block range are constrained in SQL. The underlying verifiers authenticate
factory/wallet/gateway/helper runtime and ordered credit, processing, Circle and ENS receipts.

`pending` means the source set is not closed, a member is not indexed, a credit identity is
ambiguous, the source is not provider-finalized, or an unprocessed deposit is below the protocol
minimum. `processing` means source evidence is closed and finalized but one or more required
allocations or finalized renewals are missing. A partial result can include a proven whole renewal
while the transaction remains processing. Shared events keep the same identifier; clients count
whole event duration once. No duration is invented for an individual credit.

`complete` requires a closed, nonempty source set and complete allocation/finalized renewal evidence
for every member. One renewed member cannot close a transaction while another arrives late.
`failed` requires a canonical, reverted source transaction with an empty receipt log set and
configured-provider source finality. Its indexed historical deposits are validated but have no
renewals. An index `orphaned`/flow `failed` state alone cannot establish this result.

A second database snapshot and source inspection follow all joins. Changed membership, receipt
identity, candidate identities or regressed finality invalidate the request. Every retained source,
allocation, processing, renewal and numbered finality block is rechecked before a successful
response. There is no completed-result cache; a correction can revoke prior completion.

## Bounds and errors

| Bound | Request limit |
| --- | --- |
| Database concurrency | Separate attached pool, two connections; two admitted requests per process |
| Database access | Read-only URL options and explicit repeatable-read READ ONLY transactions, released before RPC |
| Database timeouts | Connection 5 seconds, statement 5 seconds, client query 7 seconds, lock 1.5 seconds, idle transaction 10 seconds |
| Current registry / indexed members | 1,000 registered names, 16 indexed members; overflow fails rather than truncates proof |
| Source members / wallets | 16 / 8 |
| Candidate discovery | At most 32 canonical processing rows within 32,768 blocks from the earliest indexed source block |
| Allocation range | At most 32,768 blocks; incoming/outgoing 4,096-block chunks, 64 RPC reads per wallet |
| Whole request RPC / Circle reads | 96 / 16, including both source inspections and final block rechecks |
| Required processing calls / final blocks | 16 / 64 |
| Provider cancellation | One 15-second signal from request admission, combined with caller cancellation |
| Provider response | One MiB per response; redirect rejection, sequential reads, no retries |

The cancellation signal bounds chain/HTTP work. Database operations retain their own finite
connection/query timeouts; database reads are not interruptible by that signal. A response cannot
succeed after cancellation. The per-process admission bound is not a distributed rate limit.

HTTP allocation mode changes chunk size and bounds, not receipt, runtime, amount, ledger,
opening/closing balance or canonical-block checks. Private operator short/extended modes retain
their earlier budgets. A provider that cannot supply the configured range fails with retryable
unavailability. Larger gaps and overflow do not receive a guessed processing result.

Invalid input returns 400 before database/RPC work. Unknown indexed transactions return retryable
404 before RPC. Admission saturation returns 429. Maintenance, disabled flags, missing or malformed
receipts, provider failure, unsupported evidence, changed evidence and exhausted bounds return
503. All responses use no-store, JSON and browser CORS. Pending/processing, 429 and 503 carry
`Retry-After: 5`. Provider credentials, error strings and stack traces are not returned or logged.

## Verification and remaining release gates

The actual HTTP adapter, enabled only in a local process, verified seven existing single-deposit
payments using live read-only database and provider reads. Six native Arc payments used one Circle
response each; the Sepolia payment was direct. Each request used two verified read-only database
snapshots. RPC counts were 44–61; measured times were approximately 5–14 seconds. The delayed
sample used 61 reads and 14 seconds. See the checksum-pinned
[local HTTP evidence](deployments/2026-10-06/public-api-status-reads.json).

The direct receipt capture supplies a regression fixture. Only transport is replaced in the HTTP
tests: real adapter SQL executes against the migrated PostgreSQL-compatible fixture. Tests cover
complete event identity/duration/expiry, staggered second-member delivery, incomplete renewal
joins, receipt corrections, index-state versus source failure, reverted-source finality, sanitized
outages, validation and admission recovery. The existing real PostgreSQL/serialized-HTTP fixture
also runs the actual status route and verifies read-only URL override, both snapshots and a
mid-request canonical index correction. Allocation tests require gap-free 4,096-block coverage,
retention of late credits and rejection of a hidden debit in a delayed window. Underlying receipt
and combined-join tests retain pooled/split/shared-event proof.

The protected hosted adapter also returned `complete` for five existing Arc-to-Sepolia payments,
including the delayed sample. Status and history agree on renewal identity, duration and expiry;
history returns null for an unknown expiry read timestamp. Twenty-five API checks, two concurrent
reads, four page checks and two anonymous SSO checks passed. Status elapsed times were 5.8–8.3
seconds including CLI authentication/startup. Existing staging rows and the approved copied fields
remained unchanged after these probes. See the
[protected staging receipt](deployments/2026-10-06/public-api-status-staging.json).

Fresh current-ENS hosted route verification now includes all four source routes,
one newly registered Sepolia watch, and native/ERC-20 Arc pooled funding with the
same renewal identifier. Exact evidence and remaining gates are in
[DEPLOYMENTS.md](DEPLOYMENTS.md#fresh-browser-signed-route-checks-and-native-arc-indexing--2026-10-06).
The bounded polling probe does not establish sustained hosted capacity or distributed
abuse controls. Activation-boundary and restart recovery, live same-transaction
multi-deposit funding and split processing remain unproven. The earlier local delayed
sample was close to the 15-second provider deadline; larger or slower cases may
truthfully return 503. Public exposure controls, polling cost and the remaining
end-to-end gates in the [rollout plan](PUBLIC_API_PLAN.md) must pass before enablement.
Provider receipt/range
completeness and configured-provider finality remain explicit trust boundaries. The adapter
introduces no new storage, worker, schema, ingestion, Workflow, contract or signer.
The approved hosted staging settings are limited to the branch and SELECT-only database role
recorded in the receipt; production settings are unchanged.
