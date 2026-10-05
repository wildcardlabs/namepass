# Estimate a renewal

`POST /api/v1/quote`

Estimate renewal duration, the protocol allowance and rounding remainder for an ENS name, funding chain and USDC amount. Uses Namepass automation’s current Standard transfer policy with zero bridge fee, without Circle fee queries. Quotes expire after 60 seconds and assume one processing flow with no existing balance at the deposit address.

## Request body

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `chainId` | string | Yes | Exact integer encoded as a decimal string. |
| `amount` | string | Yes | Exact integer encoded as a decimal string. |

```json
{
  "name": "example.eth",
  "chainId": "84532",
  "amount": "1000000"
}
```

## Responses

| Status | Description |
| --- | --- |
| `200` | Estimated renewal time and fee breakdown. |
| `400` | Invalid name, chain ID, transaction hash or request. |
| `413` | Request body exceeds 8192 bytes. |
| `415` | Use Content-Type: application/json. |
| `422` | Name cannot currently renew, amount is below the minimum, renewal duration is unsupported, or amount exceeds the source chain single-flow quote limit. |
| `429` | Request rate limit reached. Wait for Retry-After. |
| `500` | Server error. |
| `503` | Temporarily unavailable. Retry after the indicated delay. |

## Response fields

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `chainId` | string | Yes | Exact integer encoded as a decimal string. |
| `amount` | string | Yes | Exact integer encoded as a decimal string. |
| `secondsAdded` | string | Yes | Exact integer encoded as a decimal string. |
| `amountApplied` | string | Yes | Exact integer encoded as a decimal string. |
| `renewalFee` | string | Yes | Exact integer encoded as a decimal string. |
| `bridgeFee` | string | Yes | USDC fee amount in six-decimal token units, not a percentage. Namepass automation currently uses Standard transfers with zero bridge fee. Quotes use that policy without querying Circle; future fee-bearing transfers require an explicit quote update. |
| `roundingRemainder` | string | Yes | Exact integer encoded as a decimal string. |
| `pricingBlock` | string | Yes | Exact integer encoded as a decimal string. |
| `expiresAt` | string | Yes | Format: date-time. |
| `estimate` | boolean | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields.
