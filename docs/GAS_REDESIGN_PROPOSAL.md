# Proposal: two-contract protocol for lower renewal gas

Date: 2026-10-12, revised after review. Status: proposal, not implemented. Testnet only; no
mainnet deployment exists, so addresses are not yet fixed.

Revision notes: the first version claimed the backend needed only configuration changes and that
trust was unchanged. Both were wrong. This version scopes the backend work, states the settlement
invariants explicitly, describes the adapter change as a changed execution model with comparable
payment authority, corrects the figures, defers batching, and adds a testnet migration plan.

## Summary

Merge the gateway and the pointer into the factory, and make the ENS helper a view-only adapter
that never holds funds. Measured on a Sepolia fork, the core of a steady-state Ethereum renewal
drops from 305,351 gas to 160,363 gas. With the unmeasured factory dispatch added, the estimate is
about 166k, a reduction of about 45% in execution gas before refunds. Every indexed event keeps its
signature, fields, and order, so the Goldsky pipeline and the database schema do not change. The
backend evidence verifiers, discovery, fixtures, and configuration do change; that work is
scoped below and is doable. The right time to do this is now, before the independent audit and
before any mainnet deployment.

## Why renewals are expensive today

A direct Ethereum renewal moves the money through three contracts before ENS:

1. The deposit wallet approves the gateway, and the gateway pulls.
2. The gateway approves the helper, and the helper pulls.
3. The helper approves ENS, and ENS pulls.

Each hop costs an approval, a pull, balance checks on both sides, and an allowance clear. The
helper also asks ENS for a forward price that ENS computes again inside `renew`, and the gateway
writes a residue counter on every renewal to track rounding dust worth a fraction of a cent.

Measured on a Sepolia fork at block 11,900,165, renewing `vitalik` through the live October V1
renewer and the real USDC proxy, with all contracts built from current source. Figures are
warm-state execution gas inside the test; see Benchmarks for what a real transaction adds.

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
  adapter for a plan, approves the returned renewer for exactly the returned price, executes the
  returned calldata, requires that its balance fell by exactly that price, clears any residual
  allowance, and transfers `amount − price` to the executor. The wallet returns the figures and
  the factory emits `HelperUsed`, `Renewed`, then `DepositProcessed`, in that order.
- **CCTP path.** The mint recipient and destination caller in every L2 burn become the factory's
  own address, which is identical on every chain. The hub stores Circle's transmitter and
  messenger at initialization. `completeCCTP` moves onto the factory and settles from the
  factory's balance through the same routine, spending only the authenticated minted amount.
  `CCTPClaimed` fires before ENS executes, then `HelperUsed` and `Renewed` with the CCTP flag set.
  A failed claim reverts the mint and the nonce, so the same message can be retried, as today.
- **Governance slot.** The pointer's `currentHelper`, governance executor, two-step handover, and
  events move into factory storage, hub only. The Namepass owner role keeps finality only.
- **No residue accounting.** Rounding dust goes to the executor with the fixed allowance.
  `earnedResidue`, `withdrawDust`, `DustWithdrawn`, and the residue recipient are removed.
  `Renewed.remainder` still reports the dust.
- **Reentrancy guard** in factory storage covering `renew`, `renewWithFee`, and `completeCCTP`.
- **View shims** so off-chain discovery works through configuration: `pointer()` and `gateway()`
  return the factory, plus `currentHelper`, `GAS_ALLOWANCE`, `paymentToken`, and `quote`.
- **Executor threaded explicitly** through the internal settlement routine, so a batch entrypoint
  can be added later without a redesign. The batch entrypoint itself is deferred; see below.

The L2 side is unchanged: read the wallet balance, cap at Circle's live burn limit, refuse amounts
below the minimum, deploy the wallet if needed, burn with the label as hook data, emit
`DepositProcessed`.

### Adapter

The current `ENSV2RenewalHelper` with `execute` replaced by a view function
`plan(label, budget)` that returns the renewer, duration, price, and renewal calldata. It keeps
`quote`, `renewableBy`, `nameState`, the ENS address getters, `referrer`, and the interface
metadata. It never holds funds, so its balance checks, allowance clearing, and forward quote are
gone. `interfaceVersion` becomes 2, because the execution interface changed. ENS governance still
selects it, and its runtime fingerprint is still checked off-chain.

