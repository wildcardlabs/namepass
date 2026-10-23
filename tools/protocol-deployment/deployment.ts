// Deployment logic shared by the browser page and the Anvil dry run.
//
// Everything here is deterministic from `config` and the embedded artifacts: salts, creation code,
// predicted addresses, the exact transactions, and the checks before and after each one. The page
// supplies Rainbow as the signer; the dry run supplies an impersonated account on Anvil forks.

import {
  concatHex,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  parseAbi,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import artifacts from "./artifacts.json";
import { ACTIVE_CHAINS, HUB_CHAIN, type ChainDefinition } from "../../src/lib/chains";

/*//////////////////////////////////////////////////////////////
                              CONFIG
//////////////////////////////////////////////////////////////*/

/** Safe singleton factory. Same address on every target chain; takes `salt ++ initCode`. */
export const SINGLETON_FACTORY: Address = "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7";

export const config = {
  /** Factory owner and timelock proposer/executor. Part of the factory's creation code. */
  owner: getAddress("0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6"),
  hubChainId: 11155111n,
  /** Existing Sepolia test timelock, reused as the governance executor. 60-second delay. */
  timelock: getAddress("0x996cbd179f361B1043Ad1999864eD41496C633c8"),
  /** Changing this moves every address below. */
  saltLabel: "namepass-two-contract-2026-10-12",
  registrar: getAddress(HUB_CHAIN.ensRegistrarAddress!),
  renewerV1: getAddress(HUB_CHAIN.ensRenewerV1Address!),
  referrer: HUB_CHAIN.ensReferrer! as Hex,
} as const;

export const hub = HUB_CHAIN;
/** Hub first, then the L2s in the registry's funding order. */
export const chains: readonly ChainDefinition[] = [
  HUB_CHAIN,
  ...ACTIVE_CHAINS.filter((c) => c.chainId !== HUB_CHAIN.chainId).sort((a, b) => a.fundingOrder - b.fundingOrder),
];

export const factoryAbi = artifacts.NamepassFactory.abi as Abi;
export const adapterAbi = artifacts.ENSV2RenewalAdapter.abi as Abi;
export const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function hashOperation(address,uint256,bytes,bytes32,bytes32) pure returns (bytes32)",
  "function isOperationPending(bytes32) view returns (bool)",
  "function isOperationReady(bytes32) view returns (bool)",
  "function isOperationDone(bytes32) view returns (bool)",
  "function getTimestamp(bytes32) view returns (uint256)",
  "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
  "function execute(address,uint256,bytes,bytes32,bytes32) payable",
]);

/*//////////////////////////////////////////////////////////////
                               PLAN
//////////////////////////////////////////////////////////////*/

export const salt = (name: string): Hex => keccak256(stringToHex(`${config.saltLabel}/${name}`));

export const factoryInitCode: Hex = encodeDeployData({
  abi: factoryAbi,
  bytecode: artifacts.NamepassFactory.bytecode as Hex,
  args: [config.owner, config.hubChainId],
});

export const factoryAddress: Address = getContractAddress({
  opcode: "CREATE2",
  from: SINGLETON_FACTORY,
  salt: salt("NamepassFactory"),
  bytecode: factoryInitCode,
});

export const adapterInitCode: Hex = encodeDeployData({
  abi: adapterAbi,
  bytecode: artifacts.ENSV2RenewalAdapter.bytecode as Hex,
  args: [factoryAddress, getAddress(hub.usdcAddress), config.registrar, config.renewerV1, config.referrer],
});

export const adapterAddress: Address = getContractAddress({
  opcode: "CREATE2",
  from: SINGLETON_FACTORY,
  salt: salt("ENSV2RenewalAdapter"),
  bytecode: adapterInitCode,
});

export const activationCalldata: Hex = encodeFunctionData({
  abi: factoryAbi,
  functionName: "setHelper",
  args: [adapterAddress],
});
export const activationSalt: Hex = salt("activate");

export function initializeCalldata(chain: ChainDefinition): Hex {
  const isHub = chain.chainId === hub.chainId;
  return encodeFunctionData({
    abi: factoryAbi,
    functionName: "initialize",
    args: [
      getAddress(chain.usdcAddress),
      getAddress(chain.tokenMessengerAddress!),
      isHub ? getAddress(chain.messageTransmitterAddress) : "0x0000000000000000000000000000000000000000",
      isHub ? config.timelock : "0x0000000000000000000000000000000000000000",
    ],
  });
}

