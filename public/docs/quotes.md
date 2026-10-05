# Calculate renewal duration

Request a quote using the ENS name, source chain and USDC amount.

## Request a quote

```bash
curl -X POST 'https://beta.namepass.com/api/v1/quote' \
  -H 'Content-Type: application/json' \
  -d '{"name":"example.eth","chainId":"84532","amount":"1000000"}'
```

Use a chain ID from the [address response](/docs/addresses). Send `amount` as an integer string in USDC's smallest unit: `1000000` represents 1 USDC.

## Response

| Field | Description |
| --- | --- |
| `secondsAdded` | Estimated renewal duration in seconds. |
| `amountApplied` | USDC applied to the ENS renewal. |
| `renewalFee` | Processing allowance for one renewal flow. |
| `bridgeFee` | USDC bridge fee under Namepass automation’s transfer policy. Currently `0` for Standard transfers. |
| `roundingRemainder` | USDC remaining after duration rounding, retained by the renewal gateway. |
| `pricingBlock` | Block number used to calculate the estimate. |
| `expiresAt` | Quote expiry, 60 seconds after calculation. |

All USDC values are integer strings in six-decimal token units. `bridgeFee` is an amount, not a percentage.

Namepass automation selects the transfer fee policy. Quotes use the current Standard transfer policy with zero bridge fee; they do not query Circle for fee rates. If Namepass enables fee-bearing transfers later, quote support must be updated with that policy.

## Estimate limits

A quote assumes one processing flow and no existing balance at the deposit address. Deposits may be combined, and prices may change before settlement. Use [transaction status](/docs/status) for the final renewal result.

## Errors

`422` indicates an unrenewable name, an amount below the minimum, an unsupported renewal duration, or an amount above the source chain's single-flow limit. For amounts above the source-chain limit, `error.details.maximumAmount` gives the maximum quote amount. Larger deposits require multiple processing flows.

`503` indicates unavailable pricing or a source route outside the supported Standard transfer configuration. Retry the quote request before funding.
