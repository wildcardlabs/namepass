# Protocol deployment page

Disposable local page for Phase 3 of `docs/GAS_REDESIGN_PLAN.md`: deploying the two-contract
design on the four testnets with a browser wallet.

```bash
forge build
node tools/protocol-deployment/build-artifacts.mjs
node node_modules/vite/bin/vite.js --config tools/protocol-deployment/vite.config.ts
npx tsc --noEmit -p tools/protocol-deployment/tsconfig.json
```

Open `http://127.0.0.1:5175/` in Chrome with Rainbow. The page is an isolated Vite root outside
the application's entry point. It loads no server environment and holds no key. Public RPCs do
the read-only checks; Rainbow signs the eleven transactions. To read a chain through a different
endpoint, for example a keyed Arc RPC, set `VITE_ARC_TESTNET_RPC_URL` (or `VITE_SEPOLIA_RPC_URL`,
`VITE_BASE_SEPOLIA_RPC_URL`, `VITE_ARBITRUM_SEPOLIA_RPC_URL`) in the shell that starts Vite. The
value stays in that shell and in the wallet's network entry; do not write it to a file in the
repository. The wallet must be the factory
owner and timelock operator, `0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6`.

## What it does

Every address is computed before anything is sent. The factory and the adapter go through the
Safe singleton factory at `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7` with CREATE2, so the
factory lands on one address on all four chains. The salt for each contract is
`keccak256("<salt label>/<contract name>")`; the salt label is in `deployment.ts`, and changing
it moves every address.

The eleven steps, in order:

| # | Chain | Transaction |
| --- | --- | --- |
| 1 | Sepolia | Deploy factory |
| 2 | Sepolia | Deploy adapter |
| 3 | Sepolia | `initialize` with USDC, Circle TokenMessenger, Circle MessageTransmitter, and the test timelock as governance |
| 4 | Sepolia | Timelock `schedule` of `setHelper(adapter)` |
| 5 | Sepolia | Timelock `execute` after the 60-second delay |
| 6, 7 | Base Sepolia | Deploy factory, `initialize` with USDC and TokenMessenger |
| 8, 9 | Arbitrum Sepolia | Same |
| 10, 11 | Arc Testnet | Same, with legacy gas pricing |

Each step's button is enabled only when the chain says the step is ready: the singleton factory
exists, the address is free or already holds the expected code, the factory is uninitialized or
initialized with exactly the expected routes, the wallet holds the timelock role, the delay has
elapsed. After the receipt the same check must report the step as done, otherwise the page
reports an error. Reloading preserves the journal of transaction hashes, and the chain state is
re-read on every recheck, so a lost journal costs nothing.

`Verify <chain>` runs the full post-deployment check: runtime code against the build with
immutables masked, owner, routes, hub settlement address, allowance, and on Sepolia the adapter's
version, addresses, referrer, activation, and a live quote. `Export deployment record` downloads
the plan, the per-chain state, the transaction hashes, and the verification notes as JSON, which
is the starting point for the deployment manifest.

## Dry run

`dry-run.ts` runs every step against Anvil forks with the owner wallet impersonated, so the
senders match the real deployment, then verifies each chain. See the header of that file for
the commands. The last dry run completed all eleven steps with 18 checks on Sepolia and 8 on each
L2; the factory address is the same on all four forks.

## After deployment

Record the manifest and verification under `docs/deployments/<date>/`, verify source on Sourcify
and the explorers, and continue with Phase 4 of the plan. The embedded `artifacts.json` is
specific to one build; rerun `build-artifacts.mjs` after any contract change, and CI checks that
it matches.
