# Gas redesign: step-by-step migration plan

Companion to [GAS_REDESIGN_PROPOSAL.md](GAS_REDESIGN_PROPOSAL.md). Date: 2026-10-12.
Status: plan, not started. The beta deployment is disposable and has no flows in progress.

Two roles. **Claude** writes code, runs read-only checks, and prepares every transaction.
**You** sign transactions with the Rainbow browser wallet and authorize hosted-data changes.
Nothing below broadcasts a transaction without your signature.

## Prerequisites

- Rainbow connected to Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, and Arc Testnet
  (chain 5042002, RPC from `src/lib/chains.ts`).
- Native gas on all four testnets in the deploying wallet, `0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6`,
  which stays the factory owner and timelock proposer. Budget about 0.05 test ETH per chain for
  deployment plus initialization, and Arc's native USDC for its gas.
- Testnet USDC for canaries: about 1 USDC per chain, Arc in native USDC.
- The existing Sepolia test timelock `0x996cbd179f361B1043Ad1999864eD41496C633c8` is reused as
  the governance executor; it is wallet-controlled with a 60-second delay. No new timelock.
- Ethereum mainnet ETH for two transactions if the `namepass.eth` wildcard resolver is updated
  in this round (see Phase 6).

## Phase 1: contracts (Claude, no transactions)

1. Write the merged `NamepassFactory` and the view-only `ENSV2RenewalAdapter` per the proposal's
   settlement invariants and plan constraints.
2. Rewrite the Foundry suites: factory, renewal, CCTP, governance, pricing, Arc native reception,
   plus fork compatibility tests against live Sepolia ENS.
3. Benchmark from full transaction receipts on an Anvil fork: direct V1, first use, and CCTP
   with a mocked transmitter; direct V2 when a V2-renewable testnet name is available. Verify
   compiled sizes under the pinned settings.
4. Regenerate the adapter fingerprint and commit everything on the `claude/` branch.

Exit: `forge test` green, benchmarks recorded in `test/gas/README.md`, PR open for review.

## Phase 2: deployment tool (Claude, no transactions)

Build `tools/protocol-deployment/`, a disposable local Vite page in the style of
`tools/helper-deployment/`: isolated root, no server environment, public RPCs for reads,
Rainbow for writes, journal in local storage, export of the public record.

It embeds the compiled artifacts and, before any write, shows:

- the deterministic factory address computed from the Safe singleton factory
  `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7`, the salt, and the creation code, and confirms the
  same address is free on all four chains;
- the adapter address, constructor inputs, and runtime hash;
- every transaction it will ask you to sign, per chain, with calldata.

Each step checks chain, account, nonce state, and existing code before enabling its button, and
verifies on-chain state after the receipt. Reloading preserves progress.

Exit: `npx tsc --noEmit -p tools/protocol-deployment/tsconfig.json` passes; a dry run against
Anvil forks of all four chains completes every step and every verification check. Done; see
`tools/protocol-deployment/README.md`.

## Phase 3: deployment (you sign, Claude verifies)

Order matters: the hub first, so the adapter can point at a factory that exists.

| Step | Chain | Transaction | Signer |
| --- | --- | --- | --- |
| 3.1 | Sepolia | Deploy factory through the singleton factory with the chosen salt | You |
| 3.2 | Sepolia | Deploy adapter with factory, USDC, registrar, V1 renewer, referrer | You |
| 3.3 | Sepolia | `initialize` the factory: USDC, Circle TokenMessenger, Circle MessageTransmitter, governance executor = test timelock | You |
| 3.4 | Sepolia | Timelock `schedule` of `setHelper(adapter)` | You |
| 3.5 | Sepolia | After 60 seconds, timelock `execute` | You |
| 3.6 | Base Sepolia | Deploy factory, same salt, same address | You |
| 3.7 | Base Sepolia | `initialize`: USDC, TokenMessenger; no transmitter or governance on an L2 | You |
| 3.8 | Arbitrum Sepolia | Deploy factory | You |
| 3.9 | Arbitrum Sepolia | `initialize` | You |
| 3.10 | Arc Testnet | Deploy factory | You |
| 3.11 | Arc Testnet | `initialize` | You |

