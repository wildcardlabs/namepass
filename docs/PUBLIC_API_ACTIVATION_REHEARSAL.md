# Activation and watch propagation rehearsal

Date: 2026-10-06. Local application boundary verified. Hosted watch test prepared, not deployed.
Production public APIs remain disabled.

## What the local test proves

The new case in [public-address.test.ts](../server/public-address.test.ts) runs the real address
HTTP adapter, Goldsky webhook parser/store and status HTTP adapter against migrated PGlite.
Only database wire transport, read-only RPC replies and Workflow scheduling are replaced.
This is sequential PostgreSQL-compatible replay, not a concurrent PostgreSQL or hosted stream test.
The existing real PostgreSQL concurrency test remains separate and runs in required CI.

- A deposit delivery before name registration returns retryable `watched_address_missing` and
  rolls back its event write. Retrying after activation succeeds.
- Activation creates the watch and four zero balance snapshots. It clears the successful initial
  scan requests. This is registration and balance evidence, not acknowledgement from Goldsky.
- With the source event withheld, repeated status requests return `transaction_not_found` without
  RPC reads or deposit writes. Polling does not backfill a payment filtered out upstream.
- Late and duplicate webhook deliveries persist one event, one deposit and one queued flow.
  Both scheduling requests refer to the same durable flow ID. Workflow ownership itself is
  covered by the existing workflow tests, not replaced by the callback in this rehearsal.
- Once the source receipt is represented and finalized, status returns `processing`. Index
  delivery and a queued flow do not prove a renewal. No transaction intent is created.

The historical Sepolia source receipt is reused from the checksum-pinned status fixture. The
local activation timestamp is pinned before that receipt so this replay does not confuse a
historical payment with a new live activation. No hosted data or wallet changed for the test.

## Remaining question

A returned address does not establish when the running pipeline first sees its watch row.
The initial zero balance scan also does not cover a later transfer. We must measure the actual
filter boundary, including any payment evaluated before watch visibility. These observations do
not show that production has dropped a payment; that requires hosted evidence.

Read-only inspection confirmed that `namepass-testnet-v2` is ACTIVE and uses the committed
`goldsky.watched_addresses` / `updated_at` lookup and `dynamic_table_check` filter. Goldsky
[documents live membership updates](https://docs.goldsky.com/turbo-pipelines/transforms/dynamic-tables).
The upstream [runtime reference](https://github.com/goldsky-io/streamling#dynamic-tables) describes
optional caching. Neither reference nor the pipeline definition establishes the deployed cache
setting or an acknowledgement barrier for this application. Do not assume a cache interval or
change the production writer protocol from that reference alone.

## Prepared hosted test

[The proposed YAML](deployments/2026-10-06/public-api-watch-rehearsal.yaml) creates only
`namepass-api-watch-rehearsal`, at resource size `s`. It selects Sepolia USDC transfers to
`0x16CfEB29157376F55e7976562a850d04435C171d` (`farcaster.eth`). A bounded read-only ENS check
confirmed this name uses V1 and is renewable. It is absent from the seven-name staging fixture.
The YAML passed the installed Goldsky validator without applying it.
Both source and watch-filter outputs use a
[blackhole sink](https://docs.goldsky.com/turbo-pipelines/sinks/blackhole), inspected live.
There is no webhook sink, payment executor, production database credential or public API setting.
This is a watch visibility test, not an end-to-end renewal canary.

After separate approval:

1. Create a dedicated SELECT-only `api_watch_reader` on isolated `api-staging`, limited to
   `goldsky.watched_addresses`, and a new `NAMEPASS_API_STAGING_WATCH_READER` Goldsky secret.
   Preserve all existing reader credentials, rows and settings. Assert the canary watch is absent.
2. Start only the prepared pipeline. Record its definition checksum, runtime image and live state.
   Compare the runtime image with production; a different image limits this to rehearsal-version
   evidence. Do not update or restart the production pipeline. Inspect both named output nodes.
3. The user signs a 0.50 testnet-USDC Sepolia transfer before the staging watch is added. Match
   its exact canonical source hash/log position in the unfiltered output. Record whether it is
   absent from the watch-filter output; pipeline latency alone cannot establish that conclusion.
4. Insert only the canary watch into staging, then have the user sign a second 0.50-USDC transfer.
   Record watch commit time, source receipt time and both output identities. Check whether the
   first transfer reappears after membership changes, rather than assuming retroactive replay.
5. Restart only the rehearsal pipeline without clearing state. A third user-signed 0.50-USDC
   transfer checks membership after restart. Record duplicate identities separately from missing
   events. Do not change source names or reset checkpoints.
6. Pause the rehearsal after the three cases or at the agreed observation limit. Preserve the
   evidence; remove only this newly inserted watch and the rehearsal-owned pipeline/secret/role
   when cleanup is approved. Compare the original staging rows and counts before/after.

Observe for at most twenty minutes from pipeline startup; pause on timeout and
report an inconclusive case instead of extending the run silently. Hosted compute uses Goldsky
billing. All three transfers total 1.50 testnet USDC; wallet gas is separate. `farcaster.eth` is
already watched by the existing production application, so its ordinary renewal automation may
process those payments. No new production activation or automation setting is needed or approved
by this prepared configuration. Funding requires the user's wallet signatures.

Do not enable address activation or attach an automatic webhook writer to this rehearsal. If
visibility leaves an unrecoverable interval, propose the smallest change to the existing core
activation/recovery path in a separate review. Do not add a queue, verification worker or API
schema to conceal a gap. Positive hosted direct/Sepolia and Base/Arbitrum status, fresh aggregate
funding and public capacity remain separate release gates.
