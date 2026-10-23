// Deployment logic for the Sepolia `namepass.eth` wildcard resolver.
//
// Two transactions on Ethereum Sepolia, signed by the owner of `namepass.eth` in the ENS V2 ETH
// registry: deploy `NamepassResolver`, then `setResolver` on the name. Everything else is a
// read: the registry's view of the name, the universal resolver's view of the resolver, and the
// end-to-end resolution of a subname through the CCIP-Read gateway, which activates the label in
// the hosted application and returns the deposit address the factory derives.

import {
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import artifacts from "../protocol-deployment/artifacts.json";
import { HUB_CHAIN } from "../../src/lib/chains";
import { depositAddress } from "../../src/lib/namepass";

/*//////////////////////////////////////////////////////////////
                              CONFIG
//////////////////////////////////////////////////////////////*/

export const config = {
  /** Owner of `namepass.eth` in the ENS V2 ETH registry on Sepolia; signs both transactions. */
  owner: getAddress("0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6"),
  label: "namepass",
  name: "namepass.eth",
  /** ENS V2 Sepolia, October 1 redeploy. Read from the root registry's `getSubregistry("eth")`. */
  ethRegistry: getAddress("0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4"),
  rootRegistry: getAddress("0xB458D6a3a77919449d03e7A6903C26827c1eC43f"),
  /** Same address on mainnet and Sepolia; routes to UniversalResolverV2. */
  universalResolver: getAddress("0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe"),
  /** `RegistryRolesLib.ROLE_SET_RESOLVER`. */
  roleSetResolver: 1n << 24n,
  /** The October 23 factory the resolver hard-codes; the same derivation as `depositAddress`. */
  factory: getAddress(HUB_CHAIN.factoryAddress!),
  /** Constructor arguments. The apex address mirrors the mainnet `namepass.eth` addr record. */
  apexAddr: getAddress("0xf80E70eBC4184850f9fBCDC8De7CB4C86C46abF6"),
  avatar: "",
  description: "ENS renewals via universal USDC deposit addresses",
  url: "https://beta.namepass.com/",
  /** POST form: no `{data}` placeholder, so clients POST `{ data, sender }`. */
  gatewayUrl: "https://beta.namepass.com/api/ccip",
} as const;

export const hub = HUB_CHAIN;
export const resolverAbi = artifacts.NamepassResolver.abi as Abi;

export const registryAbi = parseAbi([
  "function findTokenId(string label) view returns (uint256)",
  "function getResolver(string label) view returns (address)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getResource(uint256 anyId) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
  "function setResolver(uint256 anyId, address resolver)",
]);

export const universalResolverAbi = parseAbi([
  "function findResolver(bytes name) view returns (address resolver, bytes32 node, uint256 offset)",
]);

export const factoryAbi = parseAbi(["function predictWallet(string label) view returns (address)"]);

/*//////////////////////////////////////////////////////////////
                               PLAN
//////////////////////////////////////////////////////////////*/

export const resolverInitCode: Hex = encodeDeployData({
  abi: resolverAbi,
  bytecode: artifacts.NamepassResolver.bytecode as Hex,
  args: [config.apexAddr, config.avatar, config.description, config.url, config.gatewayUrl],
});

export function plan() {
  return {
    chainId: hub.chainId,
    name: config.name,
    owner: config.owner,
    ethRegistry: config.ethRegistry,
    rootRegistry: config.rootRegistry,
    universalResolver: config.universalResolver,
    factory: config.factory,
    constructorArgs: {
      apexAddr: config.apexAddr,
      avatar: config.avatar,
      description: config.description,
      url: config.url,
      gatewayUrl: config.gatewayUrl,
    },
    contract: {
      name: "NamepassResolver",
      creationCodeHash: keccak256(resolverInitCode),
      runtimeCodeHash: keccak256(artifacts.NamepassResolver.deployedBytecode as Hex),
      encodedConstructorArgs: resolverInitCode.slice(artifacts.NamepassResolver.bytecode.length) as Hex,
      compiler: artifacts.NamepassResolver.compiler,
      sourceSha256: artifacts.NamepassResolver.sourceSha256,
    },
  };
}

/** DNS wire encoding of a name, as the universal resolver takes it. */
export function dnsEncode(name: string): Hex {
  let out = "0x";
  for (const part of name.split(".")) {
    const bytes = new TextEncoder().encode(part);
    out += bytes.length.toString(16).padStart(2, "0");
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
  }
  return `${out}00` as Hex;
}

export type StepId = "deploy-resolver" | "set-resolver";

export interface Step {
  id: StepId;
  title: string;
  detail: string;
}

export const steps: Step[] = [
  {
    id: "deploy-resolver",
    title: "Deploy NamepassResolver on Sepolia",
    detail: `Plain CREATE from the owner wallet with the constructor arguments above. Factory ${config.factory} is compiled in.`,
  },
  {
    id: "set-resolver",
    title: `Set the resolver on ${config.name}`,
    detail: `ETH registry setResolver(tokenId, resolver); the owner holds ROLE_SET_RESOLVER on the name.`,
  },
];

export function setResolverCalldata(tokenId: bigint, resolver: Address): Hex {
  return encodeFunctionData({ abi: registryAbi, functionName: "setResolver", args: [tokenId, resolver] });
}

/*//////////////////////////////////////////////////////////////
                           VERIFICATION
//////////////////////////////////////////////////////////////*/

export type StepState = "done" | "ready" | "blocked";

export interface Readiness {
  state: StepState;
  reason: string;
}

export const ZERO = "0x0000000000000000000000000000000000000000";
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function maskRuntime(code: Hex, refs: Record<string, { start: number; length: number }[]>): string {
  const chars = code.slice(2).toLowerCase().split("");
  for (const list of Object.values(refs)) for (const { start, length } of list) chars.fill("0", start * 2, (start + length) * 2);
  return chars.join("");
}

/** True when the code at `address` is this build's resolver, immutables masked. */
export async function codeMatches(client: PublicClient, address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return false;
  const art = artifacts.NamepassResolver;
  return maskRuntime(code, art.immutableReferences) === maskRuntime(art.deployedBytecode as Hex, art.immutableReferences);
}

export interface NameState {
  tokenId: bigint;
  owner: Address;
  expiry: bigint;
  resolver: Address;
  resource: bigint;
  ownerMaySetResolver: boolean;
}

/** The ETH registry's current view of `namepass`. */
export async function readName(client: PublicClient): Promise<NameState> {
  const r = (functionName: string, args: unknown[] = []) =>
    client.readContract({ address: config.ethRegistry, abi: registryAbi, functionName: functionName as never, args: args as never });
  const tokenId = (await r("findTokenId", [config.label])) as bigint;
  const [owner, expiry, resolver, resource] = await Promise.all([
    r("ownerOf", [tokenId]) as Promise<Address>,
    r("getExpiry", [tokenId]) as Promise<bigint>,
    r("getResolver", [config.label]) as Promise<Address>,
    r("getResource", [tokenId]) as Promise<bigint>,
  ]);
  const ownerMaySetResolver = (await r("hasRoles", [resource, config.roleSetResolver, owner])) as boolean;
  return { tokenId, owner, expiry, resolver, resource, ownerMaySetResolver };
}

/** What the chain says about one step. `resolver` is the deployed address from the journal, if any. */
export async function readiness(client: PublicClient, step: Step, resolver: Address | undefined, name: NameState): Promise<Readiness> {
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (step.id === "deploy-resolver") {
    if (resolver) {
      return (await codeMatches(client, resolver))
        ? { state: "done", reason: `Resolver code at ${resolver} matches the build.` }
        : { state: "blocked", reason: `The journal names ${resolver} but its code does not match the build. Clear the journal to redeploy.` };
    }
    if (!same(name.owner, config.owner)) return { state: "blocked", reason: `The name is owned by ${name.owner}, not the configured owner.` };
    return { state: "ready", reason: "No resolver deployed yet." };
  }
  if (!resolver || !(await codeMatches(client, resolver))) return { state: "blocked", reason: "Deploy the resolver first." };
  if (same(name.resolver, resolver)) return { state: "done", reason: "The registry names the new resolver." };
  if (!same(name.owner, config.owner)) return { state: "blocked", reason: `The name is owned by ${name.owner}, not the configured owner.` };
  if (name.expiry <= nowSeconds) return { state: "blocked", reason: "The name is expired in the ETH registry." };
  if (!name.ownerMaySetResolver) return { state: "blocked", reason: "The owner does not hold ROLE_SET_RESOLVER on the name." };
  return { state: "ready", reason: `The registry names ${name.resolver}; it will name ${resolver}.` };
}

/** Full post-deployment verification. Throws on the first mismatch. */
export async function verify(client: PublicClient, resolver: Address): Promise<string[]> {
  const notes: string[] = [];
  const assert = (ok: boolean, message: string) => {
    if (!ok) throw new Error(message);
    notes.push(message);
  };
  const read = (functionName: string) => client.readContract({ address: resolver, abi: resolverAbi, functionName });
  assert(await codeMatches(client, resolver), "resolver runtime matches the build");
  assert(same((await read("owner")) as string, config.owner), "resolver owner is the name owner");
  assert(same((await read("apexAddr")) as string, config.apexAddr), "apex address matches the plan");
  assert((await read("gatewayUrl")) === config.gatewayUrl, "gateway URL matches the plan");
  assert((await read("url")) === config.url, "url record matches the plan");
  assert((await read("description")) === config.description, "description record matches the plan");
  assert(
    (await client.readContract({ address: resolver, abi: resolverAbi, functionName: "supportsInterface", args: ["0x9061b923"] })) === true,
    "resolver supports ENSIP-10",
  );
  const name = await readName(client);
  assert(same(name.resolver, resolver), "ETH registry names the resolver");
  const [found, , offset] = await client.readContract({
    address: config.universalResolver,
    abi: universalResolverAbi,
    functionName: "findResolver",
    args: [dnsEncode(config.name)],
  });
  assert(same(found, resolver) && offset === 0n, "universal resolver finds the resolver for namepass.eth");
  const [subFound, , subOffset] = await client.readContract({
    address: config.universalResolver,
    abi: universalResolverAbi,
    functionName: "findResolver",
    args: [dnsEncode(`vitalik.${config.name}`)],
  });
  assert(same(subFound, resolver) && subOffset === BigInt(1 + "vitalik".length), "universal resolver finds the same resolver for a subname");
  const apex = await client.getEnsAddress({ name: config.name, universalResolverAddress: config.universalResolver });
  assert(!!apex && same(apex, config.apexAddr), "namepass.eth resolves to the apex address through the universal resolver");
  return notes;
}

export interface SubnameResolution {
  label: string;
  subname: string;
  resolved: Address | null;
  expected: Address;
  onChain: Address;
}

/** Resolve `<label>.namepass.eth` through the universal resolver and the gateway; compare with the factory. */
export async function resolveSubname(client: PublicClient, label: string): Promise<SubnameResolution> {
  const subname = `${label}.${config.name}`;
  const expected = getAddress(depositAddress(label));
  const onChain = await client.readContract({ address: config.factory, abi: factoryAbi, functionName: "predictWallet", args: [label] });
  const resolved = await client.getEnsAddress({ name: subname, universalResolverAddress: config.universalResolver });
  return { label, subname, resolved: resolved ? getAddress(resolved) : null, expected, onChain: getAddress(onChain) };
}