## Settlement invariants

These are requirements for the implementation and its tests, not descriptions.

1. **Spend only the authenticated payment.** The routine receives `amount` from its caller: the
   wallet balance the factory read, or the CCTP minted amount. The executor receives exactly
   `amount − price`. The routine never reads the contract's total balance to decide what to pay.
   After a CCTP claim the factory's balance equals its pre-claim balance. Unsolicited USDC sent to
   the factory or to a wallet between flows is never spent by a flow. The existing
   `test_existingDustIsNotCountedIntoTheFlow` boundary carries over.
2. **Exact approval, exact charge.** Approve the returned renewer for exactly `price`. After the
   call, the payer's balance must have decreased by exactly `price`. Any remaining allowance is
   cleared. This replaces the forward quote; ENS still prices the renewal itself inside `renew`.
3. **Plan constraints.** `0 < price ≤ amount − GAS_ALLOWANCE`, `duration > 0`, ordinary `CALL`
   with zero native value, and the call must succeed. The target must not be the factory, the
   calling wallet, or USDC. The existing context guards distinguish execution location and
   immediate caller; they are not a target allowlist, so these rejections are explicit.
4. **Reentrancy.** One guard in factory storage covers every payment entrypoint. A wallet can only
   be entered by the factory, and the factory's payment entrypoints are guarded, so calldata aimed
   back at either cannot start a second settlement.
5. **Event order.** `HelperUsed` immediately before `Renewed`; `Renewed` before
   `DepositProcessed` on the direct path; `CCTPClaimed` before ENS executes on the CCTP path.

## Trust

The adapter's payment authority is comparable to today's: it can direct at most the quoted price
of one payment, only after ENS governance activates it. The execution model changes: today the
adapter spends a budget it holds; in the new design it chooses a target and calldata that the
factory executes under an exact approval cap and an exact balance check. An exact balance decrease
proves expenditure. It does not prove that the named label received the reported duration; that
correspondence relies on governance selecting a correct adapter, as it effectively does today, and
on the off-chain adapter fingerprint check.

Removed trust points: the `l1Helper` value that each L2 had to configure correctly or misdirect
every mint permanently, and the residue recipient role. No Namepass key can move deposited funds
at any stage.

The factory gains the CCTP parsing code. The burn destination is already unreplaceable, so this
adds no new permanence, but the audit must cover the final form. ENS sees the wallet or the
factory as `msg.sender`; ENS keys nothing on the payer, and the referrer travels in calldata.

## Benchmarks

The core of the new direct path was measured with a disposable harness on the same fork block,
same label, against the real V1 renewer and real USDC. The harness performed exactly the steps
above and emitted the three events. It omitted the factory's label hashing and the proxy dispatch.

| Path | Steady state | First use for a name |
| --- | --- | --- |
| Current, five contracts, measured | 305,351 | 489,531 |
| Merged core, measured | 160,363 | 291,562 |
| Merged, estimated complete | about 166,000 | about 341,000 |

The estimate adds about 6k for label hashing and proxy dispatch. The first-use estimate also adds
about 41k for the wallet's CREATE2 deployment and about 2.5k for `WalletDeployed`.

Of the estimated 166k, 82k is ENS and 23k is the one unavoidable USDC approval, leaving about 61k
of Namepass overhead, down from about 220k. About 44k of the ENS figure is the V1 migration
bridge, which disappears as names migrate; a native V2 renewal is about 38k inside ENS.

These are warm-state execution figures inside one test. A real transaction adds intrinsic gas,
calldata, cold account and storage accesses, and is subject to the EIP-3529 refund cap. The
current path sits at that cap; the merged path does not, so its approval refund is fully
realized. The relative saving is expected to hold or improve, because the merged path touches
three fewer contracts cold, but the figures remain provisional until the complete implementation
is benchmarked from full transaction receipts for direct V1, direct V2, first use, and CCTP, with
the compiled factory size verified under the pinned settings. The CCTP claim was not measured
end to end because it needs a live Circle attestation; estimated from the measured components,
Namepass overhead after the mint drops by about 85k to 90k. The harness, adapter copy, and traces
will be committed as opt-in fork tests so the numbers can be reproduced.

## Backend changes

