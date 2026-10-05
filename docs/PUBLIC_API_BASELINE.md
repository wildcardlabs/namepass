# Public API baseline and contract review

Date: 2026-10-05. Scope: stage 1 of [PUBLIC_API_PLAN.md](PUBLIC_API_PLAN.md).
This is discovery and a proposed contract revision. No API endpoint, worker, migration,
contract deployment or hosted configuration change is included.

## Result

The working application and its hosted schema are compatible. The proposed API is not
available. Address and quote capabilities have established services and contract reads to
adapt, subject to their release checks. Transaction completion cannot yet be implemented
truthfully for every documented case. Do not start status or finalized-history implementation
by mapping `flows.status = settled` to `complete`.

Production identities and recovery status are recorded in [DEPLOYMENTS.md](DEPLOYMENTS.md).
The bounded inspection results are in the [baseline receipt](deployments/2026-10-05/public-api-baseline.json).
No fresh wallet transfer was sent. Existing payments are historical samples, not new canaries.

## Hosted baseline

The database inspection used an existing Neon login. The connection URI stayed in process
memory. PostgreSQL enforced `default_transaction_read_only=on` and a repeatable-read,
read-only transaction, with statement and lock timeouts. The transaction was rolled back.
No migration, hosted object deletion, payment record change or credential file was created.

The inspected Neon `testnet` branch has nine migration ledger entries, `0000` through `0008`.
Every SQL SHA-256 hash and journal timestamp matches the repository. All 134 application
columns match an independent in-memory fixture built from those migrations by name, SQL
type, underlying type and nullability. This does not certify identical constraints, indexes,
runtime grants or capacity. Retired API columns and verification tables are absent.

Vercel hides its sensitive database URL from environment reads. Two independent public
activity identities match the inspected branch by flow ID, event ID and renewal transaction.
The separate Neon branch named `production` has no public tables. This corroborates the
testnet database binding without exposing or directly comparing the production credential.

There are 11 activated names and 11 watched addresses, with no current membership gap.
Seven deposits are indexed: one Sepolia ERC-20 transfer and six native Arc transfers.
Ten flows are settled; three have no single `deposit_event_id`, and one has no origin event
link. All ten have a renewal event link. These are distinct coverage measures, not proof that
each deposit has a complete processing relationship.

Goldsky reports the current testnet pipeline active. Its webhook hostname is an alias of the
same verified production deployment. No delivery watermark, historical watch coverage or
transaction-set completeness was established. Present watch membership and pipeline status
cannot establish those facts.

## Independent receipt and pricing samples

- A direct Sepolia payment has a successful source receipt, one matching USDC transfer and
  a successful gateway renewal receipt. Source and renewal block hashes match current RPC
  blocks; indexed amounts and duration match the renewal log.
- A native Arc payment matches the source transaction's recipient and 18-decimal value,
  normalized to six-decimal USDC, and its indexed block. Its Sepolia renewal matches the
  gateway receipt. The initial higher-level Arc receipt call returned `InternalRpcError`;
  subsequent raw receipt, transaction and block calls succeeded. The cause remains unknown.
  Require a focused client/provider compatibility test before relying on that path.
- All four configured RPCs return the expected chain ID and deployed factory bytecode. They
  accept a `finalized` block request. This is one-provider capability evidence, not a validated
  finality policy for each chain or proof of archive coverage for all required history.
- At one pinned Sepolia block, the active helper passes the supported adapter check and
  gateway/factory/token bindings. The gateway allowance is `100000` units. Three one-USDC
  quote samples cover registrar and v1 renewer selection and agree with gateway arithmetic.
  Discount boundaries, maximum route amounts, bridge assumptions and outage behavior are
  not validated by those samples.

No Base or Arbitrum payment, multi-deposit transaction, staggered index delivery, shared
renewal or split processing case was proven. The Arc sample does not establish the full
independent CCTP burn-message-claim relationship. Those cases need fresh fixtures and hosted
evidence before release, not inferred associations from equal amounts or wallet addresses.

