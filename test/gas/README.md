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

Sepolia fork at block 11,900,886, 27.11 USDC per payment. V1 route: `vitalik`, a premigrated
reservation renewed through `ETHRenewerV1` with its V1 bridge. V2 route: `skellat`, a migrated name
renewed through the V2 registrar.

| Transaction | Current, five contracts | Merged, two contracts | Saving |
| --- | --- | --- | --- |
| Direct V1, first use | 404,724 | 318,888 | 85,836 (21%) |
| Direct V1, steady state | 369,700 | 275,109 | 94,591 (26%) |
| CCTP claim V1, excluding Circle | 363,931 | 320,487 | 43,444 (12%) |
| Direct V2, first use | see note | 237,962 | |
| Direct V2, steady state | 289,074 | 194,183 | 94,891 (33%) |
| CCTP claim V2, excluding Circle | 283,049 | 239,561 | 43,488 (15%) |

Note: the current release already has a deployed `skellat` wallet on Sepolia, so its V2 first-use
row equals its steady state and is omitted.

The transaction-level saving is smaller than the warm-state execution delta below because, at
transaction level, the current design's approve-and-clear refunds are realized: the cold accesses
of a real transaction raise `gasUsed` and therefore the refund cap. The removed hops cost about
50k gross each but only about 10k after refunds; the real savings come from the forward quote,
the residue write, the pointer and gateway calls, the balance reads, and three fewer contracts
touched cold. The absolute saving is about 95k on a direct renewal and about 43k on a claim on
either route, so the percentage is higher on the cheaper V2 route.

## Live Sepolia schedule

Sepolia activated Glamsterdam on 2026-10-06, which reprices state access and creation (EIP-8037
and EIP-8038). Foundry 1.5.1's EVM does not implement it, so the Anvil figures above are on the
pre-fork schedule. `live-schedule.mjs` measures both designs on the live schedule instead: it
asks an archive node to trace `renew` with state overrides that place the merged factory and
adapter, taken from a completed dry run on Anvil, at their deterministic addresses, and give the
deposit wallet a balance. The root `gasUsed` of the node's call trace is what a transaction pays;
on a recorded claim it matched the receipt exactly. Nothing is broadcast.

Block 11,900,999, 27.11 USDC per payment:

| Transaction | Current, five contracts | Merged, two contracts | Saving |
| --- | --- | --- | --- |
| Direct V1, first use | 656,750 | 578,934 | 77,816 (12%) |
| Direct V1, steady state | 389,508 | 311,693 | 77,815 (20%) |
| Direct V2, steady state | 291,126 | 213,267 | 77,859 (27%) |
| Direct V2, first use, merged only | | 480,508 | |

The current release's `skellat` wallet is already deployed, so it has no first-use row. The
saving is about 78k per direct renewal on either route, a little below the 95k on the pre-fork
schedule: the approvals the redesign removes are transient slots whose creation cost is refunded
when they clear in the same transaction, while the repriced cold state access that remains is
mostly in ENS and USDC. Wallet creation is much dearer under the new schedule, about 267k on a
first use against about 44k before, on both designs alike.

CCTP claims cannot be traced live without a Circle attestation. Two recorded claims on the
current release after the fork, `0x1bfa297b…ba488` and `0xc6074d5b…5cc6c`, paid 586,408 and
567,397 gas; the Anvil benchmark's pre-fork figure for that path is 363,931 plus Circle's share.
The merged design's claim saving on the live schedule is estimated at about 40k, not measured.

Mainnet is planned to activate Glamsterdam in the fourth quarter of 2026, so the live-schedule
figures are the ones to plan around.

## A real claim on the current release

Transaction `0x1bfa297b…ba488` on Sepolia (block 11,858,547) is a CCTP claim for `farcaster`
through the current five-contract release, the first claim after the October adapter rotation
and the first block hours after Glamsterdam activated. Its receipt reports 586,408 gas. A local
replay with `cast run`, which uses the pre-fork schedule, gives this call-level split and totals
445,388; the 141k difference is the repricing:

| Part | Gas |
| --- | --- |
| Circle `receiveMessage`: attestation check, nonce, mint | 116,573 |
| ENS `renew`, V1 route with its V1 bridge | 139,812 |
| Helper: oracle reads, forward quote, pull, approvals, balance reads | about 148,000 |
| Gateway: pointer and factory calls, approvals, balance reads, executor transfer, events | about 99,000 |

Circle's share on a real claim is therefore about 117k on the pre-fork schedule, which the
stand-in benchmark above excludes from both columns.

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

| Block | Design | Route | First use | Steady state |
| --- | --- | --- | --- | --- |
| 11,900,165 | Current, five contracts | V1 | 489,531 | 305,351 |
| 11,900,888 | Merged, two contracts | V1 | 332,821 | 169,846 |
| 11,900,888 | Merged, two contracts | V2 | 234,495 | 114,120 |

The public node prunes state after a few days, so pass a recent block.
