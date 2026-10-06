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

## October ENS helper rotation and API canary — 2026-10-06

The active Sepolia helper is `0x33CDD1f7Ea4dd6e2469EF0F8B9e982F5ad365f31`.
The user deployed it, scheduled the existing timelock and signed activation. It uses
ETHRegistrar `0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3` and ETHRenewerV1
`0xf2ece44980778966b8a0FccB3A9E339440f6e045`. Factory, gateway, pointer, deposit
addresses, allowance and compiler settings did not change. The initial helper below
is a historical deployment address.

The old V1 renewer lost BaseRegistrar controller permission on October 1 at
11:53:48 UTC. Its read-only quote and `isRenewable` still worked, but execution
reverted. A disposable fork at the funded payment's block reproduced that failure,
rotated the helper through the real timelock and successfully renewed the same wallet.
The [rotation and canary receipt](deployments/2026-10-06/ens-october-api-canary.json)
records the exact user-signed transactions and checks.

Production automation resumed the preserved `farcaster.eth` flow. Its $0.50 deposit
produced renewal transaction `0xb47311d40dc75d0d2253521fd8e3b0dd8a206b9034694a6d6a0d28701186e99e`,
with 1,576,795 seconds added, a $0.10 allowance and $0.40 applied. Current expiry is
March 26, 2032 at 03:32:32 UTC. Local execution of the actual status and history HTTP
adapters verified finalized receipts and the same event-specific renewal identifier.
Status used 45 RPC reads in 7.834 seconds; history used nine in 1.941 seconds. These
are local adapter measurements, not hosted capacity evidence.

The user directed deletion of obsolete testnet history. The guarded
[cleanup SQL](deployments/2026-10-06/obsolete-testnet-history-cleanup.sql) passed a
rollback rehearsal, then removed 12 terminal flows, 13 confirmed old intents,
65 transitions, seven deposits and 43 old events. Four unchanged cached expiry
observations were cleared; fresher observations were preserved. Aggregates were
recomputed from remaining canonical renewals. Verification found one settled
`farcaster` flow and no pre-canary events. Names, watched addresses, balance snapshots,
nonce counters and pipeline checkpoints were preserved. A private local backup was
saved; raw transaction data is not committed.

Protected preview `dpl_9wE7sSRU7WTTN6HhojgzfzyfWwXW`, commit
`4da8af636af2e3cf9334b7e1c2adc499ffe81ba1`, passed 14 HTTP checks. Status returned
`complete`; history agreed on the exact renewal ID, duration and expiry. Both passed
the published OpenAPI schema. Two simultaneous status reads also returned the same
verified result. Anonymous GET/POST requests redirected to Vercel authentication.
All staging data and reader privileges matched the pre-request fingerprint. Quote
and address stayed disabled. Live activity remained populated and all four production
API flags remained off. CI passed all 221 server tests against PostgreSQL 18, with no
server test skips. These checks do not establish distributed polling capacity.

PR #138 merged as `0c6d427ac33786d72ce078802f640e1ebb5136cf`. Production
deployment `dpl_E8zJijUQpnrZbzcxNutd1MnHyUJa` is READY at that exact commit.
The [post-merge smoke record](deployments/2026-10-06/ens-october-api-release.json)
contains 21 passing checks: populated live activity, existing pages and all four
public APIs still disabled.

Isolated `api-staging` now contains the minimal fresh `farcaster` projection instead
of the five copied obsolete payments. The existing SELECT-only reader and eight
balance snapshots are unchanged. Public production APIs remain disabled. The older
seven-payment and five-payment reports are historical checks of the previous ENS
configuration; they do not verify the current helper. First-watch propagation,
other source routes, aggregate funding and public polling capacity remain gates.

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

## Private history staging — 2026-10-05

The private history stage is described in [PUBLIC_API_HISTORY.md](PUBLIC_API_HISTORY.md).
Its local adapter passed enforced read-only checks against ten existing renewals across seven
names, including direct and Arc-funded results. This local evidence does not establish
finality. Those reads did not change live data or configuration.

Protected Preview branch `codex/public-api-history` now uses the existing isolated Neon
`api-staging` branch through `api_history_reader`. This role can select only `names`,
`chain_events` and `flows`; it has no table write or database/schema creation privileges.
Only this preview branch received its database setting, existing Sepolia RPC setting and
`NAMEPASS_PUBLIC_HISTORY_ENABLED=1`. Production API flags remain absent.

