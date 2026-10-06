# Public API: fresh implementation plan

Date: 2026-10-05. Status: baseline review merged; quotes and address activation verified on protected previews.
Production APIs remain disabled. A private read-only history adapter has passed protected staging;
its verification limits are in [PUBLIC_API_HISTORY.md](PUBLIC_API_HISTORY.md).
Transaction status is not implemented. Source-receipt enumeration and indexed membership
are being reviewed in [PUBLIC_API_DEPOSIT_EVIDENCE.md](PUBLIC_API_DEPOSIT_EVIDENCE.md); this
is not a payment-completion model.
Deposit-to-processing discovery is recorded in [PUBLIC_API_ALLOCATION.md](PUBLIC_API_ALLOCATION.md).
The bounded operator now verifies source-to-processing windows, with pooled/split receipt fixtures.
Processing-to-renewal joins are being verified by the bounded operator in
[PUBLIC_API_RENEWAL_EVIDENCE.md](PUBLIC_API_RENEWAL_EVIDENCE.md).
Long-window coverage, source-route finality and aggregate completion remain implementation gates.
History verifies event-specific ENS expiry and hub finality. Its deployment is
described in [PUBLIC_API_HISTORY.md](PUBLIC_API_HISTORY.md); production remains disabled.

## Starting point

The previous API implementation and its planning, tests, generated client types, example CLI,
worker and migration are removed. They are not a source for new implementation. The published
guides in `docs/content/`, downloadable skill and OpenAPI remain documentation requirements.
The existing application backend is the starting service: deterministic address derivation,
name activation, indexed events, payment flows, renewal execution and operational recovery.

First restore and verify the working application after the homepage merge. Record the exact
production commit, schema and migration ledger before any new API work. A passing UI preview
that proxies production reads is not backend deployment evidence. Never run schema migrations
to make a broken UI release work. Never delete payment records to make a migration pass.

## Requirements read from the published pages

| Documentation | Required capability | Observable acceptance |
| --- | --- | --- |
| [Introduction](content/introduction.md), [Quickstart](content/quickstart.md) | Address → caller sends USDC → poll by source hash and chain | One end-to-end testnet payment reaches a verified, finalized renewal |
| [Addresses](content/addresses.md) | `POST /api/v1/address` | Normalized name, full deterministic address, subname, verification boolean and funding chains; repeat activation is idempotent |
| [Quotes](content/quotes.md) | `POST /api/v1/quote` | Exact integer amounts, estimated duration, allowance, bridge fee, rounding remainder, pricing block and 60-second expiry |
| [Status](content/status.md) | `GET /api/v1/status/{chainId}?transactionHash={hash}` | The full relevant deposit set is proven before transaction completion; renewals have exact event identifiers |
| [History](content/history.md) | `GET /api/v1/names/{name}/renewals` | Name-only results, the same renewal identifiers as status, paired expiry provenance, newest-first pagination |
| [Reference](content/reference.md) | Anonymous JSON HTTP API and browser CORS | Correct method, content type, request validation, documented errors and retry headers |
| [Agents](content/agents.md), [Skills](content/skills.md) | Existing wallet/coding agents use the same interface | Markdown, OpenAPI and skill agree with the deployed service; no extra agent server |

All amounts use integer strings in six-decimal USDC units. Source chain ID is part of transaction
identity. The caller signs and sends the transfer. Namepass never receives caller wallet keys.
Initial availability is testnet-only. No account system, API keys, partner journal, outgoing
webhooks or transaction submission API is required by these pages.

## Architecture to evaluate

Build a small HTTP layer under `routes/api/v1/` around established application services. Keep
endpoint validation and response mapping separate from renewal execution. Public API requests
must not replace, modify or synchronously gate Goldsky ingestion and existing renewal Workflows.
Use explicit projections of established database columns; do not expand core table definitions
just to expose a new API response. No schema change is part of the first endpoint releases.

Quotes are bounded contract reads with no activation, database writes or transaction signing.
Address retrieval may activate a name through the existing service, as the docs require. History
and status are read-only. An unknown transaction returns a retryable 404; polling itself does not
create background jobs or start payment work. Resolve monitoring propagation/recovery through an
explicitly reviewed core-service requirement before claiming the quickstart is reliable.

Do not preselect a new queue, database trigger system or verification worker. First demonstrate
which facts the working backend supplies and which facts the API contract still needs. If durable
verification state is necessary, propose the smallest independent addition with its own schema,
resource budget, controls and rollout. It must remain outside the payment ingestion transaction.
That proposal is a later decision, not permission to implement it now.

## Evidence inventory before implementation

Produce a field-to-source table for each response, using actual core tables, contracts and RPC
receipts. Record unavailable fields and their documented null behavior. Inspect representative
direct Ethereum and cross-chain flows, multiple deposits in one transaction, pooled deposits,
split processing and native Arc funding. Confirm whether native transfer identity is represented
without importing the removed schema extension. Identify activation/watch propagation gaps.
For expiry, inventory every writer of `currentExpiry` and its timestamp together. A timestamp
column name or a recent update alone does not establish provenance for the returned value.

