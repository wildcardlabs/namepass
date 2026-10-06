# Source-deposit evidence

Date: 2026-10-05. Updated 2026-10-06 with conservative receipt-set closure and source finality.
No status endpoint or public API enable setting is introduced.

## Result and scope

A canonical source receipt can enumerate transfers independently of the indexed deposit rows.
The new read-only inspector compares that enumeration with the existing database. It detects
missing members even when every delivered row is finalized. It does not decide whether the
funds were processed or renewed.

The inspector reads the full **current activated-name registry**, with a hard limit rather
than a truncated query. It verifies each stored address against its normalized ENS label's
CREATE2 derivation. This establishes the address universe used by this inspection; it does not
establish coverage of every possible unregistered, counterfactual ENS deposit address.
`unregisteredRecipients` preserves receipt recipients outside that universe for review.

`representationComplete` means every positive, non-self transfer to a name in that snapshot
has one unambiguous, canonical indexed representation, with matching sender, amount, token,
chain, transaction, block and position. The set must be nonempty, each recipient must currently
have a watch, and no extra or conflicting row may remain. This field is **not** API `complete`.
The result also identifies names activated after the source block. Current watch membership
and activation timestamps do not prove historical dynamic-table propagation.

Before endpoint implementation, resolve the supported address universe and activation boundary
explicitly. Do not turn this current-registry result into a claim about all deterministic ENS
addresses or historical indexer coverage. Missing source/index evidence keeps completion gated;
unknown provider evidence is a retryable error, not a failed payment.

## Receipt identity and Arc funding

| Route | Authoritative movement | Indexed representation checked |
| --- | --- | --- |
| Sepolia, Base Sepolia, Arbitrum Sepolia | `Transfer` from that chain's configured USDC contract, six decimals | Exact ERC-20 log index |
| Modern Arc ERC-20 | Native system transfer plus its six-decimal ERC-20 mirror | ERC-20 log identity, counted once |
| Modern Arc top-level native | System `Transfer`, eighteen decimals, matching transaction sender/recipient/value | Existing `:native:` event and transaction index; public `logIndex` remains null |
| Modern Arc internal native | System `Transfer` to the registered address | No verified representation in the current top-level native dataset; stays unmatched |

Arc's [USDC system event reference](https://docs.arc.io/arc/references/usdc-system-events)
identifies the native emitter and its eighteen-decimal units. It describes the additional
six-decimal ERC-20 log for the same movement. The inspector uses the system stream to expose
internal native transfers and compares the two streams without adding their amounts together.

When identical native and ERC-20 movements cannot be paired uniquely, the inspector reports
ambiguity. It does not guess which system log the stored native transaction represents.
Native values that are not exact six-decimal USDC units are reported as unsupported precision;
no rounding or discarded dust can establish a complete set.