At code commit `d99fd9565fc05464c7919dc25ddda9196e3ed10b`, deployment
`dpl_8ZPQJ54BAHLJK2sSVDZCWPNhkx3v` passed 15 hosted HTTP checks and four HTML page checks.
Activated names returned empty history, input errors returned 400, unknown names returned 404,
and UI activity remained populated through its existing proxy. Anonymous requests still
redirected to Vercel SSO. Staging retained two names, two watches and eight zero balance
snapshots; payment tables remained empty. Full CI passed, including the real PostgreSQL
read-only connection test. [Staging evidence](deployments/2026-10-05/public-api-history-staging.json)
records the tested deployment and implementation checksums.

This staging branch has no indexed payment events or indexer. Hosted receipt verification,
finality and the complete payment mapping remain unproven. The private adapter temporarily
returns `processing` for every history item, including existing completed renewals. This is
an API verification limitation, not a change to stored payment state or the explorer. It must
not be used as a public completion indicator.

PR #126 merged at `d606d5ef08e811b53db095700861ecc39eaebf53` after final-head CI passed
(run `37370139995`, attempt 2). Production deployment `dpl_CJf74kbui2oJbc8EEYnsRc8Eq5Ah`
was verified READY at that commit. Both `beta.namepass.com` and the ingestion hostname pointed
to it. Eighteen production HTTP checks passed, including populated activity and disabled
quote/address/history responses. Production API flags remain absent.

## Private history event completion — 2026-10-05

