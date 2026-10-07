# Name history

Retrieve renewal history and the recorded expiry for an ENS name.

## Read a name's history

```bash
curl 'https://beta.namepass.com/api/v1/names/example.eth/renewals?limit=20'
```

## Response

The response contains `name`, `currentExpiry`, `expiryUpdatedAt`, `items` and `nextCursor`. `currentExpiry` is the last recorded ENS expiry. `expiryUpdatedAt` is the timestamp of the ENS read that observed that same value. It is `null` when the pairing is unknown, including when `currentExpiry` is `null`. Event time, projection time and response time are not read timestamps. An [address request](/docs/addresses) refreshes ENS state, but subsequent indexed changes can leave the read timestamp unknown. History requests do not refresh state or start payment work.

Each item includes `renewalId`, a flow ID, source chain, renewal transaction, duration added, amount applied, fee, expiry and renewal timestamp. Its status is `complete` after verification of the confirmed ENS renewal, or `processing` while verification is pending. Unavailable nullable fields are `null`. Every returned item must have a proven renewal event identity.

History completion describes that renewal event. It does not establish that every deposit in a source transaction was processed. Use the [transaction status response](/docs/status) for source-payment completion.

`renewalId` uses `{chainId}:{lowercaseTransactionHash}:{logIndex}` for the Namepass gateway's `Renewed` event. It agrees with [status responses](/docs/status). Multiple flow rows can refer to the same event; count its duration once per `renewalId`. `flowId` describes processing provenance and is not a renewal deduplication key. Corrections can remove invalidated events from later responses.

## Pagination

Results are ordered newest first. Pass `nextCursor` as the `cursor` parameter to retrieve the next page for the same name. The default page size is 20; `limit` accepts values from 1 to 100. `nextCursor: null` marks the last page. Refresh the first page for new or late-indexed renewals.

```javascript
const url = new URL("https://beta.namepass.com/api/v1/names/example.eth/renewals");
url.searchParams.set("limit", "20");
if (nextCursor) url.searchParams.set("cursor", nextCursor);
const history = await (await fetch(url)).json();
```

## Scope

History is public and includes renewals funded by any sender for the requested name.

## Errors

`404` indicates that the name has not been activated. [Retrieve its deposit address](/docs/addresses) before requesting history.
