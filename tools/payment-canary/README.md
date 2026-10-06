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
