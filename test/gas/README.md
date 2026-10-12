# Gas measurement harness

Opt-in fork tests behind `docs/GAS_REDESIGN_PROPOSAL.md`. They skip without `NAMEPASS_FORK_RPC`,
so `forge test` in CI is unaffected. They broadcast nothing.

```sh
NAMEPASS_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com \
NAMEPASS_FORK_BLOCK=<recent block> \
  forge test --match-path "test/gas/*" -vv
```

Pass a recent block: the public node prunes state after a few days. Run both tests in one
invocation so they fork the same block. Add `-vvvv` for the per-call trace that the proposal's
cost breakdown comes from.

| File | What it measures |
| --- | --- |
| `CurrentPathGasFork.t.sol` | The current five-contract direct path, built from source, renewing `vitalik` through the live V1 renewer and the real USDC proxy. |
| `MergedCoreGasFork.t.sol` | The merged design's settlement routine: plan from a view-only adapter, exact approval, execute, balance delta, pay the executor, emit the three events. It omits the factory's label hashing and the proxy dispatch. |
| `MergedCoreAdapter.sol` | `ENSV2RenewalHelper` with `execute` replaced by a view `plan`. A measurement fixture, not the proposed adapter. |
| `five-contract-trims.patch` | The smaller option: apply to `contracts/`, run `CurrentPathGasFork.t.sol`, then revert. |

All printed figures are warm-state execution gas inside one test. They exclude intrinsic gas,
calldata, cold accesses already paid earlier in the test, and the EIP-3529 refund cap. They are
for comparison between designs, not acceptance criteria.

## Recorded runs

Sepolia, direct V1 route, `vitalik`, 27.11 USDC per renewal.

| Block | Current #1 first use | Current steady | Merged core #1 | Merged core steady |
| --- | --- | --- | --- | --- |
| 11,900,165 | 489,531 | 305,351 | 291,562 | 160,363 |
| 11,900,663 | 489,537 | 305,361 | 291,640 | 160,444 |

Smaller option at block 11,900,165, cumulative, steady state: duplicate balance reads removed
302,148; conditional allowance clears 298,170; forward quote dropped 285,231.
