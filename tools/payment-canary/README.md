# Temporary live-payment page

Run `node node_modules/vite/bin/vite.js --config tools/payment-canary/vite.config.ts`
from the repository. Open `http://127.0.0.1:5175/` in Chrome with Rainbow.

The page signs four separate 0.50-USDC payments: Base Sepolia, Arbitrum Sepolia,
Arc ERC-20 and Arc native USDC. It reads the shared chain registry and confirms the
selected network, account, deployed factory prediction, active helper bindings,
renewal quote and balance before requesting a signature. It grants no approvals.
The user signs each transfer. Successful transfer receipts are funding evidence,
not API completion evidence.

For Arc, the page reads `eth_gasPrice` from the network RPC and includes that
price in a legacy transaction request. It estimates gas through the same RPC
and adds a 20% limit margin. This avoids relying on Rainbow's custom-network
fee estimator; it does not bypass the wallet's balance check. If Rainbow still
rejects the request, cancel it and select another browser wallet. Never reload
while a signature is pending. The page shows the preparation and signature
stages, and restores recorded payments and the first-watch name after reload.

The separate gas-funding control requests one 0.01-Sepolia-ETH transfer to the
displayed automation account. It is not an ENS deposit. The user signs it, and
the journal prevents submitting it twice. Existing production recovery retries
prepared claims after funding; this page does not call recovery or broadcast
with a backend key.

The first-watch section checks a renewable name is not activated, then uses the
existing application's `/api/names/activate` route. It requires a running bounded
read-only inspection of the existing Goldsky pipeline before activation/funding.
This is the existing core activation path, not an enabled public address API or a
staging pipeline. Never directly edit a production watch to create this test.

Only the `/api/names` path is proxied to the live application. No server environment
or private key is loaded. Public network RPCs perform reads; Rainbow signs writes.
The local journal contains public payment/activation evidence. It persists in local
storage and `/private/tmp/namepass-october-payment-journal.json`, and can be exported.
The server accepts that journal only from its localhost origin, with a bounded body.
It does not replay or automatically submit payments. Keep the journal between reloads.

Check with `npx tsc --noEmit -p tools/payment-canary/tsconfig.json` and
`node node_modules/vite/bin/vite.js build --config tools/payment-canary/vite.config.ts`.
The page is outside the production application's entry point and build.

## Remaining same-transaction canary

The first card prepares two 0.50-USDC transfers to `farcaster.eth` in one transaction
(1.00 testnet USDC total). Base Sepolia is selected initially; Sepolia and Arbitrum
Sepolia are alternatives. The wallet must already report atomic batching as
`supported` through [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792).
`ready` accounts are blocked so the page does not request a wallet upgrade.
There is no fallback to separate transactions, token approval or new helper contract.

Before a signature, the page checks the account/network, deployed factory address,
registered monitoring, current helper/quote, USDC balance and active read-only stream
capture. The user reviews both transfers in the wallet. The batch ID is saved before
the wallet request; reloads and unknown request outcomes cannot enable a second
submission. A rejected request can be retried. Use **Check submitted batch** to resume.

Funding proof requires a successful atomic wallet result with one transaction hash,
then the full public-RPC receipt with exactly two distinct 0.50-USDC transfer logs
from the connected account to the displayed address. Wallet batch IDs or filtered
wallet logs alone cannot establish this case. This records funding only. Separate
index/status/history checks must prove both deposits and shared-renewal identity.
It does not force split processing or close activation/watch recovery gates.

The receipt guard regression is
`node --import tsx --test tools/payment-canary/batch.test.ts`.
