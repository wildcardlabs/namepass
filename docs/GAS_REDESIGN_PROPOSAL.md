# Proposal: two-contract protocol for lower renewal gas

Date: 2026-10-12. Status: proposal for review, not implemented. Testnet only; no mainnet
deployment exists, so addresses are not yet fixed.

## Summary

Merge the gateway and the pointer into the factory, and make the ENS helper a view-only adapter
that never holds funds. A steady-state Ethereum renewal drops from about 305k gas to about 166k
gas, a 45% reduction in execution gas and about 43% after refunds. Every indexed event keeps its
signature, fields, and order, so the Goldsky pipeline and database schema do not change. The
trust model is unchanged for the adapter and improves in two places. The right time to do this is
now, before the independent audit and before any mainnet deployment.

## Why renewals are expensive today

A direct Ethereum renewal moves the money through three contracts before ENS:

1. The deposit wallet approves the gateway, and the gateway pulls.
2. The gateway approves the helper, and the helper pulls.
3. The helper approves ENS, and ENS pulls.

Each hop costs an approval, a pull, balance checks on both sides, and an allowance clear. The
helper also asks ENS for a forward price that ENS computes again inside `renew`, and the gateway
writes a residue counter on every renewal to track rounding dust worth a fraction of a cent.

Measured on a Sepolia fork at block 11,900,165, renewing `vitalik` through the live October V1
renewer and the real USDC proxy, with all contracts built from current source:

| Item | Gas |
| --- | --- |
| ENS `renew`, V1 route including wrapper sync | 81,896 |
| USDC `approve`, three hops | 69,723 |
| USDC `transferFrom`, two hops | 52,656 |
| ENS forward quote `getRenewPrice` | 12,205 |
| USDC `balanceOf`, nine reads | 11,250 |
| ENS `isRenewable`, both renewers | 7,386 |
| USDC approve-to-zero, two calls | 6,682 |
| Executor allowance transfer | 5,363 |
| Oracle reads | 5,336 |
| Our logic, events, residue write, reentrancy guard, pointer and factory reads | about 50,000 |
| Total, steady state | 305,351 |

Two thirds of the cost is USDC and ENS. Of the rest, almost all of it is the price of the two
internal hops.

## The proposed design

Two contracts plus the existing storage-free ERC-1167 deposit wallets.

### Factory

The universal-address factory keeps its current role and absorbs the gateway and the pointer.

- **Direct Ethereum path.** The renewal runs inside the wallet context. The wallet asks the
  adapter for a plan, approves the returned ENS renewer for exactly the returned price, executes
  the returned calldata, requires that its balance fell by exactly that price, clears any residual
  allowance, and transfers everything left to the executor. The wallet returns the figures and the
  factory emits `HelperUsed`, `Renewed`, then `DepositProcessed`, in that order.
- **CCTP path.** The mint recipient and destination caller in every L2 burn become the factory's
  own address, which is identical on every chain. The hub stores Circle's transmitter and
  messenger at initialization. `completeCCTP` moves onto the factory and settles from the
  factory's balance through the same routine. `CCTPClaimed` fires before ENS executes, then
  `HelperUsed` and `Renewed` with the CCTP flag set. A failed claim reverts the mint and the
  nonce, so the same message can be retried, as today.
- **Governance slot.** The pointer's `currentHelper`, governance executor, two-step handover, and
  events move into factory storage, hub only. The Namepass owner role keeps finality only.
- **No residue.** Rounding dust goes to the executor with the fixed allowance. `earnedResidue`,
  `withdrawDust`, `DustWithdrawn`, and the residue recipient are removed. `Renewed.remainder`
  still reports the dust.
- **Reentrancy guard** in factory storage covering `renew`, `renewWithFee`, and `completeCCTP`.
- **View shims** so off-chain discovery works by configuration alone: `pointer()` and `gateway()`
  return the factory, plus `currentHelper`, `GAS_ALLOWANCE`, `paymentToken`, and `quote`.
- **Batch entrypoint.** `renewMany(labels[])` processes several names in one transaction, with a
  self-call per name so one unrenewable name reverts alone. Events stay one set per name.

The L2 side is unchanged: read the wallet balance, cap at Circle's live burn limit, refuse amounts
below the minimum, deploy the wallet if needed, burn with the label as hook data, emit
`DepositProcessed`.

### Adapter

The current `ENSV2RenewalHelper` with `execute` replaced by a view function
`plan(label, budget)` that returns the renewer, duration, price, and renewal calldata. It keeps
`quote`, `renewableBy`, `nameState`, the ENS address getters, `referrer`, and the interface
metadata. It never holds funds, so its balance checks, allowance clearing, and forward quote are
gone. ENS governance still selects it, and its runtime fingerprint is still checked off-chain.

## Measured result

The core of the new direct path was measured with a disposable harness on the same fork block,
same label, against the real V1 renewer and real USDC. The harness performed exactly the steps
above and emitted the three events. It omitted only the factory's label hashing and the proxy
dispatch, estimated at about 6k.