## Field-to-source inventory

This covers the planned response fields, not a claim that existing UI responses implement
them. Amounts remain exact six-decimal USDC integer strings. Validate all stored facts and
receipt identities before exposing them; a SQL row is a candidate source, not final proof.

### Address and funding chain

| Fields | Candidate source and condition |
| --- | --- |
| `name` | `normalizeLabel()` in `src/lib/namepass.ts`, adapted by `normalizedLabel()` in `server/names.ts`; normalized `.eth` name, not arbitrary subdomains. |
| `depositAddress` | Existing deterministic derivation and `activateName()` in `server/names.ts`; confirm factory equality on each advertised chain. |
| `subname` | Existing normalized name to `namepass.eth` subname mapping. |
| `subnameVerified` | Resolver result equal to that full address on this deployment. Never infer from a formatted subname. Verification can invoke CCIP activation; account for its effects in the address stage. |
| `chains[].chainId`, `name`, `tokenAddress` | Server chain registry in `src/lib/chains.ts`. Only deployed funding testnets. |
| `chains[].minimumAmount` | `minimumTriggerAmount` in `server/config.ts`, currently `500000` on each route. It is a processing threshold, not a guaranteed positive duration for every name and price. |

Activation inserts the name and watch record, checks balances and can start payment work.
Idempotent concurrent activation and indexer watch propagation must be demonstrated before
the API says the address is ready to fund. Existing UI activation is not a ready-made API
response: it has different status/response semantics and no new anonymous API abuse controls.

### Quote

| Fields | Candidate source and condition |
| --- | --- |
| `name`, `chainId`, `amount` | Validated normalized request; supported source route and exact unsigned integer amount. |
| `secondsAdded`, `amountApplied` | Gateway `quote(label, budget)` at the pinned pricing block; checked active helper and renewer dependencies. |
| `renewalFee` | Gateway `GAS_ALLOWANCE()` at that same block, one flow only. |
| `bridgeFee` | Namepass automation’s transfer policy: currently zero for Standard transfers. Validate the supported route configuration and limits. Do not query Circle for pricing; future fee-bearing transfers require an explicit policy and quote update. |
| `roundingRemainder` | Exact `amount - renewalFee - bridgeFee - amountApplied`; reject unsupported or inconsistent arithmetic. |
| `pricingBlock` | Sepolia block used for helper discovery and every pricing read; not a source-chain block. |
| `expiresAt`, `estimate` | Calculation timestamp plus 60 seconds; `estimate: true`. This is an estimate lifetime, not a guaranteed execution price. |

Use a fresh server adapter. `src/lib/oracle.ts` contains browser-specific code and cannot be
imported wholesale into a server route. Source-chain burn limits and Standard route configuration
need bounded, validated reads. The quote uses the automation fee policy, not an external
fee-pricing service. No activation, signing or database write is permitted in the quote path. Unsupported helper or pricing dependencies return `503`.

### Transaction status and renewal

| Fields | Candidate source and condition |
| --- | --- |
| `chainId`, `transactionHash` | Validated source request; chain is part of identity. Normalize hashes. |
| `deposits[].name`, `depositAddress` | Receipt recipient matched to the supported deterministic-address registry and `names`; coverage must include relevant addresses missing from index delivery. |
| `deposits[].amount` | Exact validated USDC transfer value, with the separate native Arc normalization described below. |
| `deposits[].logIndex` | Actual ERC-20 source log index; `null` for native Arc. |
| `deposits[].status`, `reason` | Evidence model, not direct enum conversion from deposit or flow status. Below-minimum funds stay pending. Retryable provider errors are not source failure. |
| `deposits[].renewals` | Proven deposit → every applicable processing segment → gateway renewal relationship, including pooling, absorption, split flows and exact CCTP identity where applicable. Empty until renewal evidence is established. |
| Aggregate `status` | Closed, nonempty source deposit set plus the precedence defined below. No empty-array or indexed-count shortcut. |
| Renewal `renewalId` | Gateway `Renewed` event's decimal chain ID, lowercase transaction hash and decimal log index, joined with colons. |
| Renewal `chainId`, `transactionHash`, `secondsAdded` | Matching gateway log and canonical receipt; amount/duration segmentation in `server/settlement-identity.ts` and `server/indexed-renewal.ts` supports candidate matching. |
| Renewal `expiry` | Associated ENS expiry event or receipt enrichment matched to the same renewal; `null` if unavailable. Never substitute the name's later current expiry. |

