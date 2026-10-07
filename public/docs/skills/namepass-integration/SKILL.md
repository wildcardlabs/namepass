---
name: namepass-integration
description: Integrate USDC-funded ENS renewals with Namepass using deposit addresses, quotes, transaction status and name history.
---

# Namepass

The public API is available as a testnet pilot. Use only the networks and token addresses returned by the address API.

Base URL: `https://beta.namepass.com`. Read [the quickstart](https://beta.namepass.com/docs/quickstart.md) for request examples.

1. Call `POST /api/v1/address` with `{"name":"example.eth"}` for the requested name.
2. Use its `depositAddress`, supported chain, `tokenAddress` and `minimumAmount`. Send USDC through the available wallet. Get approval before sending unless already authorized. Use the full address; use `subname` only when `subnameVerified` is true.
3. Save the transaction hash and source chain ID. Poll `GET /api/v1/status/{chainId}?transactionHash={hash}` every five seconds or after `Retry-After`. Retry 404, 429 and 503. Stop at `complete`; inspect `failed` before taking further action.

For estimates, call `POST /api/v1/quote` with `name`, `chainId` and an integer-string `amount` in six-decimal USDC units. Quotes expire after 60 seconds and assume one processing flow with no existing deposit balance. For history and recorded expiry, call `GET /api/v1/names/{name}/renewals`; pass `nextCursor` as `cursor` for subsequent pages.

Resume pending transactions with the same hash and chain ID; do not repeat the payment. Aggregate `complete` requires proof of the full relevant deposit set and completion for every member. Read `deposits[].renewals` for verified confirmed ENS renewal receipts. Their duration can include multiple deposits and is not a per-deposit allocation. Count duration once per `renewalId`, which identifies a gateway `Renewed` event as `{chainId}:{lowercaseTransactionHash}:{logIndex}` and agrees with history. `flowId` is processing provenance, not a renewal identity. History's `expiryUpdatedAt` is null unless a read timestamp is paired with the returned expiry value. History and status requests do not activate names or start payment work.

USDC token amounts use six decimals and integer arithmetic. Use the networks returned by the address API; the current deployment is testnet. Never expose wallet keys or broadcast funds without authorization.
