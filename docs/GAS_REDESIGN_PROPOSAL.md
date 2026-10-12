# Proposal: two-contract protocol for lower renewal gas

Date: 2026-10-12, revised after review. Status: proposal, not implemented. Testnet only; no
mainnet deployment exists, so addresses are not yet fixed.

Revision notes: the first version claimed the backend needed only configuration changes and that
trust was unchanged. Both were wrong. This version scopes the backend work, states the settlement
invariants explicitly, describes the adapter change as a changed execution model with comparable
payment authority, corrects the figures, defers batching, and adds a testnet cutover plan.

## Summary

Merge the gateway and the pointer into the factory, and make the ENS helper a view-only adapter
that never holds funds. Measured from mined transaction receipts on an Anvil fork of Sepolia,
against the deployed testnet release, a direct Ethereum renewal drops from 369,700 to 274,508
gas, a 26% saving, and a CCTP claim drops from 363,931 to 319,886, a 12% saving excluding
Circle's fixed share. Every indexed event keeps its signature, fields, and order, so the Goldsky
pipeline and the database schema do not change. The backend evidence verifiers, discovery,
fixtures, and configuration do change; that work is scoped below and is doable. Two
configuration trust points are removed. The right time to do this is now, before the independent
audit and before any mainnet deployment.

An earlier draft claimed about 45%. That figure came from warm-state execution gas inside one
test, which hides refunds and cold accesses. At transaction level the current design's
approve-and-clear refunds are realized, so the removed hops cost less than they appeared to. The
corrected figures are in Benchmarks.

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
- **Executor threaded explicitly** through the internal settlement routine. Batching is deferred;
  see Deferred for what adding it later would require.

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

Receipt-level figures, `gasUsed` from mined transactions on an Anvil fork of Sepolia at block
11,900,829, renewing `vitalik` through the live V1 renewer with 27.11 USDC. The current column is
the deployed five-contract testnet release; the merged column is the implemented two-contract
design from the local artifacts. CCTP claims replace Circle's transmitter with a stand-in that
pays the minted amount, so Circle's attestation check and mint are excluded from both columns.
See `test/gas/README.md` for the method.

| Transaction | Current | Merged | Saving |
| --- | --- | --- | --- |
| Direct renewal, first use | 404,724 | 318,287 | 86,437 (21%) |
| Direct renewal, steady state | 369,700 | 274,508 | 95,192 (26%) |
| CCTP claim, excluding Circle | 363,931 | 319,886 | 44,045 (12%) |

Warm-state execution gas inside one fork test, which is the call-tree comparison the first draft
used, shows 305,351 against 169,241 steady state and 489,531 against 332,220 first use. The
difference between the two views is refunds: at transaction level, cold accesses raise `gasUsed`
and therefore the EIP-3529 refund cap, so the current design's approve-and-clear pattern refunds
almost all of its approval cost. Each removed hop therefore saves about 10k after refunds rather
than 50k. The transaction-level savings come from the forward quote, the residue write, the
pointer and gateway calls, the redundant balance reads, and three fewer contracts touched cold.

Of the merged steady-state receipt, ENS's own work is about 82k at warm prices and more when
cold. About 44k of that is the V1 migration bridge, which disappears as names migrate; a native V2
renewal is about 38k inside ENS. A native V2 route was not benchmarked because the October
registrar's registration interface is not vendored; it should be added when a V2-renewable
testnet name is available.

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
| Configuration | `src/lib/chains.ts` | New factory address and deployment blocks on all four testnets; gateway and pointer addresses set to the factory. |
| Pipeline | `goldsky/generate-testnet.mjs`, `goldsky/namepass-testnet.yaml` | Regenerate with the new addresses and start blocks. Deduplicate identical addresses in the raw-log filter. |
| Fixtures and tests | `test/fixtures/*`, `server/*.test.ts` | Replace recorded receipts with receipts from the new deployment's canaries. |
| Tools | `tools/helper-deployment`, `tools/payment-canary`, `tools/activation-canary` | Read `currentHelper` from the configured pointer address, which becomes the factory. |
| Contracts and Foundry tests | `contracts/*`, `test/*.t.sol` | New factory and adapter; rewritten renewal, CCTP, and pointer suites; pricing and fork compatibility tests preserved. |
| Documentation | `CONTRACTS_V2.md`, `ENGINEERING_CONSTRAINTS.md`, `DEPLOYMENTS.md`, `DECISIONS.md` | Removed forward quote, removed residue, merged roles, changed execution model, new addresses. |

## Testnet cutover

The current beta deployment is disposable, including its deposit addresses, and there are no
flows in progress. The cutover is therefore a replacement, not a migration, following the
September 22 precedent. The step-by-step plan, including every wallet transaction, is in
[GAS_REDESIGN_PLAN.md](GAS_REDESIGN_PLAN.md).

