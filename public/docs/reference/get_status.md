# Poll a transaction

`GET /api/v1/status/{chainId}`

Track a source transaction. Complete requires independent proof of its full relevant deposit set, watch/address coverage, source validity, processing relationships and finalized renewals for every member. Missing or late-indexed members prevent aggregate completion. Shared renewals use the same renewalId. Corrections can revoke prior completion.

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `chainId` | path | Yes | Source EVM chain ID from the address response. |
| `transactionHash` | query | Yes | The USDC deposit transaction hash returned by your wallet. |

## Responses

| Status | Description |
| --- | --- |
| `200` | Current progress. Poll pending or processing; stop at complete. |
| `400` | Invalid name, chain ID, transaction hash or request. |
| `404` | No matching deposit has been indexed. Retry the same URL. |
| `429` | Request rate limit reached. Wait for Retry-After. |
| `500` | Server error. |
| `503` | Temporarily unavailable. Retry after the indicated delay. |

## Response fields

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `chainId` | string | Yes | Exact integer encoded as a decimal string. |
| `transactionHash` | string | Yes |  |
| `status` | string | Yes | Failed for a proven invalidated source deposit. Otherwise pending while the deposit set is not proven closed or a member is pending; processing while a member awaits renewal confirmation; complete only for a proven closed, nonempty set with every member complete. Provider outages return retryable errors, not failed. Values: `pending`, `processing`, `complete`, `failed`. |
| `deposits` | array | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields.
