# Public processing/renewal receipt fixtures

`receipts.json` contains four read-only RPC/Circle captures from 2026-10-06: two equal
one-USDC Arc processing calls for `steve.eth` one direct Sepolia processing call, and a V1 renewal for `vitalik.eth`.
The V1 case retains the BaseRegistrar discovery read and both extension/synchronization events.
Each case records its exact transaction hashes and log positions. Receipt identities/logs
are retained; unrelated block fields and Circle convenience fields are omitted. Identical
runtime responses are deduplicated by Keccak-256 in `codes`.

Expected expiry, duration and charged amount assertions come from the authoritative ENS
events in these public receipts. The tests replay a transport boundary; they do not execute
contracts or prove provider trust, live batching, pooling, or source-deposit completion.
The two-call test combines the two historical call segments into a synthetic transaction
with consistent metadata and distinct global log positions, then tests the exact ordered
message/claim mapping. Deployed runtime provenance is in the
[verification record](../../../docs/deployments/2026-09-22/verification.json).
