# Public API admission

Status: prepared for review; hosted rules are not applied. Production API flags remain off.

The four `/api/v1` adapters use the official `@vercel/firewall` SDK before database,
activation or chain work. Existing core UI, Goldsky, Workflow, cron and payment
routes do not call this guard. No new database, worker or signing service is needed.

Hosted requests require `NAMEPASS_PUBLIC_LIMITS_ENABLED=1`, production Node mode,
the system `VERCEL_URL` and a valid platform `x-real-ip`. Each admitted request
checks its endpoint's per-IP counter, then a shared regional budget. The SDK host
comes from deployment configuration. Caller Host, authorization, cookies and
rate-limit keys are not forwarded. Local fixture tests can run without hosted
admission; setting the limits flag requires the real guard even locally.

The SDK can return `rateLimited: false` with `error: not-found` for a missing rule.
The adapter treats that as unavailable. SDK errors, invalid deployment inputs or
missing configuration return JSON `503 rate_limit_unavailable`. A limit returns
JSON `429 rate_limited` with `Retry-After: 60`. Both preserve CORS and no-store.
Each SDK check has a two-second timeout. Existing local concurrency and provider
budgets remain. Disabled endpoints and OPTIONS do not consume these counters.

## Proposed testnet pilot limits

Each counter uses a fixed 60-second window. These are initial pilot limits, not a
measured public capacity promise.

| Endpoint | Requests per IP | Shared requests per region |
| --- | ---: | ---: |
| Address | 6 | 12 |
| Quote | 30 | 60 |
| Status | 12 | 24 |
| History | 6 | 12 |

The [eight proposed rules](deployments/2026-10-06/public-api-admission-rules.json)
use fresh `namepass-v1-*` IDs and the SDK's generated key. They do not reuse the
abandoned integration rules. The shared key is chosen by the server, not callers.
Vercel counts rate limits per region. These counters are not a globally exact
request or spending cap. Fixed windows can permit a burst at the window boundary.
See [Vercel's SDK documentation](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk)
and [platform request headers](https://vercel.com/docs/headers/request-headers).

## Hosted verification before release

Publishing firewall rules requires separate approval. Review the current firewall
version and any pending draft first. Preserve existing rules and avoid publishing
unrelated draft changes. Configure the new guard only on a protected API preview
with the isolated SELECT-only database, existing RPC settings and automation
protection bypass. Address and quote stay off during the read-only guard test.

Verify allowed and throttled requests, JSON/CORS/retry headers, absent-rule failure,
recovery after the window, immutable staging data and populated core activity.
Use invalid status requests to exercise counter exhaustion without chain work.
Then repeat bounded positive reads for the fresh canaries. Review regional scope
and measured latency before a separate production-enable decision. Merging this
code does not enable a public endpoint or apply firewall rules.

The primary HTTP regression uses the real SDK with only its network transport
replaced. All four actual adapters must stop on per-IP exhaustion, shared-budget
exhaustion, missing rules or transport failure before database/provider work. It
also verifies the configured destination, stripped caller headers, fixed shared
key, sanitized errors, retry headers and missing-enable failure.
