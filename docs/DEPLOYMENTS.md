# Testnet deployments

## Public design preview — 2026-10-05

`https://alpha.namepass.com` is the stable Preview domain for
`codex/homepage-docs-design` in the Vercel project `namepass-v2`. It follows successful
deployments from that branch. A failed build does not replace the last ready preview.
It does not follow other branches or the production branch `main`.

The domain has an `alias-protection-override` Deployment Protection Exception. External
visitors can open alpha without a Vercel account or a share-link token. The generated
deployment URL remains protected. The production domain `beta.namepass.com` is unchanged.

Alpha uses the [read-only branch preview proxy](FRONTEND.md#read-only-branch-previews).
Anonymous verification returned HTTP 200 for the homepage and populated activity,
HTTP 405 for activation writes, and HTTP 403 for the private monitoring route.

## Current release — 2026-09-22

The replacement contracts and hosted testnet services are deployed. The application uses the
addresses below. The September 22 cutover cleared the previous application's data; old deposit
addresses are not part of the current release.

| Contract | Address | Network |
| --- | --- | --- |
| Factory | `0x2dCB5CA6b21372b43e37C35Da8D5D15160423150` | All four testnets |
| Gateway | `0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f` | Ethereum Sepolia |
| Helper pointer | `0x774f942194d612e126A05Ce40a3A4D88AfBB6ae6` | Ethereum Sepolia |
| Initial helper | `0x7Bfee7c257ff48f8D787A61F15925e24743C8F88` | Ethereum Sepolia |
| Test timelock | `0x996cbd179f361B1043Ad1999864eD41496C633c8` | Ethereum Sepolia |

The test timelock is wallet-controlled with a 60-second delay. It is not the ENS DAO timelock.
The active helper can change through the pointer; read `currentHelper()` for live selection.

| Network | Chain ID | Factory deployment block |
| --- | --- | --- |
| Ethereum Sepolia | 11155111 | 11754050 |
| Base Sepolia | 84532 | 47132212 |
| Arbitrum Sepolia | 421614 | 311365500 |
| Arc Testnet | 5042002 | 63326249 |

Token addresses, Circle domains, RPC configuration names and explorer links are maintained in
[`src/lib/chains.ts`](../src/lib/chains.ts). Exact deployment parameters and hashes are in the
[manifest](deployments/2026-09-22/manifest.json).

## Verification evidence

| Record | What it establishes |
| --- | --- |
| [Deployment verification](deployments/2026-09-22/verification.json) | Replacement transaction receipts, runtime and configuration checks |
| [Source verification](deployments/2026-09-22/source-verification.json) | Published source and deployed bytecode matches |
| [Canary inputs](deployments/2026-09-22/canaries.json) and [verification](deployments/2026-09-22/canary-verification.json) | Direct Sepolia renewal and two native Arc deposit/claim rounds, including funding after wallet deployment |
| [Application preflight](deployments/2026-09-22/system-preflight.json) | Helper compatibility, address derivation and receipt enrichment |
| [Indexed cutover results](deployments/2026-09-22/system-cutover.json) | Three renewals projected into the replacement application |

These records are point-in-time evidence, not a security audit. A fresh automated deposit on
every source chain was not repeated after the reset. Older evidence must not be presented as a
new-generation live test.

## Resolver and mainnet limits

The replacement `namepass.eth` wildcard resolver is live, and its subnames appear in Name View.
This September 22 release record does not contain its mainnet deployment and parent-record
transaction receipts. The configured testing use case resolves to testnet deposit addresses even
though the parent ENS record is on Ethereum mainnet. That does not enable mainnet USDC funding or
mainnet renewal contracts.

No audited mainnet protocol release is recorded. Ethereum, Base, Arbitrum, and Arc are planned for
the initial mainnet release; none has a recorded Namepass mainnet deployment. Requirements are in
[RUNBOOK.md](RUNBOOK.md#mainnet-release-requirements).

## Public API reset — 2026-10-05

The homepage/docs branch merged in `a6f2fee` and deployed to the production domain. The
post-deployment activity check returned HTTP 500. Runtime logs show the activity SELECT includes
`chain_events.evidence_kind` and `deposits.transfer_kind`, fields introduced by the retired API
schema extension. This is a schema compatibility failure requiring a corrective release.

The reset removes the previous API implementation, tests, worker, unreleased migration and plan.
Core schema, ingestion, receipt-expiry and recovery code return to their pre-API versions. The
public docs and OpenAPI remain proposed interface requirements. The fresh plan is
[PUBLIC_API_PLAN.md](PUBLIC_API_PLAN.md). No new public API is implemented by the reset.

The incident is resolved by PR #120, commit
`8dc9165fb2827e1b064c249b36f1de0945d361ed`, production deployment
`dpl_3fZ8uDQAzvtziExDxNh72usoswPt`. The previously working production backend came from the
unmerged recovery branch at `d5999385c136c2b38dbfda8c991a63dcdbbd659b`; main did not contain
that recovery when the homepage branch merged. The reset restores that schema-compatible
backend while retaining the UI and proposed docs. No hosted migration or data deletion was used.

## Public API baseline — 2026-10-05

PR #121 merged the reviewed plan at `69f7142eace03d086ecb512dd66b7960929535a4`.
Production deployment `dpl_8WMVzvmkbVrQDennAwVWCcyXYKmT` is READY with that exact commit.
Both `beta.namepass.com` and the Goldsky webhook host `demo-five-gray-37.vercel.app` are its
aliases. This deployment contains the plan, not public API endpoint implementations.

Read-only discovery on the Neon `testnet` branch, `br-noisy-bird-avey45an`, found all nine
committed migration hashes/timestamps and all 134 application columns compatible by type and
nullability. The separate Neon branch named `production` has no public tables. Two distinct
flow/event/transaction identities match the live beta activity to the inspected testnet data;
the sensitive production database credential was not disclosed or directly compared.

At 14:49 UTC, populated activity and two name-activity routes, statistics, leaderboard,
public configuration and OpenAPI returned JSON with HTTP 200. Activity contained ten renewals.
Docs returned HTML with HTTP 200; alpha's activity proxy also returned HTTP 200. This verifies
the schema-related read recovery, not a fresh end-to-end payment canary. Missing proposed
status/history endpoints still return SPA HTML with HTTP 200 and must not be treated as APIs.

The [baseline report](PUBLIC_API_BASELINE.md) and
[bounded evidence receipt](deployments/2026-10-05/public-api-baseline.json) record database,
pipeline, deployed contract reads and historical receipt matches. No new contract deployment,
hosted data mutation, API flag or wallet transaction was performed during this discovery.

## Quote adapter verification — 2026-10-05

The fresh `POST /api/v1/quote` adapter uses gateway `GAS_ALLOWANCE()` and `quote()`
reads at one Sepolia block. It uses Namepass automation's Standard transfer policy,
with `bridgeFee: "0"`. It does not query Circle for fees, estimate transaction gas,
activate names, access the database or submit transactions. Future fee-bearing
transfers require a separate policy and quote update.

[Read-only verification](deployments/2026-10-05/public-api-quotes.json) ran the local
adapter against deployed contracts on all four supported testnets. Eleven successful
quotes matched independent ENS forward prices at the returned blocks, including
amounts just below and above the 2-, 3- and 6-year discount boundaries. A cross-chain
amount above the live per-message burn limit returned `422` with `maximumAmount`.
This verifies contract reads, not a hosted API release or a new payment canary.

The route is off unless `NAMEPASS_PUBLIC_QUOTE_ENABLED=1`. Its preview route executes
its own adapter instead of proxying beta; other preview write restrictions stay in
place. No hosted flag, RPC setting, migration or production deployment changed during
this verification. Protected hosted verification is still required before release.
The 10-second deadline, 24-method RPC ceiling and two-request limit per warm process
bound local work. The process limit is not a distributed public rate limit; public
exposure needs deployment-level capacity controls.

## Quote adapter release and protected tests — 2026-10-05

PR #123 merged at `9b314c0cc1ebc73d5375b8e60b5ebb4a68d778b2` after required CI
and preview checks passed. Production deployment `dpl_BXeMfD5roGjEhzn3zNgLDURa32Pp`
is READY and serves beta plus the existing Goldsky webhook alias. The shared footer
uses forest charcoal `#20332B`, with white Product/Legal headings at weight 700.

[Hosted evidence](deployments/2026-10-05/public-api-quote-release.json) records populated
production activity (ten rows), statistics, configuration, docs and OpenAPI responses.
Production quotes remain disabled: POST returns JSON `503 api_unavailable`, OPTIONS
returns `204`, and GET returns `405`, with CORS and `no-store` headers.

The protected quote branch preview is `dpl_4fkfhgY1Vo2uCX11dhUoLxcPbbvS`, built
from PR head `52578f8319474d85965353f893af55859ac033ec`. Only that Preview branch,
`codex/public-api-quote`, has the four read-only RPC settings and quote enable flag.
No database, signing key or indexer input was configured for this quote-only test.
No production environment setting, public domain or deployment-protection rule changed.

Sixteen hosted HTTP checks passed: ten valid quotes across four testnets and the three
discount boundaries; above-limit and below-minimum amounts; invalid names and chains;
preflight and method rejection. Amounts preserve the exact USDC accounting identity.
Earlier independent forward-price checks remain in the read-only quote receipt above.
These are quote tests, not funding or renewal canaries. Address, history and transaction
status remain unimplemented. Public quote exposure still needs deployment-level abuse
and capacity controls; the per-process concurrency limit is not a global rate limit.

## Address adapter staging — 2026-10-05

The private `POST /api/v1/address` adapter reuses existing name activation. Its default is off;
production has no address enable flag. PR #124 merged the quote release records at
`b428f02e1f47dccfbd4c6b1bf73435df587dd570`, deployment `dpl_GLm3mEJqvPyjeoumgZZEkGXodcsV`.
Production activity remained populated and quotes remained disabled after that merge.

With explicit approval, a schema-only Neon branch `api-staging`, `br-autumn-cherry-av2es7od`,
was created in project `nameless-paper-91018372`. Its schema matched all 134 application columns
from migrations 0000–0008, and all 11 tables started empty. Its copied migration-ledger table
is empty because schema-only creation copies no rows; do not replay migrations over this snapshot.
A dedicated `api_staging` role is used only by Preview branch `codex/public-api-address`.
Compute is fixed at 0.25 CU and suspends when idle. No live payment data was copied or changed.

That preview alone has the staging database, four existing read RPC settings and
`NAMEPASS_PUBLIC_ADDRESS_ENABLED=1`. It has no signing credential, operational secret or
attached indexer. Deployment protection is unchanged; anonymous POST returned 401.
Staging connection settings bound statements to 5000 ms, locks to 1500 ms and idle transactions
to 10000 ms. Secrets were passed in memory and never written to receipts or repository files.

Protected deployment `dpl_Hgb5L9xLJP88RniLT9GU5xgxvCF3`, code
`55a22ed1031390efd0e1fdcb2795582e18d42f2b`, passed eleven hosted HTTP checks. Real activation
of `steve` and `vitalik` produced two name rows, two watch rows and eight zero balance snapshots.
Concurrent/repeated requests returned the same full address; an unrenewable name returned 422
without a row. No flows, indexed events, deposits or transaction intents were created.
CI run `37361709975` passed against this code. Twelve earlier `predictWallet` reads matched
local derivation across all four deployed factories.

An isolated staging row lock returned sanitized `503 activation_unavailable` with a retry delay.
After rollback released the lock, the same request returned 200. The
[lock recovery receipt](deployments/2026-10-05/public-api-address-lock.json) records both results.
Unimplemented `/api/v1` routes now return JSON 404 instead of the SPA's HTML 200 fallback.
Focused HTTP tests and the compiled Nitro server verified this boundary; UI routes pass through.

[Staging evidence](deployments/2026-10-05/public-api-address-staging.json) and the
[address adapter report](PUBLIC_API_ADDRESS.md) record the scope and results. This is not a
payment canary or proof of watch propagation. Actual indexer coverage/recovery, resolver
verification and public abuse controls remain release gates. `subnameVerified` stays false;
use the full address. No production API is opened by merging the adapter.

## History adapter review — 2026-10-05

The history stage is under review in [PUBLIC_API_HISTORY.md](PUBLIC_API_HISTORY.md).
Its local adapter passed enforced read-only checks against ten existing renewals across seven
names, including direct and Arc-funded results. This does not enable a hosted endpoint or
establish finality; all items remain `processing`. No live data or configuration changed.

## Historical evidence

The [September 18 manifest](deployments/2026-09-18/manifest.json) and accompanying receipts are
retained for contract provenance and test fixtures. That factory is superseded: it rejected native
Arc funding after wallet deployment. Its helper-replacement rehearsal and canaries apply to that
older generation. Do not derive current deposit addresses from it.
