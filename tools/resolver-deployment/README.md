# Resolver deployment page

Disposable local page for Phase 7 of `docs/GAS_REDESIGN_PLAN.md` on Ethereum Sepolia: deploying
the `namepass.eth` wildcard resolver that names the October 23 factory, and setting it on the
name in the ENS V2 ETH registry with a browser wallet.

```bash
forge build
node tools/protocol-deployment/build-artifacts.mjs
node node_modules/vite/bin/vite.js --config tools/resolver-deployment/vite.config.ts
npx tsc --noEmit -p tools/resolver-deployment/tsconfig.json
```

Open `http://127.0.0.1:5179/` in Chrome with Rainbow. The page is an isolated Vite root outside
the application's entry point. It loads no server environment and holds no key. A public Sepolia
RPC does the read-only checks (`VITE_SEPOLIA_RPC_URL` in the shell that starts Vite overrides
it); Rainbow signs the two transactions. The wallet must own `namepass.eth` in the ENS V2 ETH
registry, `0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6`.

## What it does

`namepass.eth` on Sepolia is registered in the ENS V2 ETH registry
(`0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4`), so the resolver is set with the registry's
`setResolver(tokenId, resolver)`, which requires `ROLE_SET_RESOLVER` on the name. The page reads
the token ID, owner, expiry, current resolver and role from the registry before enabling a step.

| # | Transaction |
| --- | --- |
| 1 | Deploy `NamepassResolver` with plain `CREATE` from the owner wallet: apex address, avatar, description, url and gateway URL from `deployment.ts` |
| 2 | ETH registry `setResolver(tokenId, resolver)` |

The resolver hard-codes the factory address, so `contracts/NamepassResolver.sol` and its Foundry
test name the October 23 factory; `tools/protocol-deployment/artifacts.json` embeds the compiled
resolver. After the receipt the page re-reads the chain: the resolver code must match the build
with immutables masked, and the registry must name the new resolver.

`Verify` checks the resolver's constructor values, ENSIP-10 support, the registry entry, the
universal resolver's `findResolver` for the apex and a subname, and resolves `namepass.eth` to
the apex address. `Resolve and check activation` resolves `<label>.namepass.eth` through the
universal resolver: the resolver reverts `OffchainLookup`, the browser calls the hosted gateway
`https://beta.namepass.com/api/ccip`, the gateway activates the label, and the callback derives
the deposit address. The page compares that address with the factory's `predictWallet` and the
local derivation, then reads the hosted name record through the Vite proxy to confirm the
activation. `Export deployment record` downloads the plan, registry state, transaction hashes,
verification notes and resolutions as JSON for `docs/deployments/<date>/`.

Reloading preserves the journal; the resolver address is re-read from the deployment receipt.
`Clear journal` forgets it, which only matters before step 2: once the registry names the
resolver, the page reports step 1 as blocked until the journal names the same address again.

## After deployment

Verify source on Sourcify (`forge verify-contract --chain sepolia --verifier sourcify
<resolver> contracts/NamepassResolver.sol:NamepassResolver`), record the export under
`docs/deployments/<date>/`, and update the resolver section of `docs/DEPLOYMENTS.md`.
