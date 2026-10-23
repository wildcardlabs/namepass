# Status receipt captures

`october-reads.json` records the read-only HTTP status inspection of the user's
2026-10-23 Sepolia `vitalik.eth` canary on the two-contract deployment, recorded by
`scripts/fixtures/record-public-status.ts` with live providers and the route's own SQL
against a seeded local database. Its source transfer is
`0xba0a98186a197541cfb883bfce5d73be2b88dcac2478f80029ca107212081bbb`, log 200. Renewal
transaction `0x950ece3630e8bd89389e8c1d156d0c37f5c2d5d6e24dc21bc75b321cd92037ac` contains
the factory's renewal at log 232 and processing at log 233. Independent receipt values are
$1.00 received, $0.90 applied, 3,547,790 seconds and V1 registration expiry 3181308215.

Only database wire transport and provider responses are replaced in the replay.
Actual adapter SQL and receipt verifiers run. Contract code is deduplicated by hash.
The recorded capture contains no RPC URL, credential, Workflow ID or signed transaction.
The current direct CLI regression also uses this capture in a separate process.

`reads.json` is the September deployment's archived single-deposit capture. The local
activation/late-delivery regression still uses its source transfer, credited to the wallet
the current factory derives for the same label. Neither capture proves hosted polling capacity.
