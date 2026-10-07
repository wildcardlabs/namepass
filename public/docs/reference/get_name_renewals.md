# List a name's renewals

`GET /api/v1/names/{name}/renewals`

Read-only renewal history and recorded expiry for an ENS name. Newest first, with a cursor bound to the requested name. Complete requires verification of the confirmed ENS renewal; processing indicates pending verification. Each item has an event-specific renewalId shared with status. Expiry read timestamps are null without paired provenance.

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `name` | path | Yes | ENS name, such as example.eth. |
| `limit` | query | No | Items per page; defaults to 20. |
| `cursor` | query | No | nextCursor from the previous page. Keep the same name. |

## Responses

| Status | Description |
| --- | --- |
| `200` | Name expiry and renewal history. |
| `400` | Invalid name, chain ID, transaction hash or request. |
| `404` | This name has not been activated. Get its deposit address first. |
| `429` | Request rate limit reached. Wait for Retry-After. |
| `500` | Server error. |
| `503` | Temporarily unavailable. Retry after the indicated delay. |

## Response fields

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `currentExpiry` | string or null | Yes | Last recorded ENS expiry, or null when unavailable. Does not imply a fresh read. Format: date-time. |
| `expiryUpdatedAt` | string or null | Yes | Timestamp of the ENS read that observed the accompanying currentExpiry value. Null when that pairing is unknown or currentExpiry is null. Event time, projection time and response time are not substitutes. Format: date-time. |
| `items` | array | Yes |  |
| `nextCursor` | string or null | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields.
