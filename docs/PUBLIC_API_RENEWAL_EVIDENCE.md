# Processing-to-renewal evidence

Date: 2026-10-06. This operator verifier joins one exact processing call to one ENS renewal.
It does not implement transaction status or prove that a source deposit was consumed.
The independent consumption-window verifier is described in
[PUBLIC_API_ALLOCATION.md](PUBLIC_API_ALLOCATION.md).

## Operator interface and bounds

Supply the configured source and hub RPC variables securely, then run:

```bash
node --import tsx scripts/public-api/processing-renewals.ts '<source-chain-id>' '<bare-label>' '<processing-hash>' '<processing-log-index>' '<renewal-hash>' '<renewal-log-index>'
```

Hashes and event positions are candidate hints. They do not bypass receipt verification.
The tool reads at most two receipts, 24 RPC operations and one Circle message response within
one 15-second deadline. Each HTTP response is limited to one MiB. There are no retries.
RPC permits chain, block, receipt, runtime and contract reads only. Circle access uses its
public testnet message endpoint; it does not query prices or fees, request re-attestation,
submit a claim or sign a transaction. The CLI has no database or payment-execution path.
Errors suppress provider details and credentials.

## Evidence chain

| Result | Required source |
| --- | --- |
| `processingId` | Source chain, successful canonical receipt, exact factory `DepositProcessed` log, expected name/wallet and positive amount |
| Direct join | Same hub transaction; exactly one matching gateway renewal inside that factory call's segment |
| Cross-chain join | Exact source `MessageSent` position, Circle response for that source hash and ordered index, final nonce and matching gateway claim/renewal segment |
| `renewalId` | Hub chain, normalized renewal transaction hash and gateway `Renewed` log index; same encoding as history |
| Duration and amounts | Exact gateway event, with received amount, allowance, applied amount and remainder arithmetic checked |
| Event-specific expiry | One authoritative ENS renewal in that gateway segment, authenticated helper metadata, matching label, duration, amount, USDC token and referrer |
| `providerFinalized` | Both processing and renewal blocks at or below their configured provider's valid `finalized` anchors |

Every receipt log must belong to its successful receipt, with ordered unique log indices,
consistent transaction position and canonical block/hash. The tool pins the reviewed factory
and gateway runtimes at the receipt blocks and checks the exact wallet proxy. It authenticates
the helper selected in that renewal segment, verifies its reviewed adapter runtime, then reads
its immutable ENS configuration at the renewal block. Those addresses and the referrer must
match the supported deployment. It never selects the current pointer to interpret an older call.

V2 renewals use the V2 registrar event expiry. V1 renewals discover `BASE_REGISTRAR()`
from the selected ENS V1 renewer at the receipt block and use the preceding V1 registration
event, excluding later wrapper synchronization. The V2 reservation's premigration bonus
is not registration time for an unmigrated name. This supplies that renewal's expiry. It does not claim the current name expiry or an
expiry read timestamp. ENS v2 token IDs are not raw label hashes; this verifier uses the event's
label and supported emitter, with the matching payment and renewal fields.

## Circle identity

Circle assigns CCTP v2 nonces offchain. Its message response lists messages by ascending source
log index. The verifier requires the returned source transaction hash and full message count
to match the origin receipt, then selects the exact source call's index. Both hexadecimal and
decimal `eventNonce` representations must equal the final message's nonce.

The final message must match the source message byte-for-byte except for the nonce, executed
finality, executed fee and expiration fields assigned by attestation. Versions, domains,
sender, recipient, destination caller, minimum finality, token, wallet, burn amount, maximum
fee and complete label hook remain identical. The final route must pass the existing CCTP
validator. The gateway claim must match its source domain, nonce, wallet, burn amount and
executed fee. Minted amount must equal burn minus executed fee and match the renewal.

The configured gateway's successful onchain claim supplies acceptance evidence. The operator
does not independently verify Circle signatures or operate a light client. It trusts the
configured receipt providers and Circle's response-to-source-message mapping.
References: [Circle technical guide](https://developers.circle.com/cctp/references/technical-guide)
and [message endpoint](https://developers.circle.com/api-reference/cctp/all/get-messages-v2).

This reads actual receipt accounting. It does not change automation's Standard-transfer policy,
the quote's `bridgeFee: "0"`, or introduce future fee pricing.

## Finality and correction behavior

The output records processing and renewal block identities plus each provider's numbered
finality anchor. Blocks above an anchor yield `providerFinalized: false`; they do not become
completed results. Unsupported finality responses fail inspection. Canonical blocks and the
numbered anchors are rechecked after all receipt, Circle and metadata reads. A changed hash,
inconsistent anchor or malformed receipt fails the proof.

These are provider assertions, not an independently verified source-chain finality policy.
The source inspector now documents the configured-provider policy and verifies tag capability
for all four testnets; see [source finality](PUBLIC_API_DEPOSIT_EVIDENCE.md#source-finality-policy--2026-10-06).
Fresh Base/Arbitrum hosted payment canaries remain release gates. This output has no API
`status` or aggregate `complete` field.

## Verification and remaining gates

Nine regression tests use historical public Arc/Sepolia responses and independent receipt
event values. They cover equal payments for one name, two burns and renewals in one transaction,
exact message indices, unrelated candidates, changed immutable bytes, nonce/readiness mismatch,
ENS and runtime mismatch, receipt corrections, pending finality, cancellation and CLI transport
sanitization/limits. The combined-call case is synthetic and retains distinct event positions.
The fixtures do not execute Solidity or prove hosted pooling/split behavior.

The actual CLI verified nine existing processing calls: eight Arc-to-Sepolia claims and one
direct Sepolia call. Cross-chain inspection used 19 RPC reads for V2 names or 20 for V1 names, plus one public Circle request;
direct inspection used 13 RPC reads. All nine were below the observed provider anchors.
[Live operator evidence](deployments/2026-10-06/public-api-processing-renewal-operator.json)
pins the implementation checksums. No new funding or hosted state change was performed.
All nine identifiers, amounts and durations also match the dated
[private history read](deployments/2026-10-05/public-api-history-completion.json).
Four V1 expiry values in that snapshot were reservation dates and are superseded by the
[registration expiry audit](deployments/2026-10-06/ens-expiry-audit.json). The re-run operator
returns the V1 BaseRegistrar dates for these four results. That comparison is not a new hosted
history test.

Transaction status still requires a closed full source-deposit set, indexed representation,
watch/activation coverage, an unambiguous native Arc identity join, complete allocation windows,
all corresponding renewal joins and reviewed source-route finality. The long-delay payment's
processing-to-renewal join passes, and the explicit extended allocation audit now closes its
source-to-processing window. The default short polling window still cannot cover that delay.
Do not infer API completion from this individual join. Public status is absent and other public
API enable flags remain off. Hosted integration/capacity verification remains a separate stage.