The native Arc source currently stores `transaction_index` in `deposits.log_index`, with a
native event ID. That position is not an ERC-20 log index. The inspected native transaction
also has a token-style receipt log; native and log representations must not count the same
economic transfer twice. Define and test that rule. Top-level recipient/value enumeration
does not establish support for internal native transfers; trace coverage and source semantics
remain a release decision.

The three settled flows without one deposit link demonstrate why `deposit_event_id` is not
a complete allocation model. Existing balance absorption rules and display recovery in
`server/deposit-eligibility.ts`, `server/goldsky.ts` and `server/reads.ts` do not, by themselves,
prove transaction completion. Do not reuse UI funder inference as public completion proof.

### Name history

| Fields | Candidate source and condition |
| --- | --- |
| `name`, `currentExpiry` | Normalized lookup and `names.current_expiry`; nullable recorded snapshot, not a fresh chain read. |
| `expiryUpdatedAt` | `null` for the stored snapshot unless independent evidence pairs it with the same ENS read. `ens_synced_at` cannot be mapped directly. |
| `items[].renewalId`, `chainId`, `transactionHash` | Same proven gateway event identity as status, never provider event ID or flow ID. |
| `items[].flowId`, `sourceChainId` | Proven associated `flows.id` and `origin_chain_id`. Shared rows may repeat a renewal identity; never invent provenance to satisfy a required field. |
| `items[].secondsAdded`, `amountApplied`, `renewalFee` | Validated gateway facts `duration`, `amount_applied`, `gas_allowance`; nullable when unavailable. Flow projections are supporting candidates. |
| `items[].expiry` | Event-specific expiry evidence as above; nullable. |
| `items[].status` | `complete` only with verification and finality; `processing` while those checks remain pending. An item still requires proven event identity. |
| `items[].renewedAt` | Gateway renewal block timestamp, not flow `settled_at` or ingestion time. |
| `nextCursor` | Fresh opaque cursor bound to the normalized name and deterministic ordering, with a tie-breaker for shared flow rows. `null` on the final page. Reject malformed or cross-name cursors. |

The existing name-details GET, `publicName()` in `server/names.ts`, writes an ENS refresh and
can resume held payment flows. Do not wrap it in the new read-only history route. This
discovery called name activity reads, not that mutating name-details route.

### Error and transport contract

| Fields or behavior | Existing source and required addition |
| --- | --- |
| `error.code`, `message`, optional `details`, `requestId` | `ApiError` and `handler()` in `server/http.ts` supply the envelope. New routes need endpoint-specific validation and safe error mapping. |
| `error.details.maximumAmount` | Validated source-route single-flow maximum for a rejected quote; no measured value established here. |
| `Retry-After` | New public adapter policy for pending responses and retryable `404`, `429`, `503`. Not supplied consistently by the current core handler. |
| CORS, methods, body bounds | Existing body parser has an 8192-byte bound; public adapter still needs OPTIONS handling, allowed methods/headers and exposed retry headers, including error responses. |
| Rate limits, independent availability | Not present as a dedicated public API policy. Global `NAMEPASS_MAINTENANCE` affects core reads and is not an API-only switch. |

The documentation already promises rate limiting; the revised OpenAPI adds `429` to every
operation so all surfaces agree. Missing public status/history routes currently return the
SPA with HTML and HTTP 200. Fix that routing behavior as part of a reviewed exposure stage;
never treat status alone as endpoint success.

## Expiry writer audit

