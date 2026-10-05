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

Hosted migration history has not been inspected. No hosted database objects or payment records
are deleted, and no API flag is enabled. The corrective deployment must verify populated activity,
name history, existing routes and unchanged public docs before this incident is marked resolved.

## Historical evidence

The [September 18 manifest](deployments/2026-09-18/manifest.json) and accompanying receipts are
retained for contract provenance and test fixtures. That factory is superseded: it rejected native
Arc funding after wallet deployment. Its helper-replacement rehearsal and canaries apply to that
older generation. Do not derive current deposit addresses from it.