1. Deploy the new factory on all four testnets and the adapter on Sepolia; verify source,
   creation hash, configuration, and owner.
2. Reset application data. Old deposit addresses are no longer shown or processed, and the old
   deployment is not indexed. Its manifest stays under `docs/deployments/` as history.
3. Update `chains.ts`, regenerate the pipeline, regenerate the adapter fingerprint, replace the
   receipt fixtures, and update the verifier hash pins.
4. Run one canary per chain through the new path and record the manifest in `docs/DEPLOYMENTS.md`.

If a user funds an old address after the reset, the old factory still accepts a permissionless
`renew` call, but the application will not see or process it. The beta copy should say that old
addresses are retired. On mainnet none of this arises, because there is no prior deployment.

## Deferred

- **`renewMany`.** `parseEthereumRenewalReceipt` requires exactly one event pair per receipt, a
  self-call per name replaces the executor with the factory unless passed explicitly, and guard
  placement needs its own design. Batching is not a launch requirement. The factory is immutable,
  so deferring it means it cannot be added to the deployed factory later. Later batching would
  need either a separate batching contract that calls `renew` per name and forwards the executor
  payments it receives, or another factory deployment and address migration. Keeping the executor
  as an explicit parameter of the internal routine makes the first option cleaner; it does not
  make batching free. Deferral remains the right decision.

## Considered and rejected

- **Standing USDC approval from the factory to ENS.** Execution estimate, not a transaction
  measurement: the per-renewal `approve` measures 23,241 in the fork trace and refunds 19,900
  under EIP-3529 when the pull clears it, so it nets about 3.4k when the refund is realized. Circle's
  USDC decrements a standing allowance on every pull, a nonzero-to-nonzero write of about 5k with
  no refund. Gross gas would fall by about 18k while the net paid rises by about 1.6k, assuming the
  merged path stays under the refund cap. It also reaches only the CCTP path, needs re-granting
  when ENS rotates renewers, and adds a permission surface.
- **Transient-storage reentrancy guard.** Needs Cancun; the compiler target is pinned at Shanghai
  because Arc does not support newer.
- **Caller-proposed duration verified on-chain.** Costs about the same as computing it.
- **Trimming events.** Changes the schema.
- **Dropping the executor payment.** Removes the permissionless completion incentive.
- **Dropping the reentrancy guard.** Saves about 2k net. Kept as defense in depth.
- **Computing the wallet address in a second place.** Saves about 1k and duplicates derivation
  logic in a permanent contract.

## Smaller option if the redesign is declined

Within the current five contracts, two duplicate balance reads can be removed for 3,203, the two
allowance clears can become conditional for another 3,978, and the forward quote can be dropped
for another 12,939, a cumulative 20,120 or 6.6% of the 305,351 baseline. These are warm-state
execution measurements of the full current path on the fork, direct V1 route, steady state, from
`CurrentPathGasForkTest` with the patch in `test/gas/five-contract-trims.patch` applied; they
exclude intrinsic gas, calldata, and the refund cap, and cover no other scenario. All three passed
the full suite. Only the last changes a documented check, and the exact approval plus post-call
balance check already enforce the charge.

## Decisions

| Decision | Recommendation |
| --- | --- |
| Two-contract design | Proceed to implementation with the invariants and backend scope above. |
| Adapter returns calldata | Accept, with the plan constraints and `interfaceVersion` 2. |
| Dust goes to executor | Accept; pay only the current payment's remainder. |
| `renewMany` | Defer. The factory is immutable, so later batching needs a separate batching contract or a new factory; the explicit executor parameter keeps the first option clean. |
| Forward quote | Drop; keep exact approval, post-call check, pricing tests, and fork compatibility tests. |

## Method

Foundry 1.5.1 with the pinned compiler settings. Public Sepolia RPC. Fork block 11,900,165 for
the figures in this document. The harness is committed as opt-in fork tests that skip without an
RPC:

```sh
NAMEPASS_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com \
NAMEPASS_FORK_BLOCK=<recent block> \
  forge test --match-path "test/gas/*" -vv
```

`test/gas/CurrentPathGasFork.t.sol` measures the current five-contract direct path built from
source. `test/gas/MergedCoreGasFork.t.sol` measures the merged design's settlement routine with
`test/gas/MergedCoreAdapter.sol`, a copy of the helper with `execute` replaced by `plan`.
`test/gas/five-contract-trims.patch` is the smaller option. `test/gas/README.md` records the
runs. The public node prunes state after a few days, so pass a recent block. All figures are
warm-state execution gas inside one test and are not acceptance criteria; the acceptance
benchmark is full transaction receipts from the complete implementation, as listed under
Benchmarks. Nothing in this proposal is committed to the contract sources.