The event schema and database do not change. The following code does. All of it is bounded and
has existing tests to update.

| Area | File | Change |
| --- | --- | --- |
| Direct-payment verification | `server/allocation-evidence.ts` | Today requires exactly one wallet debit, for the whole amount, to the gateway. The new path has two debits: `amountApplied` to ENS's payee and `amount − amountApplied` to the executor. Verify that the debits in the segment sum to `amount`, that the executor debit equals `amountReceived − amountApplied`, and reconcile with `Renewed`. Hash pin and emitter address move to the new factory. |
| Processing and renewal evidence | `server/processing-renewal-evidence.ts` | `FACTORY_HASH` and `GATEWAY_HASH` pins become the new factory hash. Gateway logs are read from the configured address, which becomes the factory. `HelperUsed` selection and the adapter fingerprint assertion are unchanged in shape. |
| Receipt parsing | `server/ethereum.ts` | Emitter addresses come from configuration; the one-pair-per-receipt rule stays because batching is deferred. |
| Discovery | `src/lib/helperDiscovery.ts` | Accept `interfaceVersion` 2 and reject 1. Equality checks against the gateway and pointer pass through the factory shims. |
| Adapter fingerprint | `scripts/generate-helper-adapter.mjs`, `src/lib/helperAdapter.generated.ts` | Point at the new adapter artifact and regenerate. |
| Configuration | `src/lib/chains.ts` | New factory address and deployment blocks on all four testnets; gateway and pointer addresses set to the factory; the pending-burn drain block for the old deployment. |
| Pipeline | `goldsky/generate-testnet.mjs`, `goldsky/namepass-testnet.yaml` | Regenerate with the new addresses and start blocks. Deduplicate identical addresses in the raw-log filter. |
| Fixtures and tests | `test/fixtures/*`, `server/*.test.ts` | Replace recorded receipts with receipts from the new deployment's canaries. |
| Tools | `tools/helper-deployment`, `tools/payment-canary`, `tools/activation-canary` | Read `currentHelper` from the configured pointer address, which becomes the factory. |
| Contracts and Foundry tests | `contracts/*`, `test/*.t.sol` | New factory and adapter; rewritten renewal, CCTP, and pointer suites; pricing and fork compatibility tests preserved. |
| Documentation | `CONTRACTS_V2.md`, `ENGINEERING_CONSTRAINTS.md`, `DEPLOYMENTS.md`, `DECISIONS.md` | Removed forward quote, removed residue, merged roles, changed execution model, new addresses. |

## Testnet migration

Published deposit addresses and outstanding CCTP burns are bound to the current deployment.
Changing configuration does not redirect them.

1. Stop admitting new deposits to old addresses in the application once the new factory is
   deployed and verified.
2. Claim every outstanding burn through the old gateway before switching the hub configuration.
   Record the drain block.
3. Process any remaining old-wallet balances through the old factory, or document them as retained
   on the old deployment.
4. Reset application data as the September 22 cutover did, or version the verifiers' hash pins
   by deployment so September 22 evidence stays verifiable. The reset follows precedent and is
   simpler; choose it unless historical evidence must remain live.
5. Publish new addresses, regenerate the pipeline, run the canaries, and record the manifest.

## Deferred

- **`renewMany`.** `parseEthereumRenewalReceipt` requires exactly one event pair per receipt, a
  self-call per name replaces the executor with the factory unless passed explicitly, and guard
  placement needs its own design. Batching is not a launch requirement. The internal routine
  takes the executor as a parameter so batching can be added later with receipt processing updated
  at the same time.

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
documented check, and the exact approval plus post-call balance check already enforce the charge.

## Decisions

| Decision | Recommendation |
| --- | --- |
| Two-contract design | Proceed to implementation with the invariants and backend scope above. |
| Adapter returns calldata | Accept, with the plan constraints and `interfaceVersion` 2. |
| Dust goes to executor | Accept; pay only the current payment's remainder. |
| `renewMany` | Defer; keep the executor parameter so it can be added later. |
| Forward quote | Drop; keep exact approval, post-call check, pricing tests, and fork compatibility tests. |

## Method

Foundry 1.5.1 with the pinned compiler settings. Public Sepolia RPC. Fork block 11,900,165.
Nothing in this proposal is committed to the contract sources.