| Path | Steady state | First use for a name |
| --- | --- | --- |
| Current, five contracts | 305,351 | 489,531 |
| Merged, measured core | 160,363 | 291,562 |
| Merged, with dispatch estimate | about 166,000 | about 340,000 |

After EIP-3529 refunds, the current path pays about 244k because it sits at the refund cap. The
merged path pays about 139k because all of its refunds are realized.

Of the remaining 166k, about 82k is ENS and 23k is the one unavoidable USDC approval. Our overhead
drops from about 220k to about 60k. About 44k of the ENS figure is the V1 migration bridge, which
disappears as names migrate; a native V2 renewal is about 38k inside ENS.

The CCTP claim on Ethereum is not measured end to end because it needs a live Circle attestation.
Estimated from the measured components, our part after the mint drops by about 85k to 90k. Circle's
signature checks and mint are fixed and not ours to shrink.

## What the explorer and server see

- `WalletDeployed`, `DepositProcessed`, `CCTPClaimed`, `HelperUsed`, and `Renewed` keep their
  signatures, indexed fields, and emission order.
- `Renewed` and `CCTPClaimed` are emitted by the factory address instead of the gateway address.
  Setting `gatewayAddress` and `pointerAddress` in `src/lib/chains.ts` to the factory address
  satisfies the webhook's contract check in `server/goldsky.ts` and the generated Goldsky filter.
  The database schema does not change.
- Every read in `src/lib/helperDiscovery.ts` and `server/public-quote.ts` keeps working through
  the shims.
- `DustWithdrawn` disappears and `HelperUpdated` moves to the factory. Neither is indexed today.
- Several `DepositProcessed` events in one transaction are already supported, because flow
  identity never merges by transaction hash alone.

## Trust

- The adapter can direct at most the quoted price of one payment, capped by the approval and
  verified by the balance delta, and only after ENS governance activates it. That is the same
  power today's helper holds when it pulls the whole budget. Calldata aimed back at the factory or
  a wallet is blocked by the reentrancy guard and the execution-context checks.
- Removed trust points: the `l1Helper` value that each L2 had to get right or misdirect every mint
  permanently, and the residue recipient role.
- No Namepass key can move deposited funds at any stage. The factory's balance is empty between
  claims, so one payment never mixes with another.
- The factory gains the CCTP parsing code. The burn destination is already unreplaceable, so this
  adds no new permanence, but the audit must cover the final form.
- ENS sees the wallet or the factory as `msg.sender`. ENS keys nothing on the payer; the referrer
  travels in calldata.

## What it costs

- A new factory and new deposit addresses on testnet.
- Regenerated Goldsky definition with new addresses and start blocks.
- New resolver constant, regenerated adapter fingerprint.
- Rewritten renewal, CCTP, and pointer Foundry suites. The two deployment-pinned fork tests become
  historical.
- Updates to `CONTRACTS_V2.md`, `ENGINEERING_CONSTRAINTS.md`, `DEPLOYMENTS.md`, and
  `DECISIONS.md` for the removed forward quote, the removed residue, and the merged roles.

## Considered and rejected

- **Standing USDC approval from the factory to ENS.** Gross gas falls by 18k, but the relayer pays
  about 1.6k more. Today's approve-and-clear pattern refunds 19.9k of its 23k, while Circle's USDC
  decrements a standing allowance on every pull with no refund. It also reaches only the CCTP path,
  needs re-granting when ENS rotates renewers, and adds a permission surface.
- **Transient-storage reentrancy guard.** Needs Cancun; the compiler target is pinned at Shanghai
  because Arc does not support newer.
- **Caller-proposed duration verified on-chain.** Costs about the same as computing it.
- **Trimming events.** Changes the schema.
- **Dropping the executor payment.** Removes the permissionless completion incentive.
- **Dropping the reentrancy guard.** Saves about 2k net. Kept as defense in depth.
- **Computing the wallet address in a second place.** Saves about 1k and duplicates derivation
  logic in a permanent contract.

## Smaller option if the redesign is declined

Within the current five contracts, two duplicate balance reads can be removed for 3.2k, the two
allowance clears can become conditional for another 4k, and the forward quote can be dropped for
another 12.9k, about 6.6% in total. All three passed the full suite. Only the last changes a
documented check.

## Decisions for the reviewer

1. Accept the merged two-contract design, or stay with five contracts and take the 6.6%.
2. Accept the adapter returning calldata that the factory executes under an exact approval cap,
   versus the adapter holding funds as today.
3. Accept rounding dust going to the executor instead of a residue recipient.
4. Include `renewMany` from day one.

## Method

Foundry 1.5.1 with the pinned compiler settings. Public Sepolia RPC. Fork block 11,900,165. The
measurement harness, adapter copy, and prototype diffs are kept outside the repository and can be
reproduced on request. Nothing in this proposal is committed to the contract sources.