export function plan() {
  return {
    saltLabel: config.saltLabel,
    singletonFactory: SINGLETON_FACTORY,
    owner: config.owner,
    hubChainId: Number(config.hubChainId),
    timelock: config.timelock,
    contracts: {
      NamepassFactory: {
        address: factoryAddress,
        salt: salt("NamepassFactory"),
        creationCodeHash: keccak256(factoryInitCode),
        runtimeCodeHash: keccak256(artifacts.NamepassFactory.deployedBytecode as Hex),
        constructorArgs: factoryInitCode.slice(artifacts.NamepassFactory.bytecode.length) as Hex,
        compiler: artifacts.NamepassFactory.compiler,
        sourceSha256: artifacts.NamepassFactory.sourceSha256,
      },
      ENSV2RenewalAdapter: {
        address: adapterAddress,
        salt: salt("ENSV2RenewalAdapter"),
        creationCodeHash: keccak256(adapterInitCode),
        runtimeCodeHash: keccak256(artifacts.ENSV2RenewalAdapter.deployedBytecode as Hex),
        constructorArgs: adapterInitCode.slice(artifacts.ENSV2RenewalAdapter.bytecode.length) as Hex,
        compiler: artifacts.ENSV2RenewalAdapter.compiler,
        sourceSha256: artifacts.ENSV2RenewalAdapter.sourceSha256,
      },
    },
    activation: { calldata: activationCalldata, salt: activationSalt },
  };
}

/*//////////////////////////////////////////////////////////////
                               STEPS
//////////////////////////////////////////////////////////////*/

export type StepId =
  | `deploy-factory-${number}`
  | `deploy-adapter-${number}`
  | `initialize-${number}`
  | `schedule-${number}`
  | `activate-${number}`;

export interface Step {
  id: StepId;
  chainId: number;
  title: string;
  detail: string;
  /** The transaction the signer sends. `from` must be `config.owner`. */
  tx: { to: Address; data: Hex; value?: bigint };
}

export function steps(): Step[] {
  const list: Step[] = [];
  for (const chain of chains) {
    const isHub = chain.chainId === hub.chainId;
    list.push({
      id: `deploy-factory-${chain.chainId}`,
      chainId: chain.chainId,
      title: `Deploy factory on ${chain.network}`,
      detail: `Singleton factory CREATE2 with salt ${salt("NamepassFactory")} → ${factoryAddress}`,
      tx: { to: SINGLETON_FACTORY, data: concatHex([salt("NamepassFactory"), factoryInitCode]) },
    });
    if (isHub) {
      list.push({
        id: `deploy-adapter-${chain.chainId}`,
        chainId: chain.chainId,
        title: `Deploy adapter on ${chain.network}`,
        detail: `Singleton factory CREATE2 with salt ${salt("ENSV2RenewalAdapter")} → ${adapterAddress}`,
        tx: { to: SINGLETON_FACTORY, data: concatHex([salt("ENSV2RenewalAdapter"), adapterInitCode]) },
      });
    }
    list.push({
      id: `initialize-${chain.chainId}`,
      chainId: chain.chainId,
      title: `Initialize factory on ${chain.network}`,
      detail: isHub
        ? `USDC, Circle TokenMessenger, Circle MessageTransmitter, governance = test timelock ${config.timelock}`
        : "USDC and Circle TokenMessenger; no transmitter or governance on an L2",
      tx: { to: factoryAddress, data: initializeCalldata(chain) },
    });
    if (isHub) {
      list.push({
        id: `schedule-${chain.chainId}`,
        chainId: chain.chainId,
        title: "Schedule adapter activation on the timelock",
        detail: `setHelper(${adapterAddress}) with the timelock's minimum delay`,
        tx: { to: config.timelock, data: "0x" }, // filled in at send time with the live delay
      });
      list.push({
        id: `activate-${chain.chainId}`,
        chainId: chain.chainId,
        title: "Execute adapter activation after the delay",
        detail: "The factory's currentHelper becomes the adapter",
        tx: {
          to: config.timelock,
          data: encodeFunctionData({
            abi: timelockAbi,
            functionName: "execute",
            args: [factoryAddress, 0n, activationCalldata, "0x" + "0".repeat(64) as Hex, activationSalt],
          }),
        },
      });
    }
  }
  return list;
}

export function scheduleCalldata(delay: bigint): Hex {
  return encodeFunctionData({
    abi: timelockAbi,
    functionName: "schedule",
    args: [factoryAddress, 0n, activationCalldata, "0x" + "0".repeat(64) as Hex, activationSalt, delay],
  });
}

/*//////////////////////////////////////////////////////////////
                           VERIFICATION
//////////////////////////////////////////////////////////////*/

export type StepState = "done" | "ready" | "blocked";

