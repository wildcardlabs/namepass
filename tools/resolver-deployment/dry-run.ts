// Runs both resolver steps against an Anvil fork of Sepolia with the owner wallet impersonated,
// then verifies and resolves a subname through the real hosted gateway. Read-only toward Sepolia;
// the only external write is the gateway's activation of the chosen label in the hosted application.
//
//   anvil --fork-url <sepolia rpc> --port 8545 --chain-id 11155111 --auto-impersonate
//   node --import tsx tools/resolver-deployment/dry-run.ts [label]
import { createPublicClient, createWalletClient, getAddress, http, parseEther, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { config, readName, readiness, resolveSubname, resolverInitCode, setResolverCalldata, steps, verify } from "./deployment";

const rpc = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const label = process.argv[2] ?? "nick";
const chain = { ...sepolia, rpcUrls: { default: { http: [rpc] } } };
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 120_000 }) });
const wallet = createWalletClient({ chain, transport: http(rpc, { timeout: 120_000 }) });
const owner = config.owner;

await client.request({ method: "anvil_setBalance" as never, params: [owner, `0x${parseEther("10").toString(16)}`] as never });
let name = await readName(client);
console.log("registry:", { tokenId: `0x${name.tokenId.toString(16)}`, owner: name.owner, resolver: name.resolver, expiry: new Date(Number(name.expiry) * 1000).toISOString(), role: name.ownerMaySetResolver });

const expect = async (id: (typeof steps)[number]["id"], resolver: Address | undefined, state: string) => {
  const step = steps.find((s) => s.id === id)!;
  const r = await readiness(client, step, resolver, name);
  if (r.state !== state) throw new Error(`${id}: expected ${state}, got ${r.state}: ${r.reason}`);
  console.log(`${id}: ${r.state} — ${r.reason}`);
};

await expect("deploy-resolver", undefined, "ready");
await expect("set-resolver", undefined, "blocked");
const deployHash = await wallet.sendTransaction({ account: owner, data: resolverInitCode, chain });
const deployReceipt = await client.waitForTransactionReceipt({ hash: deployHash });
if (deployReceipt.status !== "success" || !deployReceipt.contractAddress) throw new Error("deployment reverted");
const resolver = getAddress(deployReceipt.contractAddress);
console.log(`deployed resolver at ${resolver}, gas ${deployReceipt.gasUsed}`);
await expect("deploy-resolver", resolver, "done");
await expect("set-resolver", resolver, "ready");

const setHash = await wallet.sendTransaction({ account: owner, to: config.ethRegistry, data: setResolverCalldata(name.tokenId, resolver) as Hex, chain });
const setReceipt = await client.waitForTransactionReceipt({ hash: setHash });
if (setReceipt.status !== "success") throw new Error("setResolver reverted");
console.log(`setResolver confirmed, gas ${setReceipt.gasUsed}`);
name = await readName(client);
await expect("set-resolver", resolver, "done");

const notes = await verify(client, resolver);
console.log(`verify: ${notes.length} checks passed\n  ${notes.join("\n  ")}`);
const result = await resolveSubname(client, label);
console.log("resolution:", result);
if (!result.resolved || result.resolved !== result.onChain || result.expected !== result.onChain) throw new Error("subname resolution does not match the factory");
console.log("dry run complete");