| Writer | Expiry/timestamp relationship |
| --- | --- |
| Activation insert/update, `server/names.ts` | ENS read value with current read/update time; later writers can break snapshot pairing. |
| Name-details refresh, `server/names.ts` | ENS read value and current time; also resumes held work. |
| Held-name operational refresh, `server/operations.ts` | ENS read value and current time; also updates processing state. |
| Direct settlement, `server/ethereum.ts` | Receipt-associated expiry and current projection time when expiry increases. Not an ENS read timestamp. |
| Cross-chain settlement, `server/cctp-renewal.ts` | Receipt-associated expiry and current projection time when expiry increases. Not an ENS read timestamp. |
| Renewal aggregate/correction, `server/goldsky.ts` | Can change or roll back `current_expiry` without changing `ens_synced_at`. |
| ENS event projection/correction, `server/goldsky.ts` | Uses event block time and `greatest` with the old timestamp; does not establish the read time of the returned value. |

The proposed safe default is `expiryUpdatedAt: null` for persisted snapshots. No new core
column is required for that truthful behavior. A non-null freshness feature needs a separately
reviewed paired-read strategy and capacity budget or independent metadata proposal.

## Proposed interface decisions

The accompanying guides, OpenAPI and skill use these rules for review before implementation:

1. `renewalId` is `{chainId}:{lowercaseTransactionHash}:{logIndex}` from the gateway event.
   Both status and history require it. Shared flow rows may repeat it; clients count duration
   once per identifier. Event identity does not substitute for proven flow provenance.
2. A proven invalidated source deposit makes aggregate status `failed`. Otherwise an unproven
   closed set or any pending member keeps it `pending`; an unconfirmed renewal keeps it
   `processing`. Only a closed, nonempty set with every member complete becomes `complete`.
   Missing indexed members prevent completion. Provider outages return retryable errors.
3. Corrections revoke invalid completion claims and remove invalidated history events on
   subsequent reads. Client responses are observations, not irrevocable payment guarantees.
4. Expiry read timestamps remain paired-read timestamps and are null when unknown. History
   does not refresh ENS state or resume payment work.

These rules make the contract precise. They do not prove an implementation can satisfy all
cases. History cardinality, receipt completeness, per-chain finality and native representations
must pass the gates below before their endpoints can claim completion.

## Remaining release gates and next stage

| Gate | Required evidence before the affected stage |
| --- | --- |
| Full deposit set | Canonical enumeration plus address/watch coverage independent of indexed rows. Staggered delivery, missing members, duplicate delivery, native/log duplication and corrections must prevent premature completion. |
| Payment mapping | Direct, pooled, absorbed and split flows; exact cross-chain burn/message/claim relationships. Test all applicable processing segments, shared renewal deduplication and two renewal events in one transaction. |
| Provider policy | Focused Arc client compatibility, bounded archive reads, chain-specific finality and correction rules, timeout/outage behavior. Do not add RPC calls to ordinary activity polling. |
| History | Event identity/provenance cardinality, shared-row pagination, equal timestamps, name-bound cursors, late events and expiry pairing tests. |
| Quote | Discount/rounding boundaries, supported helper transitions, source burn limits, fee/finality modes, maximum amounts and exact arithmetic. |
| Address | Concurrent idempotence, resolver verification, watch propagation and anonymous activation limits. |
| Exposure | Isolated backend staging; API-only availability control; actual JSON routes, CORS and retry/rate policies. Alpha's UI proxy is not staging evidence. |
| Hosted release | Exact commit/schema checks and existing-core smoke tests after deployment; user-signed low-value canaries on all supported funding routes. |

Next, review this inventory and contract revision. Then stage 2 can implement the quote route
as a separate change after its provider/capacity and route-limit design is concrete. Staging
deployment needs an explicit configuration review. If durable verification metadata is needed
for status, propose it separately; do not expand core tables, gate ingestion or install a new
worker as an incidental endpoint change. No smart-contract deployment is required by the
discovered address or quote capabilities.
