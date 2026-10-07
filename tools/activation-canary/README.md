# Activation-boundary wallet check

Temporary localhost-only page. It is outside the application build.

The selected canary is `brantly.eth`, Base Sepolia, one `500000`-unit USDC
transfer to `0xbb23c9991e390722533b41137A8A91Ae055383Df`. October 7 read-only
checks found it renewable and absent from the production names/watch tables.
The page repeats those checks before activation. It uses the normal application's
activation route, then immediately requests the user's wallet signature. It does
not contain a backend signing key or add a public API route.

Start with `npx vite --config tools/activation-canary/vite.config.ts`.
The existing read-only Goldsky inspection must capture both source and filtered
output for this destination before the user activates or funds it. It must not
change the pipeline or its sinks. The inspection expires after twenty minutes.
The `/capture-status` guard checks its active state and destination.

Activation and funding requests are journaled locally before submission. Unknown
wallet outcomes block another transfer; recovery accepts only the exact original
account, token, destination, calldata and one matching successful receipt credit.
A definitive wallet rejection allows retry, but an already-committed activation
means that retry is not a new-watch timing sample. Keep both facts in the receipt.

Wallet signatures and live activation require user authorization. A successful
transfer alone does not close the API release gate. Record activation commit,
funding request, canonical source receipt, source and filtered stream observations,
indexed deposit, processing, renewal and API results. A positive sample does not
prove recovery for an event filtered out before watch visibility, zero-delay
ingestion on every route, or restart recovery.
