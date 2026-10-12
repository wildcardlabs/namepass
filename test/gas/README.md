# Gas measurement harness

Two measurements back `docs/GAS_REDESIGN_PROPOSAL.md`. Neither broadcasts anything.

## Receipt-level benchmark

`benchmark.mjs` drives an Anvil fork of Sepolia. It deploys the two-contract design from the
local artifacts, exercises the direct V1 route and a CCTP claim, and runs the same flows against
the deployed five-contract testnet release. Every figure is `gasUsed` from a mined receipt: what a
relayer pays, with intrinsic gas, calldata, cold accesses and the EIP-3529 refund cap included.
`BenchTransmitter.sol` replaces Circle's transmitter for the claims, so Circle's attestation check
and mint, which are fixed costs outside this design, are excluded from both columns.

```sh
anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --fork-block-number <recent> \
  --auto-impersonate --port 8545 --silent &
forge build
node test/gas/benchmark.mjs
```

Sepolia fork at block 11,900,829, `vitalik` through the live V1 renewer, 27.11 USDC per payment:

| Transaction | Current, five contracts | Merged, two contracts | Saving |
| --- | --- | --- | --- |
| Direct renewal, first use | 404,724 | 318,287 | 86,437 (21%) |
| Direct renewal, steady state | 369,700 | 274,508 | 95,192 (26%) |
| CCTP claim, excluding Circle | 363,931 | 319,886 | 44,045 (12%) |

The transaction-level saving is smaller than the warm-state execution delta below because, at
transaction level, the current design's approve-and-clear refunds are realized: the cold accesses
of a real transaction raise `gasUsed` and therefore the refund cap. The removed hops cost about
50k gross each but only about 10k after refunds; the real savings come from the forward quote,
the residue write, the pointer and gateway calls, the balance reads, and three fewer contracts
touched cold.

## Warm-state execution measurement

`RenewalGasFork.t.sol` is an opt-in fork test that prints execution gas inside one test. It skips
without `NAMEPASS_FORK_RPC`, so `forge test` in CI is unaffected.

```sh
NAMEPASS_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com \
NAMEPASS_FORK_BLOCK=<recent block> \
  forge test --match-path "test/gas/*" -vv
```

These figures exclude intrinsic gas, calldata, cold accesses already paid earlier in the test,
and the refund cap. They are for comparing call trees, not for what a relayer pays.

| Block | Design | First use | Steady state |
| --- | --- | --- | --- |
| 11,900,165 | Current, five contracts | 489,531 | 305,351 |
| 11,900,818 | Merged, two contracts | 332,220 | 169,241 |

The public node prunes state after a few days, so pass a recent block.