export interface Readiness {
  state: StepState;
  reason: string;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function maskRuntime(code: Hex, refs: Record<string, { start: number; length: number }[]>): string {
  const chars = code.slice(2).toLowerCase().split("");
  for (const list of Object.values(refs)) for (const { start, length } of list) chars.fill("0", start * 2, (start + length) * 2);
  return chars.join("");
}

export async function codeMatches(client: PublicClient, address: Address, name: "NamepassFactory" | "ENSV2RenewalAdapter") {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return false;
  const art = artifacts[name];
  return maskRuntime(code, art.immutableReferences) === maskRuntime(art.deployedBytecode as Hex, art.immutableReferences);
}

async function readFactory<T>(client: PublicClient, functionName: string): Promise<T> {
  return (await client.readContract({ address: factoryAddress, abi: factoryAbi, functionName })) as T;
}

export async function operationId(client: PublicClient): Promise<Hex> {
  return client.readContract({
    address: config.timelock,
    abi: timelockAbi,
    functionName: "hashOperation",
    args: [factoryAddress, 0n, activationCalldata, "0x" + "0".repeat(64) as Hex, activationSalt],
  });
}

/** What the chain says about one step right now. Independent of any saved journal. */
export async function readiness(client: PublicClient, step: Step): Promise<Readiness> {
  const chain = chains.find((c) => c.chainId === step.chainId)!;
  const isHub = chain.chainId === hub.chainId;
  const singleton = await client.getCode({ address: SINGLETON_FACTORY });
  if (!singleton || singleton === "0x") return { state: "blocked", reason: "The singleton factory is not deployed on this chain." };

  if (step.id.startsWith("deploy-factory")) {
    const code = await client.getCode({ address: factoryAddress });
    if (code && code !== "0x") {
      return (await codeMatches(client, factoryAddress, "NamepassFactory"))
        ? { state: "done", reason: "Factory code is present and matches the build." }
        : { state: "blocked", reason: "Something else is deployed at the factory address. Change the salt label." };
    }
    return { state: "ready", reason: "Address is free." };
  }

  if (step.id.startsWith("deploy-adapter")) {
    const code = await client.getCode({ address: adapterAddress });
    if (code && code !== "0x") {
      return (await codeMatches(client, adapterAddress, "ENSV2RenewalAdapter"))
        ? { state: "done", reason: "Adapter code is present and matches the build." }
        : { state: "blocked", reason: "Something else is deployed at the adapter address. Change the salt label." };
    }
    if (!(await codeMatches(client, factoryAddress, "NamepassFactory"))) return { state: "blocked", reason: "Deploy the factory first." };
    return { state: "ready", reason: "Address is free." };
  }

  if (!(await codeMatches(client, factoryAddress, "NamepassFactory"))) return { state: "blocked", reason: "Deploy the factory first." };

  if (step.id.startsWith("initialize")) {
    const usdc = await readFactory<Address>(client, "usdc");
    if (!same(usdc, ZERO)) {
      const ok =
        same(usdc, chain.usdcAddress) &&
        same(await readFactory<Address>(client, "tokenMessenger"), chain.tokenMessengerAddress!) &&
        same(await readFactory<Address>(client, "messageTransmitter"), isHub ? chain.messageTransmitterAddress : ZERO) &&
        same(await readFactory<Address>(client, "ensGovernanceExecutor"), isHub ? config.timelock : ZERO);
      return ok
        ? { state: "done", reason: "Factory is initialized with the expected routes." }
        : { state: "blocked", reason: "Factory is initialized with different routes. This deployment cannot be reused." };
    }
    if (!same(await readFactory<Address>(client, "owner"), config.owner)) return { state: "blocked", reason: "The factory owner is not the deploying wallet." };
    if (isHub && !(await codeMatches(client, adapterAddress, "ENSV2RenewalAdapter"))) return { state: "blocked", reason: "Deploy the adapter first." };
    return { state: "ready", reason: "Factory is uninitialized." };
  }

  // Timelock steps, hub only.
  const current = await readFactory<Address>(client, "currentHelper");
  if (same(current, adapterAddress)) return { state: "done", reason: "Adapter is active." };
  if (same(await readFactory<Address>(client, "usdc"), ZERO)) return { state: "blocked", reason: "Initialize the factory first." };
  const id = await operationId(client);
  const [pending, ready, done] = await Promise.all([
    client.readContract({ address: config.timelock, abi: timelockAbi, functionName: "isOperationPending", args: [id] }),
    client.readContract({ address: config.timelock, abi: timelockAbi, functionName: "isOperationReady", args: [id] }),
    client.readContract({ address: config.timelock, abi: timelockAbi, functionName: "isOperationDone", args: [id] }),
  ]);
  if (step.id.startsWith("schedule")) {
    if (done) return { state: "blocked", reason: "The activation operation already executed but the adapter is not active. Investigate." };
    if (pending) return { state: "done", reason: "Activation is scheduled." };
    const role = await client.readContract({ address: config.timelock, abi: timelockAbi, functionName: "PROPOSER_ROLE" });
    const has = await client.readContract({ address: config.timelock, abi: timelockAbi, functionName: "hasRole", args: [role, config.owner] });
    return has ? { state: "ready", reason: "Not yet scheduled." } : { state: "blocked", reason: "The deploying wallet is not a timelock proposer." };
  }
  if (!pending) return { state: "blocked", reason: "Schedule the activation first." };
  if (!ready) {
    const at = await client.readContract({ address: config.timelock, abi: timelockAbi, functionName: "getTimestamp", args: [id] });
    return { state: "blocked", reason: `Waiting for the timelock delay until ${new Date(Number(at) * 1000).toISOString()}.` };
  }
  const role = await client.readContract({ address: config.timelock, abi: timelockAbi, functionName: "EXECUTOR_ROLE" });
  const has = await client.readContract({ address: config.timelock, abi: timelockAbi, functionName: "hasRole", args: [role, config.owner] });
  return has ? { state: "ready", reason: "The delay has elapsed." } : { state: "blocked", reason: "The deploying wallet is not a timelock executor." };
}

/** Full post-deployment verification for one chain. Throws on the first mismatch. */
export async function verifyChain(client: PublicClient, chainId: number): Promise<string[]> {
  const chain = chains.find((c) => c.chainId === chainId)!;
  const isHub = chainId === hub.chainId;
  const notes: string[] = [];
  const assert = (ok: boolean, message: string) => {
    if (!ok) throw new Error(`${chain.network}: ${message}`);
    notes.push(message);
  };
  assert(await codeMatches(client, factoryAddress, "NamepassFactory"), "factory runtime matches the build");
  assert(same(await readFactory<Address>(client, "owner"), config.owner), "factory owner is the deploying wallet");
  assert(same(await readFactory<Address>(client, "usdc"), chain.usdcAddress), "factory token is this chain's USDC");
  assert(same(await readFactory<Address>(client, "tokenMessenger"), chain.tokenMessengerAddress!), "factory messenger is Circle's TokenMessenger");
  assert(same(await readFactory<Address>(client, "l1Helper"), factoryAddress), "hub settlement address is the factory itself");
  assert((await readFactory<bigint>(client, "GAS_ALLOWANCE")) === 100_000n, "gas allowance is $0.10");
  if (isHub) {
    assert(same(await readFactory<Address>(client, "messageTransmitter"), chain.messageTransmitterAddress), "factory transmitter is Circle's MessageTransmitter");
    assert(same(await readFactory<Address>(client, "ensGovernanceExecutor"), config.timelock), "governance executor is the test timelock");
    assert(await codeMatches(client, adapterAddress, "ENSV2RenewalAdapter"), "adapter runtime matches the build");
    const read = (functionName: string) => client.readContract({ address: adapterAddress, abi: adapterAbi, functionName });
    assert((await read("interfaceVersion")) === 2n, "adapter interface version is 2");
    assert(same((await read("factory")) as string, factoryAddress), "adapter factory is the new factory");
    assert(same((await read("gateway")) as string, factoryAddress), "adapter gateway is the new factory");
    assert(same((await read("paymentToken")) as string, chain.usdcAddress), "adapter token is USDC");
    assert(same((await read("ethRegistrar")) as string, config.registrar), "adapter registrar matches");
    assert(same((await read("ethRenewerV1")) as string, config.renewerV1), "adapter V1 renewer matches");
    assert(same((await read("referrer")) as string, config.referrer), "adapter referrer matches");
    assert(same(await readFactory<Address>(client, "currentHelper"), adapterAddress), "adapter is active");
    const [duration, charge] = (await client.readContract({
      address: factoryAddress,
      abi: factoryAbi,
      functionName: "quote",
      args: ["skellat", 400_000n],
    })) as [bigint, bigint];
    assert(duration > 0n && charge > 0n && charge <= 400_000n, "a live quote through the factory is valid");
  } else {
    assert((await readFactory<number>(client, "finality")) === 2000, "finality starts at Standard");
    assert(same(await readFactory<Address>(client, "ensGovernanceExecutor"), ZERO), "no governance on an L2");
  }
  return notes;
}
