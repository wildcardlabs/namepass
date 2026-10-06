# Status receipt captures

`october-reads.json` records the real, read-only HTTP adapter inspection of the user's
October 6 Sepolia `farcaster.eth` payment. The API tests use the current ENS registry.
Its source transfer is `0xd725d3431622bfc574524ca092564a319efe49e0be2b4798348b582718441533`,
log 110. Renewal transaction `0xb47311d40dc75d0d2253521fd8e3b0dd8a206b9034694a6d6a0d28701186e99e`
contains the gateway renewal at log 179 and processing at log 180. Independent receipt
values are $0.50 received, $0.40 applied, 1,576,795 seconds and expiry 1963884752.

Only database wire transport and provider responses are replaced in the replay.
Actual adapter SQL and receipt verifiers run. Contract code is deduplicated by hash.
The recorded capture contains no RPC URL, credential, Workflow ID or signed transaction.
The current direct CLI regression also uses this capture in a separate process.

`reads.json` is the prior deployment's archived single-deposit capture. The local
activation/late-delivery regression still uses its source transfer. Archived processing
and expiry tests explicitly use their recorded ENS configuration; the production API
does not gain a legacy-contract allowlist. Neither capture proves hosted polling capacity.
