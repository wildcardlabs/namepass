# Public address adapter

Date: 2026-10-05. Protected hosted activation verified; production activation remains disabled.

## Field sources

| Response field | Established source | Verification |
| --- | --- | --- |
| `name` | ENSIP-15 normalization in `namepass.ts`; `names.display_name` from activation | Uppercase `.eth` input and normalized label produce the same registration |
| `depositAddress` | Existing CREATE2 derivation, stored by `activateName`, returned in full with checksum | Independent `steve` and `vitalik` vectors; 12 deployed factory predictions across four chains |
| `subname` | Normalized label plus `.namepass.eth` | Formatting alone is not resolver verification |
| `subnameVerified` | `false` until resolver-to-full-address verification is available | No mainnet resolver receipt exists in the baseline; never infer `true` from address derivation |
| `chains[].chainId`, `name`, `tokenAddress` | Active testnet registry in `chains.ts` | OpenAPI response check and explicit four-network fixture |
| `chains[].minimumAmount` | Existing automation trigger configuration | `500000` integer USDC units for each current network |

The adapter calls `activateName` with a renewable-name requirement. The existing helper
read must identify a supported ENS renewer before any database write. Existing UI and
CCIP activation callers retain their current behavior. No schema migration or contract
change is required.

Activation writes the existing name and watch rows, requests balance scans, stores known
balance snapshots and uses the existing recovery path. Unknown balances remain requested;
they are not zero snapshots. A failed request can have committed registration, so retries
must stay idempotent. Returning an address does not prove Goldsky has consumed the new watch
row; that propagation gap remains a release gate.

## HTTP and resource limits

`NAMEPASS_PUBLIC_ADDRESS_ENABLED=1` enables the adapter. The default is disabled. Maintenance
also blocks activation. POST and OPTIONS use browser CORS; other methods return 405. Responses
are JSON with `Cache-Control: no-store`. Invalid inputs fail before RPC or database access;
unrenewable names return 422; unavailable activation returns retryable 503.

The shared public JSON reader stops above 8192 bytes, including streamed bodies. Body reads
have a 10-second deadline. Activation RPC reads share a 15-second deadline, passed through the
existing read helpers only for this caller. Cancellation does not enter their warm-process
chain verification cache. That deadline does not cancel database transactions or durable
recovery. The two-request limit is per process, not distributed abuse protection.

Preview requests execute this deployment's adapter. They never proxy public activation to
beta. The approved protected preview uses its own schema-only Neon branch and dedicated role,
four read RPC settings and its address flag. It has no signing credential or attached indexer.
Production configuration is unchanged.

## Acceptance and remaining release gates

The HTTP regression verifies disabled/method/CORS behavior, invalid input, unrenewable names,
ENS failure, cancelled reads and capacity cleanup. The PostgreSQL integration test creates
its own disposable local database from migrations 0000–0008. It overlaps two normalized-name
requests, checks one name/watch registration and four balance snapshots, and verifies that
unavailable balance reads retain four pending scans. CI supplies PostgreSQL; local runs without
`TEST_DATABASE_URL` explicitly skip that integration case. No mocked database proves concurrency.
At code head `90f9ca2484080f982cb6206b38035eb075738aab`, CI run `37344004543` passed,
including 166 server tests with none skipped. The PostgreSQL activation test passed. Protected
preview `dpl_2yRf4eoAuQ6A9sKpi7j94cnCHEPx` returned disabled JSON for POST, 204 for
OPTIONS and 405 for GET, all with correct CORS/no-store headers. The bounded receipt is in
`deployments/2026-10-05/public-api-address-private.json`. This does not prove hosted activation
or watch propagation; that initial preview had no database or address enable flag.

Protected preview `dpl_Hgb5L9xLJP88RniLT9GU5xgxvCF3` at
`55a22ed1031390efd0e1fdcb2795582e18d42f2b` then passed eleven hosted HTTP checks.
The dedicated schema-only `api-staging` branch started with all tables empty. Both registrar
and V1 names activated through the real service. Concurrent and repeated normalized requests
returned the same address. The resulting database contained two names, two watches and eight
zero balance snapshots; flows, events, deposits and transaction intents remained empty.
An unrenewable name returned 422 and did not create a row. Anonymous POST returned 401.
The receipt is `deployments/2026-10-05/public-api-address-staging.json`.

Before opening public activation:

- Preserve successful CI and isolated hosted activation checks. Controlled indexer and watch
  propagation tests still remain. Do not give an API preview the live database or signing key.
- Preserve the verified factory/address agreement. Twelve block-pinned read-only checks for
  `steve`, `vitalik` and `alice` across all four factories passed; evidence is in
  `deployments/2026-10-05/public-api-address-factories.json`. No activation or transactions were sent.
- Verify the actual `namepass.eth` resolver and gateway before enabling a `true` subname result.
  Until then, clients must use the full address.
- The [local activation/webhook/status rehearsal](PUBLIC_API_ACTIVATION_REHEARSAL.md) verifies
  rollback, retry and duplicate delivery against real SQL. Hosted checks must use the existing
  pipeline under the current Goldsky plan; first-watch propagation remains unverified.
- Prove new watch rows propagate to deposit detection and that activation-time deposits cannot
  fall between the initial balance snapshot and watch coverage. A successful database commit
  alone is insufficient. Review any necessary core recovery change separately.
- Review distributed activation abuse limits and production database timeouts before anonymous
  access. Staging uses 5000 ms statement, 1500 ms lock and 10000 ms idle-transaction timeouts.

Transaction status and history are separate stages. Their completion, renewal identity and
expiry provenance requirements in `PUBLIC_API_PLAN.md` remain unchanged.
