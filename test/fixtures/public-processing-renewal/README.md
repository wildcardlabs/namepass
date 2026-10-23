# Public processing/renewal receipt fixtures

`receipts.json` contains five read-only RPC/Circle captures of the 2026-10-23 canaries on the
two-contract deployment, recorded with `scripts/fixtures/record-processing-renewal.ts` after
Sepolia finality passed every block: two equal one-USDC Arc processing calls for `steve.eth`
(native and ERC-20 deposits, V2 registrar), the direct Sepolia renewal of `vitalik.eth` (V1
renewer, with the BaseRegistrar discovery read and both extension/synchronization events), the
Base Sepolia claim for `skellat.eth` (V2) and the Arbitrum Sepolia claim for `farcaster.eth` (V1).
Each case records its exact transaction hashes and log positions. Receipt identities/logs are
retained; unrelated block fields and Circle convenience fields are omitted. Identical runtime
responses are deduplicated by Keccak-256 in `codes`.

Expected expiry, duration and charged amount assertions come from the authoritative ENS
events in these public receipts. The tests replay a transport boundary; they do not execute
contracts or prove provider trust, live batching, pooling, or source-deposit completion.
The two-call test combines the two Arc call segments into a synthetic transaction with
consistent metadata and distinct global log positions, then tests the exact ordered
message/claim mapping. Deployed runtime provenance is in the
[deployment manifest](../../../docs/deployments/2026-10-23/protocol-deployment-manifest.json).
