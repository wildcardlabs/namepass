# Proposal: two-contract protocol for lower renewal gas

Date: 2026-10-12, revised after review. Status: proposal, not implemented. Testnet only; no
mainnet deployment exists, so addresses are not yet fixed.

Revision notes: the first version claimed the backend needed only configuration changes and that
trust was unchanged. Both were wrong. This version scopes the backend work, states the settlement
invariants explicitly, describes the adapter change as a changed execution model with comparable
payment authority, corrects the figures, defers batching, and adds a testnet cutover plan.

## Summary

Merge the gateway and the pointer into the factory, and make the ENS helper a view-only adapter
that never holds funds. Measured on the live Sepolia gas schedule, which has run Glamsterdam's
state repricing since 2026-10-06, a direct Ethereum renewal saves about 80k gas: 20% on the V1
route and 27% on the native V2 route. On the pre-fork schedule, from mined receipts on an Anvil
fork, the saving is about 95k, and a CCTP claim saves about 43k excluding Circle's share. Mainnet
is planned to adopt the same repricing in the fourth quarter of 2026, so the live figures are the
ones to plan around. Every indexed event keeps its signature, fields, and order, so the Goldsky
pipeline and the database schema do not change. The backend evidence verifiers, discovery,
fixtures, and configuration do change; that work is scoped below and is doable. Two
configuration trust points are removed. The right time to do this is now, before the independent
audit and before any mainnet deployment.

An earlier draft claimed about 45%. That figure came from warm-state execution gas inside one
test, which hides refunds and cold accesses. At transaction level the current design's
approve-and-clear refunds are realized, so the removed hops cost less than they appeared to, and
the live schedule narrows the gap a little further. The corrected figures are in Benchmarks.

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
  adapter for a plan, approves the returned spender for exactly the returned price, executes the
  returned calldata against the returned renewer, requires that its balance fell by exactly that
  price, clears any residual allowance, and transfers `amount − price` to the executor. The wallet returns the figures and
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
`plan(label, budget)` that returns the renewer to call, the spender that pulls the payment,
duration, price, and renewal calldata. For ENS V2 the spender is the renewer itself; the separate
field lets a future ENS route payment through another contract without a factory change. It keeps
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
2. **Exact approval, exact charge.** Approve the returned spender for exactly `price`. After the
   call to the returned renewer, the payer's balance must have decreased by exactly `price`. Any
   remaining allowance to the spender is cleared. This replaces the forward quote; ENS still prices the renewal itself inside `renew`.
3. **Plan constraints.** `0 < price ≤ amount − GAS_ALLOWANCE`, `duration > 0`, ordinary `CALL`
   with zero native value, and the call must succeed. The target and the spender must be contracts,
   and neither may be the factory, the calling wallet, or USDC. The existing context guards distinguish execution location and
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

Two schedules matter. Sepolia activated Glamsterdam on 2026-10-06, which reprices state access
and creation (EIP-8037 and EIP-8038); Foundry's EVM does not implement it yet. Mainnet is planned
to follow in the fourth quarter of 2026.

**Live schedule.** Traced on an archive node at block 11,900,999 with state overrides that place
the merged factory and adapter at their deterministic addresses and fund the deposit wallet. The
node's root `gasUsed` is what a transaction pays; it matched a recorded claim's receipt exactly.
`vitalik` is a premigrated reservation on the V1 route; `skellat` is a migrated V2 name.

| Transaction | Current | Merged | Saving |
| --- | --- | --- | --- |
| Direct V1, first use | 656,750 | 576,935 | 79,815 (12%) |
| Direct V1, steady state | 389,508 | 309,694 | 79,814 (20%) |
| Direct V2, steady state | 291,126 | 211,268 | 79,858 (27%) |

These merged figures are for the Cancun build with the transient-storage guard at block
11,901,276; the Shanghai build with a storage guard measured 2k higher on each row.

**Pre-fork schedule.** `gasUsed` from mined receipts on an Anvil fork at block 11,900,886, with
CCTP claims using a stand-in transmitter that excludes Circle's share, about 117k on a real claim.

