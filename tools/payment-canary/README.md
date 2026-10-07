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

The first card uses Ethereum Sepolia Multicall3 at
`0xcA11bde05977b3631167028862bE2a173976CA11`. It prepares two 0.50-USDC
`transferFrom` calls to `farcaster.eth` in one ordinary wallet transaction.
The user first signs an exact 1.00-testnet-USDC approval, checks its confirmed
receipt, then signs the funding transaction. Both calls use `allowFailure: false`.
A failed call reverts the whole funding transaction.

**Testnet only:** Multicall3 is public. Anyone can call it to spend this allowance
before funding. The user accepted this risk for the capped, worthless test token.
This is not a production funding pattern. Never grant an unlimited approval.
The page checks the deployed runtime hash and requires zero prior allowance.
Successful funding must leave zero allowance.

Before funding, the page checks the account/network, deployed factory prediction,
registered monitoring, current helper/quote, token and gas balances, exact allowance,
and active read-only stream capture. It saves each request before calling Rainbow.
Reloads and unknown wallet outcomes cannot enable a second submission. A definitive
wallet rejection permits retry. Use **Check submitted transaction** after each
confirmation. If the returned hash was lost, paste it into the recovery field;
the page checks the sender, contract, exact calldata, zero ETH value and receipt.

Funding proof requires the full public-RPC receipt with exactly two distinct
0.50-USDC transfer logs from the recorded sender to the deposit address. The page
records funding only. Separate indexing/status/history checks must prove both
deposits and shared-renewal identity. This does not force split processing or close
activation/watch recovery gates.

The receipt guard regression is
`node --import tsx --test tools/payment-canary/batch.test.ts`.
The deployed-token regression requires an explicitly configured localhost Anvil
Sepolia fork. It impersonates accounts only on that local fork and reverts its
snapshot after testing. It verifies two credits, complete allowance consumption,
and rollback of both transfers when the second fails:

```sh
NAMEPASS_CANARY_FORK_URL=http://127.0.0.1:8547 node --import tsx --test tools/payment-canary/multicall-fork.test.ts
```

See [Multicall3's write guidance](https://github.com/mds1/multicall3#batch-contract-writes)
for its caller behavior and approval risks.
