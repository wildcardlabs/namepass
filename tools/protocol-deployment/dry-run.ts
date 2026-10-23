// Runs every deployment step against Anvil forks and verifies each chain.
//
//   anvil --fork-url <sepolia rpc> --auto-impersonate --port 8545 &
//   anvil --fork-url https://sepolia.base.org --auto-impersonate --port 8546 &
//   anvil --fork-url https://sepolia-rollup.arbitrum.io/rpc --auto-impersonate --port 8547 &
//   anvil --fork-url https://rpc.testnet.arc.network --auto-impersonate --port 8548 &
//   DRY_RUN_RPC_11155111=http://127.0.0.1:8545 DRY_RUN_RPC_84532=http://127.0.0.1:8546 \
//   DRY_RUN_RPC_421614=http://127.0.0.1:8547 DRY_RUN_RPC_5042002=http://127.0.0.1:8548 \
//     node --import tsx tools/protocol-deployment/dry-run.ts
//
// The owner wallet is impersonated, so the senders match the real deployment exactly. Chains
// without a DRY_RUN_RPC variable are skipped and reported.

import { createPublicClient, createTestClient, createWalletClient, http, type PublicClient } from "viem";
import { chains, config, factoryAddress, adapterAddress, hub, plan, readiness, scheduleCalldata, steps, timelockAbi, verifyChain } from "./deployment";

const results: string[] = [];
const clients = new Map<number, { pub: PublicClient; wallet: ReturnType<typeof createWalletClient>; test: ReturnType<typeof createTestClient> }>();

for (const chain of chains) {
  const rpc = process.env[`DRY_RUN_RPC_${chain.chainId}`];
  if (!rpc) {
    results.push(`${chain.network}: skipped, no DRY_RUN_RPC_${chain.chainId}`);
    continue;
  }
  const definition = { id: chain.chainId, name: chain.network, nativeCurrency: { name: "gas", symbol: "GAS", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
  const pub = createPublicClient({ chain: definition, transport: http(rpc) });
  const test = createTestClient({ chain: definition, mode: "anvil", transport: http(rpc) });
  const wallet = createWalletClient({ chain: definition, transport: http(rpc), account: config.owner });
  await test.impersonateAccount({ address: config.owner });
  await test.setBalance({ address: config.owner, value: 10n ** 20n });
  clients.set(chain.chainId, { pub, wallet, test });
}

console.log(JSON.stringify(plan(), null, 2));

for (const step of steps()) {
  const c = clients.get(step.chainId);
  if (!c) continue;
  let state = await readiness(c.pub, step);
  if (state.state === "done") {
    results.push(`${step.title}: already done (${state.reason})`);
    continue;
  }
  if (state.state === "blocked" && step.id.startsWith("activate")) {
    await c.test.increaseTime({ seconds: 3600 });
    await c.test.mine({ blocks: 1 });
    state = await readiness(c.pub, step);
  }
  if (state.state !== "ready") throw new Error(`${step.title}: ${state.state}: ${state.reason}`);
  let data = step.tx.data;
  if (step.id.startsWith("schedule")) {
    const delay = await c.pub.readContract({ address: config.timelock, abi: timelockAbi, functionName: "getMinDelay" });
    data = scheduleCalldata(delay);
  }
  const hash = await c.wallet.sendTransaction({ account: config.owner, to: step.tx.to, data, chain: null });
  const receipt = await c.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${step.title}: reverted`);
  const after = await readiness(c.pub, step);
  if (after.state !== "done") throw new Error(`${step.title}: receipt ok but state is ${after.state}: ${after.reason}`);
  results.push(`${step.title}: ${receipt.gasUsed} gas, ${after.reason}`);
}

for (const chain of chains) {
  const c = clients.get(chain.chainId);
  if (!c) continue;
  const notes = await verifyChain(c.pub, chain.chainId);
  results.push(`${chain.network}: ${notes.length} checks passed`);
  const code = await c.pub.getCode({ address: factoryAddress });
  results.push(`${chain.network}: factory code ${code?.length ? (code.length - 2) / 2 : 0} bytes at ${factoryAddress}`);
}
results.push(`adapter at ${adapterAddress} on ${hub.network}`);

console.log(results.join("\n"));