The registry records Arc testnet's Zero5/Zero6 activation timestamp, `1779894517`, from the
[`arc-node` v0.7.1 changelog](https://github.com/circlefin/arc-node/blob/v0.7.1/CHANGELOG.md).
Older receipts need a separately reviewed legacy-event parser and are rejected by this tool.
This metadata does not change the running Goldsky pipeline, native payment handling or fees.

Receipt, transaction and canonical block identities must agree. Every log must belong to that
receipt, with an ordered, unique position and no removed flag. Known transfer logs must decode
correctly; forged emitters cannot supply deposit evidence. Amounts use `BigInt` throughout.
Canonical-chain reports come from the configured RPC; this is not an independent consensus verifier.

## Read-only inspection

With `DATABASE_URL` and the selected chain's RPC environment variable supplied securely:

```bash
node --import tsx scripts/public-api/source-deposits.ts 5042002 '<transaction-hash>'
```

The CLI validates arguments before connecting. It overrides database-URL connection options
with read-only and timeout settings, checks PostgreSQL's actual `transaction_read_only` state,
and selects names, watches and deposit/event candidates in one repeatable-read transaction.
It rolls back and releases the database before RPC reads. It has no write query, activation,
Workflow, signing, ingestion or broadcast path.

Each invocation permits seven raw RPC reads: chain ID, receipt, transaction, source block,
`finalized` anchor, and numbered rechecks of both block identities. Each response is capped at
one MiB; the CLI aborts rather than decoding excess data.
They are sequential, with no retries and one 15-second RPC deadline. Raw reads avoid the
previous Arc receipt formatter failure observed during baseline discovery. Provider credentials
and database/provider errors are never printed. The output contains public evidence only.
The database limits are 1,000 names and 1,000 candidate rows; receipt limits are 10,000 logs.
Exceeding a limit fails inspection rather than silently narrowing the deposit set.

## Verification and remaining gates

Seven existing source transactions passed the actual CLI against the live testnet database:
one Sepolia ERC-20 deposit and six native Arc deposits. Each source receipt matched its
canonical block and exact indexed amount/identity. All seven independently checked database
sessions were read-only. The original inspector used four RPC calls. The dated receipt is in
[DEPLOYMENTS.md](DEPLOYMENTS.md#source-deposit-evidence--2026-10-05).

Regression fixtures cover staggered delivery of two deposits, duplicates and corrections,
source-chain token separation, current watch gaps, unknown recipients, registry bounds,
internal Arc funding, mirror duplication, ambiguous identities, fractional precision and
malformed or forged receipt evidence. Base/Arbitrum cases are fixtures, not new live payments.

These samples are all single-deposit transactions. No fresh multi-deposit payment, activation
propagation interval, source-finality policy, pooled/split allocation or public polling capacity
was proven. Source receipt membership is one gate. The next proof must bind every member to
all applicable `DepositProcessed` segments, CCTP messages/claims and exact finalized renewal
identities. A `settled` flow, a quiet index or an empty remainder inference alone is insufficient.
The [public API plan](PUBLIC_API_PLAN.md) retains those requirements.

## Conservative receipt-set closure — 2026-10-06

`representationComplete` retains its current-registry meaning. A new private
`receiptSetClosed` result additionally requires that every positive, non-self USDC recipient
from the authoritative receipt stream belongs to that registry. An unregistered recipient
prevents closure, even if every known deposit is already indexed and finalized. No recipient
is presumed unrelated merely because Namepass does not currently know its ENS label.

This is deliberately conservative. A mixed transaction paying an ordinary unregistered USDC
recipient cannot close under this rule without separate exclusion evidence. It does not change
which addresses the protocol can accept or narrow the published API contract. Unknown addresses
and unsupported internal native representations stay unresolved; this inspector does not
activate names or fill missing index rows.

The late-registration regression enumerates two source transfers when only the first name is
registered. Current-registry membership passes, but receipt closure remains false. Registering
the second name still leaves closure false until its exact indexed deposit arrives. Replacing
the new guard with current-registry membership alone makes this regression fail.

When the full receipt has no unclassified recipient and all members have exact canonical indexed
representations, this closes that inspected receipt set at the database snapshot. Current watch
presence is also required. It does not prove dynamic-table propagation intervals for other
transactions, processing, allocation, or renewal completion. Neither private boolean is API
`complete`. The published requirement to prove the full relevant set remains unchanged.

## Source finality policy — 2026-10-06

The read-only inspector reports `sourceFinality` separately from indexed membership. It uses
the configured source provider's `finalized` tag, retains the numbered anchor and hash, and
rechecks both the source block and anchor by number after inspection. A source block above
the anchor yields `providerFinalized: false`. A missing/malformed anchor, changed identity or
contradictory timestamp/hash fails inspection. There is no fallback to `safe`, `latest`, a
stored deposit status, a fixed confirmation count or Circle's attestation threshold.

| Source route | Meaning required from the configured provider | Primary reference |
| --- | --- | --- |
| Sepolia | Consensus-finalized execution block | [Ethereum finality](https://ethereum.org/developers/docs/consensus-mechanisms/pos/#finality), [RPC tags](https://ethereum.org/developers/docs/apis/json-rpc/) |
| Base Sepolia | L2 block derived from finalized L1 data | [Base derivation](https://docs.base.org/base-chain/specs/protocol/consensus/derivation) |
| Arbitrum Sepolia | L2 messages mapped from the finalized parent-chain block | [Pinned Nitro reader](https://github.com/OffchainLabs/nitro/blob/60a48d346fccc11a0e1637f4ddd31d3df188144e/arbnode/inbox_reader.go), [finality forwarding](https://github.com/OffchainLabs/nitro/pull/2936) |
| Arc Testnet | Committed block under Arc BFT finality | [Arc consensus](https://docs.arc.io/arc/concepts/consensus-layer) |

This is a provider trust policy, consistent with the existing history/renewal proof boundary.
The inspector does not verify Ethereum consensus, L1 batch inclusion, Nitro validation settings
or Arc validator signatures independently. Finality does not repair missing receipt membership.
It is not a claim about CCTP withdrawal/challenge delays or fee pricing.

The configured providers for all four testnets returned usable tags and numbered anchor
rechecks. The [capability audit](deployments/2026-10-06/public-api-source-finality-capabilities.json)
used six reads per chain. Tags are separate observations: Arc can advance between requests,
so an earlier `latest` response need not be higher than a later `finalized` response. The actual
source inspector compares a specific source block with its numbered finality anchor.

The updated real CLI verified all seven existing deposits against enforced read-only database
snapshots. Each has a closed receipt set and a source block below its rechecked provider anchor.
Each used seven RPC reads, 49 total. See the
[operator evidence](deployments/2026-10-06/public-api-source-finality-operator.json), which pins
the inspected implementation. One earlier whole-audit attempt exited with sanitized
unavailability; a fresh audit passed. The CLI never retries or accepts incomplete evidence.
Base/Arbitrum tag capability is verified; new live payments on those routes are still untested.

The next adapter must combine these separate source facts with complete allocation windows
and every finalized renewal join, then prove its hosted budget and correction behavior. Fresh
multi-deposit, activation-propagation and pooled/split hosted canaries remain release gates.
No API route, schema, ingestion change, wallet funding or public enable setting was added.