The hard requirement is truthful completion. A stored `settled` flag or an expiry increase alone
does not establish that a particular source payment completed. The proposed status mapping must
prove the deposit-to-processing-to-renewal relationship, source validity and renewal finality.
Show the complete relationship for every deposit and every applicable processing flow. Shared
renewal duration is reported as a shared result, never divided among deposits without evidence.

### Transaction deposit-set completeness

Before a transaction can be `complete`, prove that its relevant deposit set is closed, nonempty
and fully represented, then prove completion for every member. Define relevant USDC transfers
and supported deposit addresses independently of rows already delivered by the indexer. Include
watch/address-registry coverage and activation propagation in that proof.

Use enumeration from a canonical source receipt, or equivalent ingestion-completeness evidence
that accounts for every relevant transfer. Native Arc transfers require equivalent complete
source evidence; ERC-20 log enumeration alone is not sufficient for that route. Record the
source block/hash, deposit identities, coverage and applicable finality checks. An indexed count,
quiet period or first completed renewal does not establish completeness. Pending enumeration or
missing indexed members must prevent aggregate `complete`, even if every currently returned
deposit is individually complete. Provider failures follow the documented retryable error policy.

Change the published status wording from "all indexed deposits" to the proven full relevant set
in the contract review. Test two deposits in one transaction with staggered index delivery: the
first is finalized and renewed before the second arrives. The quickstart must keep polling until
both members are represented and complete. Also test a missing member, duplicate delivery,
coverage gaps and receipt corrections. No transaction-status release without this evidence.

### Exact renewal identity

Require `renewalId` in both `Renewal` and `HistoryItem` before implementing either response.
Define it from the renewal event's chain ID, normalized transaction hash and log index, with one
documented encoding. It identifies the canonical renewal event, not a source deposit, flow or
whole transaction. [Receipt segmentation](../server/indexed-renewal.ts) already uses log index to
distinguish renewals in the same transaction. Use the Namepass gateway's `Renewed` log as the
identity source in both responses; its associated ENS expiry log is supporting evidence.

The same event has the same identifier across status deposits, history entries and repeated
polls. Distinct renewal events in one transaction have distinct identifiers. Keep `flowId` as
processing provenance; it is not a renewal deduplication key. Document any multiple history rows
that refer to one event and how clients count its duration once. Test shared renewals across
deposits, two renewal events in one transaction, status/history agreement and invalidated events.
No response may expose a renewal without a proven event identity.

### Expiry value and timestamp provenance

The published history contract defines `expiryUpdatedAt` as a read timestamp. Preserve that
meaning unless a separate contract review explicitly changes it. Return a non-null timestamp
only when evidence pairs the accompanying expiry value with that read. Return `null` when the
read time is unknown, including when `currentExpiry` is null. Do not substitute an event block
time, projection update time, response time or independent last-read timestamp.

Do not map `names.ensSyncedAt` directly to `expiryUpdatedAt`: activation records a read time,
[ENS event projection](../server/goldsky.ts) incorporates event block times, and renewal aggregate
projection can change `currentExpiry` without changing that timestamp. Audit activation,
operational refresh, direct and cross-chain settlement, event projection and correction paths.
Test a read followed by a projected expiry change, late older events, correction rollback and
unknown timestamps. Each non-null timestamp must describe the returned value's supported read.

If a different observation-time meaning is preferred, document the source, units and correction
rules in the guide and OpenAPI before implementation. If reliable pairing needs stored metadata,
review that addition separately; do not silently add fields to the core schema. History remains
read-only. Any new RPC-read strategy also needs a capacity and timeout review.

Specify aggregate status for mixed deposits and define how corrections revoke previously reported
completion. An RPC outage must not become `failed`; insufficient funds remain pending. Archive
and finality capabilities are provider prerequisites, not assumptions based on local fixtures.
Until this source-payment model is proven, transaction status cannot report completion.
Name history has a different completion unit: one canonical gateway renewal and its matching
authoritative ENS event in a finalized hub block. It can prove that renewal happened without
claiming that every deposit in a source transaction was processed. This distinction follows the
published history contract and must be retained in status/history mapping. Public history still
requires its own hosted verification, capacity and exposure gates.

## Small implementation stages

1. **Baseline and interface review.** Record hosted schema and current core behavior. Confirm all
   response fields, pagination, error shapes, CORS and status precedence against the published
   OpenAPI. Resolve the three gates above in a reviewed documentation/OpenAPI change before
   endpoint implementation: full deposit-set completion, exact renewal identifiers and paired
   expiry freshness. Any other discrepancy also becomes an explicit documentation decision.
