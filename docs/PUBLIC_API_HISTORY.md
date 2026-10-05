# Private history adapter

Date: 2026-10-05. Implementation for review; production remains disabled.

`GET /api/v1/names/{name}/renewals` reads the existing schema. It never activates a name,
refreshes ENS state, starts a Workflow or writes payment records. No migration, contract
deployment, ingestion change or verification worker is introduced.

## Field sources and current limits

| Field | Source and verification |
| --- | --- |
| `name` | ENSIP-15 normalized lookup in `names.normalized_label` |
| `currentExpiry` | Nullable recorded `names.current_expiry`; not a fresh chain read |
| `expiryUpdatedAt` | Always `null`: existing writers do not preserve paired read provenance |
| `renewalId` | Gateway receipt's exact `Renewed` event; `{chainId}:{lowercaseTransactionHash}:{logIndex}` |
| `flowId` | Existing `flows.renewal_event_id` association for this name; supported by wallet, source-chain and processed-amount agreement |
| `sourceChainId` | Sepolia for direct renewals; receipt-segment `CCTPClaimed.sourceDomain` for cross-chain renewals, matched to the stored flow's chain, nonce and burn amount |
| `chainId`, `transactionHash` | Successful Sepolia receipt, expected transaction/block and current canonical block hash |
| `secondsAdded`, `amountApplied`, `renewalFee` | Indexed gateway facts checked against the exact receipt log |
| `renewedAt` | Indexed block time checked against the receipt block's timestamp |
| `expiry` | `null` until this adapter verifies event-specific ENS expiry evidence |
| `status` | Always `processing` in this private stage; canonical receipt checks do not prove finality or the complete source-payment model |
| `nextCursor` | Versioned, normalized-name-bound timestamp, transaction hash, log index and flow UUID tuple |

The established [expiry writer audit](PUBLIC_API_BASELINE.md#expiry-writer-audit) still applies.
Neither `ens_synced_at`, response time nor a receipt timestamp becomes an ENS read timestamp.
Unknown pairing remains null even after a projection changes, rolls back or clears the expiry.

Only canonical indexed gateway events with a flow association for the requested name are
candidates. An event without the required association waits for core reconciliation; the API
does not fabricate a flow. Receipt disagreements, missing receipts, unsupported claims and
provider failures return retryable 503 instead of incomplete guessed responses. Invalidated
indexed events disappear on subsequent reads. This is an observation, not an irrevocable
completion guarantee.

## Pagination and resource bounds

Default limit is 20; valid limits are integers from 1 to 100. Ordering is descending block
time, lowercase transaction hash, log index and flow UUID. Cursor comparison uses the same
tuple, including when timestamps are equal. The cursor must belong to the normalized name.
It carries no authorization or secret. It is not a snapshot of future index delivery;
refresh the first page to discover new or late events. The current schema allows one flow
owner per indexed renewal event. The flow tie-breaker also keeps ordering defined if distinct
indexed rows describe the same canonical event. Clients deduplicate by `renewalId`.

The flag `NAMEPASS_PUBLIC_HISTORY_ENABLED=1` enables this adapter; the default is 503.
GET and OPTIONS have browser CORS and no-store headers. Other methods return 405. Maintenance
blocks reads. Invalid names and pagination fail before database or RPC access. Unknown names
return 404; activated names with no candidates return an empty page without RPC.

This adapter owns a separate two-connection PostgreSQL pool. Connection acquisition has a
5000 ms timeout, statements 5000 ms, driver queries 7000 ms, locks 1500 ms and idle transactions
10000 ms. The connection requests read-only defaults and every query group explicitly starts
a repeatable-read, read-only transaction. It selects existing columns, fetches at most 101
candidate rows and releases the database connection before RPC work.

Each process admits two history requests. Each request has at most two verification workers
and four logical RPC calls in flight. Only chain ID, receipt and block reads are allowed;
the budget is 201 logical calls for the maximum 100-item page. Receipts and blocks are shared
within a request. Retries are disabled, individual RPC transport timeout is 10000 ms, and
RPC reads use a 15000 ms deadline measured from request start plus caller cancellation.
Database work has its own bounds; the RPC deadline does not cancel a database transaction.
The per-process capacity limit is not distributed abuse protection. Public exposure remains
blocked pending a measured pagination/RPC budget and distributed controls.

## Evidence and release gates

Fresh HTTP tests execute the route's SQL in PostgreSQL through PGlite. They check name-only
results, equal-time pagination, distinct renewals in one transaction, exact cross-chain claim
segments, late delivery, corrections, null freshness and provider failures. A separate CI test
uses a disposable real PostgreSQL database to verify read-only connection defaults, existing
schema compatibility, empty activated history, unknown-name behavior and unchanged records.
Local runs without `TEST_DATABASE_URL` explicitly skip that real-server case.

A fresh read-only live inventory found ten canonical renewals, all with flow associations and
receipt-derived expiry facts. Local execution of this adapter against those existing records
passed for seven names and all ten renewals, including direct and Arc-funded renewals. Every
database session was verified read-only. No hosted flag, live record, ingestion configuration
or signing credential changed. [Read evidence](deployments/2026-10-05/public-api-history-reads.json)
includes the implementation file checksums; this is not a deployed endpoint or payment canary.

Protected hosted verification still needs an explicitly scoped staging reader and RPC setting.
Finality, event-specific expiry, status/history agreement, shared deposit results, source
coverage and the complete payment mapping remain separate gates in
[PUBLIC_API_PLAN.md](PUBLIC_API_PLAN.md). Do not enable public history or return `complete`
until those gates pass. The public guides' unavailable notice remains.
