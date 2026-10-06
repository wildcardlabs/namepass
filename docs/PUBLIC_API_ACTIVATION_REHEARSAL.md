# Activation and watch propagation rehearsal

Date: 2026-10-06. Local application boundary verified. Additional-pipeline proposal withdrawn because
the current Goldsky plan does not allow another pipeline.
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

## Hosted checks within the current plan

Use the existing `namepass-testnet-v2` pipeline. Do not create another pipeline, database
reader or Goldsky secret. The previously validated blackhole-only YAML has been removed;
it was never applied. No staging watch was inserted and no test transfer was sent.

Start with read-only inspection. Any fresh transfer is a separate user-signed action:

1. Record the existing pipeline's state, definition checksum and runtime image, when exposed.
   Inspect `all_usdc_transfers` and `incoming_deposits` without changing the definition,
   sinks, watch table, source names or checkpoints. Do not pause or restart production.
2. Use existing indexed source receipts to compare transfer identities with deposit rows and
   renewal evidence. Historical agreement proves those deliveries, not first-watch visibility.
3. For a fresh delivery canary, subscribe to both existing output nodes before funding. The
   user may sign a 0.50 testnet-USDC Sepolia transfer to the existing `farcaster.eth` deposit
   address, `0x16CfEB29157376F55e7976562a850d04435C171d`, once capture is ready. A bounded
   read-only ENS check confirmed the name is V1 and renewable. Ordinary production automation
   can process this payment. Match its canonical transaction hash and log index across source,
   filtered output, indexed deposit and eventual renewal. Funding needs the user's signature.
4. End the inspection session after twenty minutes or after evidence is captured. Disconnecting
   inspection must leave the production pipeline running. Missing live output or an inspection
   timeout is inconclusive; it does not prove an event was dropped.

`farcaster.eth` is already watched in production. Funding it cannot measure the delay between a
new watch commit and first visibility. Nor can read-only inspection prove restart recovery or
that membership changes replay earlier filtered transfers. Those release gates remain open.
Do not relabel existing-watch delivery as new-activation coverage.

A first-watch test needs a separately reviewed canary through the existing application's normal
activation path, with an eligible name not already watched, capture before activation and
source/index evidence after it. Do not insert or delete production watch rows directly. Do not
restart the production pipeline to manufacture recovery evidence. If the current plan cannot
observe the required boundary safely, record the limitation and keep public activation disabled.

Do not enable address activation on an API preview or attach staging to the production stream.
If evidence shows an unrecoverable interval, propose the smallest change to the existing core
activation/recovery path in a separate review. Do not add a queue, verification worker or API
schema to conceal a gap. Positive hosted direct/Sepolia and Base/Arbitrum status, fresh aggregate
funding and public capacity remain separate release gates.

## Fresh existing-watch canary — October ENS helper

The user sent the proposed $0.50 Sepolia payment. Read-only inspection observed its
Transfer at the source node, then the watched output, and the database recorded it
from Goldsky. Processing exposed the old ENS renewer's revoked controller permission.
After the user rotated the helper through the existing timelock, ordinary automation
completed the same funded flow. Local status/history then verified the finalized
renewal under the October ENS addresses. See the
[exact canary and recovery receipt](deployments/2026-10-06/ens-october-api-canary.json).

This closes this existing-watch delivery and application-processing canary. It does
not close first-watch propagation, other source routes, aggregate funding or hosted
public API capacity. No pipeline, source, sink, reader, secret or checkpoint changed.