Eleven signatures. After each receipt the tool checks code hash, owner, configuration, and that
the factory address matches on every chain. Claude then verifies source on Sourcify and the
explorers, runs the fork compatibility test against the deployed addresses, and writes
`docs/deployments/<date>/manifest.json` and `verification.json`.

Exit: identical factory address on four chains, adapter active on the hub, manifest recorded.

## Phase 4: backend (Claude, no transactions)

1. `src/lib/chains.ts`: new factory address and deployment blocks; gateway and pointer addresses
   set to the factory; adapter metadata.
2. `src/lib/helperDiscovery.ts`: accept `interfaceVersion` 2.
3. `server/allocation-evidence.ts`: two-debit rule and new factory hash pin.
4. `server/processing-renewal-evidence.ts`: factory hash pins, emitter address from config.
5. `goldsky/generate-testnet.mjs`: regenerate `namepass-testnet.yaml` with new addresses and
   start blocks; deduplicate identical addresses.
6. Tools: `helper-deployment`, `payment-canary`, `activation-canary` read from the new config.
7. Docs: `CONTRACTS_V2.md`, `ENGINEERING_CONSTRAINTS.md`, `DEPLOYMENTS.md`, `DECISIONS.md`, the
   `PUBLIC_API_*` behavior pages. No endpoint or response field changes.

Exit: `npm run build`, `npm run check:server`, `npm run test:frontend` green. Server tests that
depend on recorded receipts stay red until Phase 6 replaces the fixtures.

## Phase 5: hosted cutover (you authorize, Claude executes)

1. **Data reset.** You authorize the Neon reset explicitly; Claude runs it. Application history
   from the old deployment is dropped. The old manifest stays under `docs/deployments/`.
2. **Pipeline.** Claude deploys the regenerated Goldsky Turbo pipeline and confirms the dataset
   versions and address filters.
3. **Application.** The branch merges through the PR flow after CI; Vercel deploys. Claude
   verifies the deployed commit and the public config endpoint reports the new addresses.
4. **Copy.** The beta says old deposit addresses are retired.

Exit: app live on the new addresses with an empty history.

## Phase 6: canaries and fixtures (you fund, Claude verifies)

| Step | Chain | Action | Signer |
| --- | --- | --- | --- |
| 6.1 | Sepolia | Send about 1 USDC to a test name's new deposit address | You |
| 6.2 | Base Sepolia | Same | You |
| 6.3 | Arbitrum Sepolia | Same | You |
| 6.4 | Arc Testnet | Send native USDC to the deposit address | You |

Four wallet transfers. The relayer processes each deposit and claims each burn; if you want to
exercise the permissionless path yourself, the tool offers `renew` and `completeCCTP` buttons
for one of them. Claude then:

1. records the receipts as the new fixtures under `test/fixtures/`, replacing the old ones;
2. runs the full server and transaction suites against them;
3. confirms the four documented API endpoints return the same shapes for the canary name;
4. records deposit, flow, and renewal evidence per chain in `docs/DEPLOYMENTS.md`.

Exit: CI fully green, API shapes unchanged, canary evidence recorded.

## Phase 7: resolver (optional this round, you sign)

The `namepass.eth` wildcard resolver hard-codes the factory address. If subname resolution to
the new deposit addresses is wanted now, that is two Ethereum mainnet transactions: deploy the
updated resolver and set it on the parent name. This costs real ETH and can wait for the mainnet
release, when the resolver has to change anyway.

## Your transaction count

| Phase | Signatures |
| --- | --- |
| 3 Deployment | 11 |
| 6 Canaries | 4 |
| 7 Resolver, optional | 2 on mainnet |

Everything else is code, read-only verification, or hosted configuration that Claude handles
with your authorization recorded in the conversation.

## Rollback

Until Phase 5 the old deployment and application are untouched; stopping is free. After Phase 5
the reset has happened, and rolling back means redeploying the old configuration against an
empty history, which is the same cost as going forward. Decide at the end of Phase 4, with the
new contracts deployed and verified but the application still on the old ones.
