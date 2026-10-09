# Poll status

Track a USDC deposit using its transaction hash & source chain ID.

## Request

```bash
curl 'https://beta.namepass.com/api/v1/status/84532?transactionHash={hash}'
```

Replace `{hash}` with the transaction hash returned by the wallet. Use the source chain ID from the [address response](/docs/addresses).

## Statuses

| Status | Meaning | What to do |
| --- | --- | --- |
| `pending` | The deposit is indexed and verification is pending. | Poll again. |
| `processing` | The deposit is verified and is awaiting processing or renewal confirmation. | Poll again. |
| `complete` | The funds were processed and the confirmed ENS renewal is verified. | Show completion. |
| `failed` | The source deposit was invalidated, such as by a chain reorganization. | Inspect the transaction before taking further action. |

Deposits below `minimumAmount` remain pending until the address has enough USDC to process a renewal.

Completion does not wait for an additional finality checkpoint. Circle bridge processing must still finish, and the confirmed ENS renewal must be verified.

## Response

The response includes `chainId`, `transactionHash`, `status` and `deposits`. Each deposit has a name, amount, log index and status. `logIndex` is the ERC-20 transfer's log index, or `null` for native Arc funding.

The transaction becomes `complete` only after the full relevant deposit set is proven closed and nonempty, every member is represented, and every member is complete. Source evidence and address-monitoring coverage must establish this set independently of indexed rows. A late or missing deposit prevents completion even when all currently returned deposits are complete.

Completed entries include `renewals` with `renewalId`, transaction hash, duration added and resulting expiry. The identifier is `{chainId}:{lowercaseTransactionHash}:{logIndex}` for the Namepass gateway's `Renewed` event. Different renewal logs in one transaction have different identifiers. The same event has the same identifier in [history](/docs/history) and across repeated polls.

A renewal can include multiple deposits. Its duration is the total renewal duration, not an allocation to one deposit. Deduplicate by `renewalId` before adding durations across deposits.

## Aggregate status and corrections

A proven invalidated source deposit makes the transaction `failed`. Otherwise, an unproven deposit set or any pending member keeps it `pending`; a member awaiting renewal confirmation keeps it `processing`. Only a closed, nonempty set with every member complete becomes `complete`.

A provider outage returns a retryable error, not `failed`. Evidence corrections can revoke prior completion. On a later read, discard invalidated results and use the current response.

## Polling

Poll every five seconds, or after the delay specified by `Retry-After`. Resume polling with the same chain ID and transaction hash. Do not repeat a transfer to resolve a pending status.

## Errors

| HTTP status | Meaning | Action |
| --- | --- | --- |
| `400` | Invalid chain ID or transaction hash. | Correct the request. |
| `404` | No matching deposit has been indexed. | Retry the same URL. |
| `429` | Request rate limit reached. | Wait for `Retry-After`. |
| `503` | Service temporarily unavailable. | Wait for `Retry-After`. |