2. **Quote endpoint.** Implement fresh input validation and contract reads. Derive the active
   helper and allowance from the deployed contracts at a consistent block. Validate source route
   limits and the automation’s current Standard transfer policy (`bridgeFee: "0"`). No Circle fee
   lookup or future fee-pricing implementation is part of this stage. Fee-bearing transfers need
   a later policy and quote update. Check fee/duration arithmetic against independent contract
   examples, including discount boundaries, rounding and the maximum supported amount. Return
   unavailable pricing instead of a fallback rate. Deploy privately and verify JSON responses.
3. **Address endpoint.** Adapt existing normalization, address derivation and activation. Test
   concurrent repeated calls, unsupported names, ENS failures, watch registration and minimum
   amounts. Verify address equality on each returned chain. Only mark the subname verified after
   checking the resolver against the same deployment and full address. Validate anonymous abuse
   limits and capacity before opening activation publicly.
4. **History endpoint.** Add a read-only query with explicit columns and a stable time/identity
   cursor bound to the requested name. Test equal timestamps, late events, pagination changes,
   unknown names, paired expiry freshness and correction handling. Confirm renewal identifiers
   agree with status and distinct events in one transaction remain distinct. Verification status
   must verify the exact gateway/ENS receipt segment and hub finality. Source-deposit set and
   allocation proofs belong to transaction status; do not use a completed history item to infer
   source-transaction completion. Do not label ordinary indexed history finalized without evidence.
5. **Status endpoint.** Implement the proven deposit mapping with read-only polling. Test unknown
   hashes, source-chain separation, multiple transfer logs, pooled funds, split processing,
   existing wallet balances, below-minimum payments, native Arc, corrections and outages. Require
   the staggered-delivery test and evidence that the relevant deposit set is complete before the
   transaction becomes `complete`; verify shared renewal deduplication by event identity.
   Compare returned transaction hashes, amounts, duration and expiry with independent receipts.
6. **Hosted integration release.** Validate the exact deployed commit, JSON contract and all four
   routes without relying on the UI proxy. Exercise activation-to-indexing propagation, restart
   recovery, polling load, provider failures and low-value funding on each supported testnet.
   Wallet signatures remain user actions. Public availability requires all applicable gates.

Each stage is a separate reviewable change. Tests are written fresh around observable behavior,
not copied from the removed API suite. Keep the core renewal regression suite passing throughout.
A schema addition, if justified by the evidence inventory, gets a separate migration review and
rehearsal before the endpoint depending on it can be deployed.

## Deployment and rollback

Use an isolated backend staging environment with its own data, controlled indexer input and no
access to production transaction submission. Alpha remains a UI-only read proxy; it is not this
staging backend. Pin the staging and production verification to exact Git commits.

Validate the application against the actual target schema before merge, including populated
activity and name views. Ensure missing `/api/v1` paths cannot return the SPA with HTTP 200.
Check content type and response shape, not just deployment/build status. Also smoke-test existing
routes after each deployment; CI databases created from all repository migrations cannot detect
a deployed database that has not received those migrations.

Endpoint availability must be independently controllable and separate from renewal processing.
Document how a control change affects active deployments and requests; do not assume it stops
existing Workflow runs. Establish the last compatible deployment and practice rollback on
staging while retaining payment history. Prefer keeping a compatible additive schema during
application rollback. Never restore an old production snapshot over newer payment evidence.

Observe API errors, latency, database/RPC load and the existing renewal ingestion/processing
health against measured baseline limits. Stop rollout on failed core reads, dropped ingestion,
duplicate payment work, incorrect amounts or unsupported completion claims. Remove the public
docs' unavailable notices only after hosted evidence for the documented flow is recorded in
[DEPLOYMENTS.md](DEPLOYMENTS.md).

## Decisions still required

Stage 1 findings and proposed interface decisions are in
[PUBLIC_API_BASELINE.md](PUBLIC_API_BASELINE.md). The hosted schema and migration ledger are
recorded there and in [DEPLOYMENTS.md](DEPLOYMENTS.md). The contract review merged in PR #122.
PR #123 added the quote adapter; protected HTTP verification is recorded in the deployment
report. Sample receipt matches do not close status/history or activation release gates.

- Whether existing records can prove every documented completion case; required missing facts.
- The proof of transaction deposit-set completeness, including watch coverage and native Arc.
- Review the proposed `renewalId` encoding and prove status/history mapping, including shared rows.
- Prove paired expiry read provenance; review the null default and any separately proposed storage.
- Native Arc identity and recovery of deposits during initial watch propagation.
- Aggregate status precedence, source-chain finality rules and correction behavior.
- Quote public capacity and abuse controls; contract dependencies, RPC bounds and pricing
  boundaries passed the recorded quote-stage checks.
- Endpoint-specific exposure controls, abuse thresholds and staging provider configuration.

These are bounded discovery tasks. The reset neither enables an API nor performs hosted database
cleanup. Any removal of hosted objects requires a dependency review and a separate reviewed change.
