# Public API: fresh implementation plan

Date: 2026-10-05. Status: planning only. No endpoint or worker is implemented by this plan.

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
| [Status](content/status.md) | `GET /api/v1/status/{chainId}?transactionHash={hash}` | Every matching deposit is represented; pending, processing, complete and failed have documented meanings |
| [History](content/history.md) | `GET /api/v1/names/{name}/renewals` | Name-only results, recorded expiry and freshness, newest-first pagination, nullable unavailable fields |
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

The hard requirement is truthful completion. A stored `settled` flag or an expiry increase alone
does not establish that a particular source payment completed. The proposed status mapping must
prove the deposit-to-processing-to-renewal relationship, source validity and renewal finality.
Show the complete relationship for every deposit and every applicable processing flow. Shared
renewal duration is reported as a shared result, never divided among deposits without evidence.

Specify aggregate status for mixed deposits and define how corrections revoke previously reported
completion. An RPC outage must not become `failed`; insufficient funds remain pending. Archive
and finality capabilities are provider prerequisites, not assumptions based on local fixtures.
Until this model is proven, transaction status and complete history are not releasable.

## Small implementation stages

1. **Baseline and interface review.** Record hosted schema and current core behavior. Confirm all
   response fields, pagination, error shapes, CORS and status precedence against the published
   OpenAPI. Any discrepancy becomes an explicit documentation decision before code is written.
2. **Quote endpoint.** Implement fresh input validation and contract reads. Derive the active
   helper and allowance from the deployed contracts at a consistent block. Validate source route
   limits and bridge-fee assumptions. Check fee/duration arithmetic against independent contract
   examples, including discount boundaries, rounding and the maximum supported amount. Return
   unavailable pricing instead of a fallback rate. Deploy privately and verify JSON responses.
3. **Address endpoint.** Adapt existing normalization, address derivation and activation. Test
   concurrent repeated calls, unsupported names, ENS failures, watch registration and minimum
   amounts. Verify address equality on each returned chain. Only mark the subname verified after
   checking the resolver against the same deployment and full address. Validate anonymous abuse
   limits and capacity before opening activation publicly.
4. **History endpoint.** Add a read-only query with explicit columns and a stable time/identity
   cursor bound to the requested name. Test equal timestamps, late events, pagination changes,
   unknown names, recorded expiry freshness and correction handling. Verification status must
   use the proven model; do not label ordinary indexed history finalized without evidence.
5. **Status endpoint.** Implement the proven deposit mapping with read-only polling. Test unknown
   hashes, source-chain separation, multiple transfer logs, pooled funds, split processing,
   existing wallet balances, below-minimum payments, native Arc, corrections and outages.
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

- The actual hosted schema and migration ledger, including any leftovers from prior experiments.
- Whether existing records can prove every documented completion case; required missing facts.
- Native Arc identity and recovery of deposits during initial watch propagation.
- Aggregate status precedence, source-chain finality rules and correction behavior.
- Quote dependency availability, RPC budget and tested pricing boundaries.
- Endpoint-specific exposure controls, abuse thresholds and staging provider configuration.

These are bounded discovery tasks. The reset neither enables an API nor performs hosted database
cleanup. Any removal of hosted objects requires a dependency review and a separate reviewed change.