The merged history adapter verifies the ENS event and finalized hub block for each history item.
It distinguishes completed renewal events from source-transaction completion; the latter still
requires full deposit-set and processing proof. Details and provider limits are in
[PUBLIC_API_HISTORY.md](PUBLIC_API_HISTORY.md#renewal-completion-and-source-payment-completion).

Read-only local execution against existing records verified ten renewals across seven names,
including direct and Arc-funded results. Every item had a matching event-specific ENS expiry
and a canonical renewal below Sepolia's finalized head. Seven database sessions were independently
checked read-only. Single-item responses used eight RPC calls; the four-item response used 26.
Responses took 0.7–1.7 seconds. [Completion evidence](deployments/2026-10-05/public-api-history-completion.json)
records the exact local implementation checksums. This is not hosted verification or a new
payment canary. No data, production API flag, indexer or signing configuration changed.

Protected preview `dpl_2PjgbbCmzLvRmYymKYmEXydDZCPG` at implementation commit
`4b8dc80c6b7e17d74d9dd4c91899ea4faf2b98c5` passed fifteen API checks and four HTML
route checks. Anonymous history GET/POST both redirected to Vercel SSO. The existing three
isolated history settings moved by branch scope only; their stored values were preserved.
Staging counts and all zero balances remained unchanged.
[Staging evidence](deployments/2026-10-05/public-api-history-completion-staging.json)
records schema validation with date formats and the exact implementation checksums. The
isolated branch has no payment events, so hosted positive receipt verification remains unproven.

PR #127 merged at `b6c62f9b82e2580aa1e3211816a1f0505d9d1d98` after final-head CI
(run `37378773800`) and protected preview checks passed. Exact production deployment
`dpl_FkFHUPsESGSQhaCxegbGk6D4E74t` was verified READY. Both public and ingestion
aliases pointed to it; eighteen HTTP checks passed with populated activity and disabled APIs.
[Production evidence](deployments/2026-10-05/public-api-history-completion-production.json)
records those checks. No production API enable flag is present.

## Source-deposit evidence — 2026-10-05

The new bounded inspector verifies source receipts against the current activated-name registry
and indexed deposits. It is a local read-only discovery tool, not a status endpoint. Seven
existing source transactions matched: six top-level native Arc deposits and one Sepolia
ERC-20 deposit. Each invocation used four RPC reads and an independently verified read-only
PostgreSQL transaction.
[Source evidence](deployments/2026-10-05/public-api-deposit-evidence.json) records exact
implementation checksums, canonical source identities and matching indexed members.

Staggered-delivery and internal native-transfer fixtures expose missing members independently
of rows already delivered by the indexer. Current registry/watch membership does not prove
historical propagation or coverage of unregistered deterministic addresses. Source finality,
allocation and aggregate completion remain unproven. Details are in
[PUBLIC_API_DEPOSIT_EVIDENCE.md](PUBLIC_API_DEPOSIT_EVIDENCE.md). No hosted configuration,
Goldsky pipeline, schema, signer, processing behavior or public exposure changed.

## Deposit-to-renewal discovery — 2026-10-05

Seven indexed payments have matching source credit, processing debit and zero boundary balances
in bounded wallet-history samples. Nine of ten settled flows have matching exact origin receipts;
eight Arc paths also match Circle's ordered source message response and the exact hub claim and
renewal segment. One external direct renewal lacks stored origin provenance. Three settled flows
have no indexed deposit link. These results do not make those flows source-transaction proofs.

[Allocation evidence](deployments/2026-10-05/public-api-allocation-evidence.json) and
[allocation review](PUBLIC_API_ALLOCATION.md) record the read-only discovery and its limits.
Pooling, splitting, same-block ordering, source coverage, route finality and HTTP capacity remain
gates. This stage changes no endpoint, hosted configuration, schema, pipeline or payment behavior.

## Source inspector release and allocation operator — 2026-10-06

PR #128 merged at `31d1255952fb69bfb0380019822649de29aeafe1`. Its exact production deployment,
`dpl_5Pk4SSNyXdDqw7NNabkgVRCLyPZm`, is ready. Both the site and ingestion aliases point to that
deployment. Eighteen HTTP checks passed with populated activity, docs/legal routes and disabled
public APIs. Quote, address and history enable flags remain absent.
[Release evidence](deployments/2026-10-06/public-api-source-production.json) records the checks.

PR #129 merged at `fa00a1cb8f333888754a1a78f07326ae2f99b697`; production deployment
`dpl_AUox74HVpPkAgJNv7mCoPKUSS2c9` is ready. Both site and ingestion aliases point to that
exact commit. Eighteen HTTP checks passed with populated activity and disabled public APIs;
the quote/address/history enable flags remain absent.
[Release evidence](deployments/2026-10-06/public-api-allocation-production.json) records the checks.
Full CI passed all 193 server tests, including the real PostgreSQL source inspector.

Six existing simple wallet windows closed with 14 read-only RPC calls each; a long-delay payment stayed open within the
2,048-block limit. [Operator evidence](deployments/2026-10-06/public-api-allocation-operator.json)
pins the inspected files. Pooled/split cases passed independent receipt fixtures, including the
actual CLI transport boundary; no new wallet funding or hosted mutation occurred.
See [allocation review](PUBLIC_API_ALLOCATION.md#bounded-source-to-processing-verifier--2026-10-06)
for the remaining long-window, claim/finality and coverage gates. There is no public status route.

## Processing-to-renewal operator verification — 2026-10-06

The new read-only operator verified nine existing processing calls against exact gateway/ENS
receipt segments and provider finality anchors. Eight Arc claims use the exact Circle message
index/nonce; one direct Sepolia call shares its processing receipt with the renewal. Cross-chain
inspection used 19 RPC reads for V2 names or 20 for V1 names and one public Circle request;
direct inspection used 13 RPC reads.
[Operator evidence](deployments/2026-10-06/public-api-processing-renewal-operator.json) pins
the inspected implementation. No wallet funding, database write or hosted configuration changed.

[Verification scope](PUBLIC_API_RENEWAL_EVIDENCE.md) distinguishes these individual joins from
full source-payment completion. Coverage, long allocation windows, source-route finality and
hosted integration/capacity remain release gates. There is still no transaction-status endpoint.

PR #130 merged as `ceb378a4a35323eba315344371ebf9b0c72ef68c`. Its exact production
deployment `dpl_4rnpbSEeuZVJrBAxUmy96Rz748Di` is READY. Both site and ingestion aliases
resolve to it. All 206 server tests passed without skips; the protected preview passed eight
API and four page checks. Eighteen production HTTP checks passed with populated activity,
correct V1 dates and an unchanged V2 control. Public API flags remain off. See the
[production evidence](deployments/2026-10-06/public-api-processing-production.json).

## Delayed allocation operator audit — 2026-10-06

The optional extended read-only allocation mode verified the existing `paramore.eth` payment
through its full 17,097-block source-to-processing span. One three-USDC source credit matches
one exact processing call and a zero closing wallet balance. Eighty RPC reads took about
15.2 seconds, including CLI startup. The default short inspection budget is unchanged.
[Operator evidence](deployments/2026-10-06/public-api-long-allocation-operator.json) pins the
implementation; [bounds and remaining gates](PUBLIC_API_ALLOCATION.md) define its limited scope.
No database, funding, ingestion, contract, API flag or production deployment changed for this audit.

PR #132 merged as `95be3319e9cbe1d48d3b6563bf88855a2a95bcea`. Its exact production
deployment `dpl_8tJbA55sfHgAj1wR5Fesc9grQy95` is READY. Both site and ingestion aliases
resolve to it. All 208 server tests passed without skips. Eighteen post-merge HTTP checks
passed with populated activity and unchanged public API gates. See the
[production verification](deployments/2026-10-06/public-api-long-allocation-production.json).

## Source receipt closure and finality — 2026-10-06

The read-only source inspector now distinguishes current-registry representation from a
conservatively closed receipt set. An unregistered USDC recipient prevents closure. Source
finality separately uses the configured provider's numbered `finalized` anchor and rechecks
both block identities. No source/API completion is inferred from indexed status alone.

All four configured testnet providers passed the bounded
[finality capability audit](deployments/2026-10-06/public-api-source-finality-capabilities.json).
The actual updated CLI verified seven existing deposits with read-only database sessions and
49 RPC reads: each receipt set is closed and each source block is provider-finalized. The
[operator evidence](deployments/2026-10-06/public-api-source-finality-operator.json) pins the
implementation. [Policy and limits](PUBLIC_API_DEPOSIT_EVIDENCE.md) preserve unknown-recipient,
historical propagation, hosted canary and aggregate completion gates. No hosted writes,
funding, contract changes or public API flags were involved.

PR #133 merged as `64209bd31f8e05f5a7fbd241a3c33fd7ae50dd2a`. Production deployment
`dpl_Hu4cpBSQKSXiR7QGx3k3oREpcxxp` is READY; both site and ingestion aliases are confirmed.
All 211 server tests passed without skips. Eighteen post-merge HTTP checks passed with populated
activity and unchanged public API gates. See the
[production verification](deployments/2026-10-06/public-api-source-finality-production.json).

## Combined transaction evidence — 2026-10-06

The new private operator runs the existing source, allocation and renewal inspectors together.
It joins exact source credits to processing calls and whole event-specific renewal results.
It then repeats the source/index inspection and rechecks every retained block identity before
printing a result. Open source sets, missing slices or unfinalized renewals stay incomplete;
provider failures and corrections emit sanitized unavailability.

The actual CLI verified seven existing single-deposit payments with read-only database sessions:
six Arc-to-Sepolia payments and one direct Sepolia payment. All seven evidence sets passed,
including the delayed payment. The audit used 432 RPC reads and six Circle message responses.
[Operator evidence](deployments/2026-10-06/public-api-transaction-operator.json) pins the implementation.
The delayed sample used 119 RPC reads and approximately 21.7 seconds including startup. This is
private operator evidence; it does not establish a public polling budget or hosted capacity.
[Interface and remaining gates](PUBLIC_API_TRANSACTION_EVIDENCE.md) keep status disabled.
No hosted writes, new funding, schema, pipeline, Workflow, contract or API setting changed.

PR #134 merged as `72f91231e9d35781aa992988ee50e722b2a3b13c`. Production deployment
`dpl_7ok556BSJ92k6LSpy5ZUZ6NFWzG5` is READY; both site and ingestion aliases resolve to it.
Required CI passed all 215 server tests without skips. Eighteen post-merge HTTP checks passed
with populated activity and unchanged API gates. See the
[production verification](deployments/2026-10-06/public-api-transaction-production.json).

## Private transaction status adapter — 2026-10-06

A bounded HTTP adapter now discovers candidate identities from existing indexed events and runs
the approved source/allocation/renewal proof. Its flag is off by default. Canonical finalized
reverted source receipts can return failed; index or provider failure cannot. Second snapshots
and final block rechecks protect completion from corrections. No hosted setting, schema,
ingestion, Workflow or contract changes are included.

The actual local HTTP adapter verified seven existing payments with two read-only database
snapshots per request, 44–61 RPC reads, 0–1 Circle responses and approximately 5–14 seconds.
The delayed payment passed with 61 reads using larger gap-free allocation chunks. See the
[HTTP evidence](deployments/2026-10-06/public-api-status-reads.json) and
[adapter limits and remaining gates](PUBLIC_API_STATUS.md).
This does not establish hosted enabled-route capacity or new-payment canaries. Public APIs
remain disabled. Known status URLs now have an off-by-default JSON 503 route, replacing their
previous absent-route 404; OPTIONS and method handling execute locally in preview as well.

PR #135 merged as `6b8c6c4657e03be7aaed3a842aede2b5660ce5a2`. Production deployment
`dpl_3etZBZBRxDhobQhxwTVZW7CUUDyU` is READY; both site and ingestion aliases resolve to it.
Required CI passed all 220 server tests without failures or skips. Twenty-one post-merge HTTP
checks passed, including populated activity, site/docs/legal pages, disabled API responses,
status preflight/method handling and unknown-subpath JSON 404. See the
[production verification](deployments/2026-10-06/public-api-status-production.json).
Public API flags remain off. This verifies the disabled production boundary, not enabled-route
capacity or new-payment completion.

## Protected status and history replay — 2026-10-06

The user approved an insert-only copy of minimal projections for `chrismg.eth`, `nick.eth`,
`paramore.eth`, `slobo.eth` and `gregskril.eth` into isolated Neon `api-staging`. Five names,
five deposits, five existing flow projections, fifteen public event projections and five watches
were added atomically. The two existing names, their watches and all eight balances stayed intact.
No transaction intent or new payment work was created. Production was read-only throughout.

The new `api_status_reader` role has SELECT access to names, chain events, flows, deposits and
watched addresses. It defaults to read-only transactions and has no table-write or durable DDL
privileges. Seven encrypted variables enable only status/history and their read dependencies on
`codex/public-api-status-staging`. Quote/address stay disabled. Production settings, SSO protection
and public custom-domain assignments are unchanged. No indexer, Workflow or signer is attached.

Deployment `dpl_AfczvwRHYv9Wtu8f1V9pVzjiCcLK` is READY for evidence commit
`6dd8299538644d5d849357a8ffe106497b3d3977`. All five status requests returned `complete`.
Their history results have the same exact renewal identifiers, durations and registration expiry;
unknown expiry read timestamps remain null. Twenty-five API checks passed, including validation,
methods, CORS, disabled quote/address routes and source-chain namespace isolation. Two simultaneous
status reads returned the same verified result. Four site/docs/legal checks passed; two anonymous
requests still redirected to Vercel SSO. All 33 checks passed. The five status times were 5.8–8.3
seconds including CLI authentication/startup, rather than pure server latency.

A final SELECT-only audit confirmed unchanged existing rows, copied fields and counts after all
probes. The twenty-one production boundary checks also passed again after staging configuration,
with populated activity and all public APIs disabled. The
[staging receipt](deployments/2026-10-06/public-api-status-staging.json) pins the runtime checksums,
fixture manifest hash, grants, deployment, response comparisons and database invariants.

This is replay of existing single-deposit Arc-to-Sepolia payments. Positive hosted direct Sepolia,
Base/Arbitrum source payments, live pooled/split/multiple-deposit cases, fresh funding,
activation/watch/index propagation, restart recovery and sustained/distributed capacity remain
open gates. The two-read probe is not a public load test. No public API enablement is approved.

PR #136 merged as `1aebd659aaf95c06ed1939f3a89b53a223b37461`. Its exact production deployment,
`dpl_HLtTbRGWjFcy4jjUBgYp4aJXqb2s`, is READY; both site and ingestion aliases resolve to it.
All twenty-one post-merge HTTP checks passed with populated activity and disabled public APIs.
The merged PR passed required CI with 220 server tests, zero failures and zero skips. See the
[release receipt](deployments/2026-10-06/public-api-status-staging-production.json).

## Activation and watch rehearsal — 2026-10-06

The local rehearsal now exercises actual address, webhook and status handlers with the migrated
SQL store. An early delivery rolls back and retries after registration; duplicate deliveries
retain one deposit and one queued flow. Withheld source indexing remains retryable 404, and
index delivery alone returns processing rather than completion. Read-only discovery confirms the
production Goldsky pipeline is ACTIVE. The proposed additional pipeline was never deployed
and its configuration has been removed because the current plan does not allow another pipeline.
Read-only inspection and any user-signed delivery canary must use the existing pipeline.
An already-watched name cannot prove first-watch propagation or restart recovery.
[Discovery receipt](deployments/2026-10-06/public-api-activation-rehearsal.json) records the
runtime fingerprint, plan limit and renewable canary target.
[Scope and proposed hosted procedure](PUBLIC_API_ACTIVATION_REHEARSAL.md) distinguish this local
boundary from stream propagation, payment completion and public capacity. No hosted setting,
schema, production pipeline, wallet transaction or API flag changed for this rehearsal.

PR #137 merged as `aca8456d60e750fda1874371a74ac29c9663662c` after required CI passed
with 221 server tests, zero failures and zero skips. Its production deployment
`dpl_Ds2DQB2uzoc181Wm1VEfUwgLP38s` is READY. Both site and ingestion aliases resolve to it;
all twenty-one production HTTP checks passed with populated activity and disabled public APIs.
A fifteen-second read-only inspection probe left the existing pipeline ACTIVE with unchanged
runtime and definition. The original staging rows and counts are unchanged. No additional
pipeline, reader, secret, watch or payment was created. This probe does not establish new-watch
visibility or restart recovery. See the
[release and observation receipt](deployments/2026-10-06/public-api-activation-production.json).

## ENS V1 expiry correction — 2026-10-06

The deployed helper reads the V2 registry for both renewal routes. Unmigrated V1 reservations
have a later reservation expiry; that date must not be presented as V1 registration expiry.
Read-only Sepolia discovery confirmed a 90-day V1 grace period, a 28-day V2 grace period, and
an exact 62-day reservation offset in the current deployment. See the
[public RPC fixture](../test/fixtures/ens-expiry/sepolia.json) and
[official ENS migration documentation](https://docs.ens.domains/ensv2/migration/).

The backend correction discovers the V1 BaseRegistrar through `ETHRenewerV1.BASE_REGISTRAR()`
at the read or receipt block. Current state uses `nameExpires(labelHash)` for V1. Receipt
expiry uses the preceding V1 registration event. V2 registration expiry stays unchanged.
Gateway and standalone ENS webhook events are enriched before their expiry projections are
stored. The proposed history reader also uses the corrected receipt semantics.
No helper, pointer, pricing, migration, signer, or funding change is needed.

The [SELECT-only audit](deployments/2026-10-06/ens-expiry-audit.json) checked eleven names,
ten canonical renewal events and ten linked flows. Five name dates, four event expiry facts,
and four flow expiry dates required correction. The
[bounded repair](deployments/2026-10-06/ens-expiry-repair.sql) changes only these date fields
and the paired name read timestamps. It compares the audited values, accepts already corrected
rows, and aborts the entire transaction if evidence is stale. After separate user authorization,
the repair was applied at 11:20 UTC. Before/after assertions verified all thirteen corrections
and unchanged unrelated names, event facts, flow statuses, amounts and durations. See the
[applied repair record](deployments/2026-10-06/ens-expiry-repair-applied.json).

PR #131 was merged as `ce235c5f858398247537b7c96c82476fe7e287fb`. Production deployment
`dpl_FVVwwYsfWSZEqGZaZYHGtdT4hAqh` is READY for that commit. Both the site and ingestion
aliases resolve to it. Eighteen HTTP checks passed with populated activity and unchanged API
gates. Live name responses show all five corrected V1 dates; four historical renewal dates
match the repair. The V2 control name retains its prior expiry. See the
[production verification](deployments/2026-10-06/ens-expiry-production.json).
Required CI passed all 197 server tests without skips. No contracts or hosted settings changed.

Earlier history and PR #130 operator evidence used V2 reservation expiry for V1 results.
Those expiry values are superseded by this audit. Renewal identity, amount and duration evidence
is unchanged. PR #130 now discovers the V1 BaseRegistrar at the receipt block and its
read-only operator re-run returns the correct registration dates for all four V1 renewals.

## Historical evidence

The [September 18 manifest](deployments/2026-09-18/manifest.json) and accompanying receipts are
retained for contract provenance and test fixtures. That factory is superseded: it rejected native
Arc funding after wallet deployment. Its helper-replacement rehearsal and canaries apply to that
older generation. Do not derive current deposit addresses from it.
