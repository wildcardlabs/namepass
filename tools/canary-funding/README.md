# Canary funding page

Disposable local page for Phase 6 of `docs/GAS_REDESIGN_PLAN.md`: funding the four canary
deposits on the two-contract deployment with a browser wallet.

```bash
npm ci
node node_modules/vite/bin/vite.js --config tools/canary-funding/vite.config.ts
npx tsc --noEmit -p tools/canary-funding/tsconfig.json
```

Open `http://127.0.0.1:5178/` in Chrome with Rainbow. The page is an isolated Vite root outside
the application's entry point. It loads no server environment and holds no key. Public RPCs do
the read-only checks (override one with `VITE_<CHAIN>_RPC_URL` in the shell that starts Vite);
Rainbow signs the transfers; `/api/names` reads are proxied to `beta.namepass.com`.

| Card | Chain | Name | Form |
| --- | --- | --- | --- |
| 1 | Ethereum Sepolia | vitalik.eth | ERC-20 `transfer`, direct renewal through the V1 renewer |
| 2 | Base Sepolia | skellat.eth | ERC-20 `transfer`, CCTP claim, V2 registrar |
| 3 | Arbitrum Sepolia | farcaster.eth | ERC-20 `transfer`, CCTP claim, V1 renewer |
| 4 | Arc Testnet | steve.eth | Native USDC value transfer |
| 5 | Arc Testnet | steve.eth | Optional ERC-20 `transfer` on the USDC system contract |

Each is 1.00 testnet USDC. Before asking for a signature, a card switches the wallet to its
chain, checks that the chain's factory predicts the displayed wallet for the label, that the beta
reports the name as activated at that address, and that the hub factory quotes a positive
renewal for the deposit through the active adapter. After the receipt it verifies the credit:
exactly one matching `Transfer` log, or the native value to the wallet. A lost wallet result is
recovered by pasting the hash; a recorded card never sends twice.

`Export funding record` downloads the journal; it is also mirrored to
`/private/tmp/namepass-canary-funding-journal.json`. The receipts become the Phase 6 fixtures and
the canary evidence in `docs/DEPLOYMENTS.md`.
