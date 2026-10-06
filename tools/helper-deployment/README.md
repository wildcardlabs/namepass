# Temporary helper deployment page

Run from the repository:

```bash
node node_modules/vite/bin/vite.js --config tools/helper-deployment/vite.config.ts
npx tsc --noEmit -p tools/helper-deployment/tsconfig.json
```

Open `http://127.0.0.1:5174/` in Chrome with Rainbow. This is an isolated local Vite
root, outside the application's production entry point. It loads no server environment
or signing key. Public Sepolia RPC performs read-only checks; Rainbow signs the three
explicit deployment, scheduling and activation transactions.

The embedded artifact uses the existing Solidity 0.8.24 compiler and Shanghai settings.
Its source hash and immutable references accompany the bytecode. A deployed helper must
match the compiled runtime outside immutable offsets and every constructor getter.
The disposable `HelperRotationForkTest` passed at Sepolia block 11857705 before the
deployment controls were enabled. Rebuild and repeat that fork verification if the
contract source or inputs change; the included artifact is specific to this rotation.

The page saves only public addresses, transaction hashes and timelock operation data
in local storage. It checks chain, account, contract configuration, roles and readiness
before each write. Reloading preserves the journal; reconnect to verify progress.
`Export deployment record` downloads the public journal. No background RPC loop or
automatic activation runs. An elapsed countdown requires an explicit readiness check.

The user completed the October 6 rotation. The durable deployment and API verification
record is in [DEPLOYMENTS.md](../../docs/DEPLOYMENTS.md#october-ens-helper-rotation-and-api-canary--2026-10-06).