| Transaction | Current | Merged | Saving |
| --- | --- | --- | --- |
| Direct V1, first use | 404,724 | 318,888 | 85,836 (21%) |
| Direct V1, steady state | 369,700 | 275,109 | 94,591 (26%) |
| Direct V2, steady state | 289,074 | 194,183 | 94,891 (33%) |
| CCTP claim V1, excluding Circle | 363,931 | 320,487 | 43,444 (12%) |
| CCTP claim V2, excluding Circle | 283,049 | 239,561 | 43,488 (15%) |

The saving is about 80k per direct renewal on the live schedule and about 95k before the fork.
The approvals the redesign removes are transient slots whose creation cost is refunded when they
clear within the transaction, so the repricing adds little to them; the repriced cold access that
remains is mostly in ENS and USDC. Wallet creation becomes much dearer under the new schedule,
about 267k on a first use, on both designs alike. CCTP claims could not be traced live without an
attestation; two recorded claims on the current release after the fork paid 586,408 and 567,397
gas, and the merged design's live claim saving is estimated at about 40k.

Warm-state execution gas inside one fork test, the call-tree comparison the first draft used,
shows 305,351 against 169,846 steady state on the V1 route, 114,120 on the V2 route, and
489,531 against 332,821 first use. ENS's own work is about 82k at warm prices on the V1 route,
of which about 44k is the V1 migration bridge, and about 38k on the V2 route. The absolute saving
is the same on both routes, so the percentage grows as names migrate. See `test/gas/README.md`
for every method.

## Glamsterdam

Sepolia activated Glamsterdam on 2026-10-06; mainnet is planned for the fourth quarter of 2026
with no confirmed date. The parts that touch this design, with the EIP figures:

- **State creation, EIP-8037.** A new storage slot costs 97,920 state gas instead of 20,000,
  refilled if the slot is cleared in the same transaction. A new account costs 183,600 instead of
  25,000, and code deposit costs 1,530 per byte instead of 200. Consequences measured live: a
  deposit wallet's creation is about 267k instead of about 44k; deploying the 13,352-byte factory
  is 21.4M gas by the node's estimate, and the October helper deployment, 7,589 bytes, paid
  11.96M. The approve-and-clear hops stay cheap because their slots are refilled.
- **State access, EIP-8038.** Any storage write that changes a value costs 10,000 instead of
  about 2,900, cold account access 3,000 instead of 2,600, and the clear refund 11,616 instead of
  4,800. This is why steady-state renewals rose on both designs, mostly inside USDC and ENS. The
  factory's reentrancy guard uses transient storage, so the factory writes no persistent state
  during a renewal; measured live, that is worth about 2k per renewal against a storage guard,
  because a slot restored to its original value in the same transaction is refunded. It needs the
  Cancun target, which creation calls confirmed on all four testnets and on Arc mainnet on
  2026-10-12, so the new set is compiled for Cancun.
- **Transaction gas cap.** Fusaka's EIP-7825 caps a transaction at 16,777,216 gas, below the
  factory's deployment cost. Sepolia is including transactions with 30M gas limits after
  Glamsterdam, so the cap is not binding there. Mainnet runs the cap today, so the factory can be
  deployed there either before Glamsterdam, at about 3M gas on the pre-fork schedule, or after it
  if the cap is lifted as on Sepolia. Shrinking the factory below about 10.4 KB would remove the
  dependency; `via_ir` reaches 11.9 KB and the pinned settings 13.4 KB.
- **Executor balance.** Paying the executor into a zero USDC balance now creates a slot at
  97,920 gas. The relayer must keep a nonzero USDC balance.
- **`GAS` returns execution gas only.** State gas is separate. The contracts do not read
  `gasleft()`; the warm-state harness does, so its figures understate the live cost further.
- **Not relevant to the contracts.** Block-level access lists, ePBS, the 200M gas limit, the
  64 KB contract size limit, ETH transfer logs, and the deterministic factory predeploy at `0x12`.
  The L2s do not run Glamsterdam; their deposit-side costs are unchanged.

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
- **Approving the call target only.** Rejected in favor of a separate spender field, so an ENS
  that routes payment through another contract needs a new adapter, not a new factory.
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
