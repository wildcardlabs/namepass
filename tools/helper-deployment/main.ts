import "@fontsource-variable/geist";
import "./style.css";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  zeroAddress,
  zeroHash,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import artifact from "./helper-artifact.json";

// An isolated localhost tool. It does not load application/server environment variables.
const config = {
  factory: getAddress("0x2dCB5CA6b21372b43e37C35Da8D5D15160423150"),
  gateway: getAddress("0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f"),
  pointer: getAddress("0x774f942194d612e126A05Ce40a3A4D88AfBB6ae6"),
  timelock: getAddress("0x996cbd179f361B1043Ad1999864eD41496C633c8"),
  token: getAddress("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"),
  registrar: getAddress("0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3"),
  v1: getAddress("0xf2ece44980778966b8a0fccb3a9e339440f6e045"),
  base: getAddress("0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85"),
  oldHelper: getAddress("0x7Bfee7c257ff48f8D787A61F15925e24743C8F88"),
  referrer:
    "0x0000000000000000000000001208a26faa0f4ac65b42098419eb4daa5e580ac6" as Hex,
};
const abi = parseAbi([
  "function currentHelper() view returns (address)",
  "function ensGovernanceExecutor() view returns (address)",
  "function gateway() view returns (address)",
  "function factory() view returns (address)",
  "function paymentToken() view returns (address)",
  "function pointer() view returns (address)",
  "function ethRegistrar() view returns (address)",
  "function ethRenewerV1() view returns (address)",
  "function referrer() view returns (bytes32)",
  "function interfaceVersion() view returns (uint256)",
  "function ETH_REGISTRY() view returns (address)",
  "function BASE_REGISTRAR() view returns (address)",
  "function rentPriceOracle() view returns (address)",
  "function controllers(address) view returns (bool)",
  "function isRenewable(string) view returns (bool)",
  "function quote(string,uint256) view returns (uint64,uint256)",
  "function getMinDelay() view returns (uint256)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function hashOperation(address,uint256,bytes,bytes32,bytes32) pure returns (bytes32)",
  "function getTimestamp(bytes32) view returns (uint256)",
  "function isOperationReady(bytes32) view returns (bool)",
  "function isOperationDone(bytes32) view returns (bool)",
  "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
  "function execute(address,uint256,bytes,bytes32,bytes32) payable",
  "function setHelper(address)",
]);
const helperAbi = artifact.abi as Abi;
const constructorArgs = [
  config.gateway,
  config.factory,
  config.token,
  config.registrar,
  config.v1,
  config.referrer,
];
const storageKey = `namepass-helper-rotation:${sepolia.id}:${config.pointer.toLowerCase()}`;
type Journal = {
  helper?: Address;
  deploymentTx?: Hex;
  scheduleTx?: Hex;
  activationTx?: Hex;
  salt?: Hex;
  operationId?: Hex;
};
const isHash = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
function loadJournal(): Journal {
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey) ?? "{}",
    ) as Journal;
    for (const key of [
      "deploymentTx",
      "scheduleTx",
      "activationTx",
      "salt",
      "operationId",
    ] as const) {
      if (value[key] !== undefined && !isHash(value[key]))
        throw new Error("Invalid saved journal");
    }
    if (value.helper) value.helper = getAddress(value.helper);
    return value;
  } catch {
    return {};
  }
}
let journal = loadJournal();
function save() {
  localStorage.setItem(storageKey, JSON.stringify(journal));
}
type ProviderInfo = { uuid: string; name: string; rdns?: string };
type Wallet = { info: ProviderInfo; provider: EIP1193Provider };
const wallets: Wallet[] = [];
let provider: EIP1193Provider | undefined;
let account: Address | undefined;
let busy = false;
let verified = false;
let helperVerified = false;
let active = false;
let ready = false;
let scheduled = false;
let proposer = false;
let executor = false;
let delay = 60n;
let readyAt = 0;
let chainTimeOffset = 0;

const app = document.querySelector<HTMLDivElement>("#app")!;
if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) {
  app.textContent = "This deployment tool is only available on localhost.";
  throw new Error("Localhost required");
}
app.innerHTML = `
  <header><span class="brand">Namepass</span><span class="badge">Sepolia · temporary deployment tool</span></header>
  <h1>Reconnect ENS renewals</h1>
  <p>Deploy the existing helper with the October ENS addresses, then activate it through the existing governance timelock.</p>
  <div class="notice">The factory, gateway and deposit addresses stay the same. The funded <strong>farcaster.eth</strong> payment stays in place. Sign each transaction in your browser wallet.</div>
  <section class="panel">
    <div class="row between"><h2>Browser wallet</h2><div class="row"><select id="wallet" aria-label="Browser wallet"></select><button id="connect">Connect Rainbow</button><button id="switch" class="secondary hidden">Switch to Sepolia</button></div></div>
    <div id="wallet-address" class="status">Connect your Rainbow browser wallet to check the deployment.</div>
    <div class="actions row"><button id="refresh" class="secondary" disabled>Check contracts & progress</button><button id="export" class="secondary">Export deployment record</button></div>
    <div id="verify-results" class="status" aria-live="polite"></div>
  </section>
  <div id="error" class="error hidden" role="alert"></div>
  <section class="steps">
    <div class="step"><span class="number">01 · Deploy</span><h2>Replacement helper</h2><p>Use the verified, compiled helper code with the new ETHRegistrar and ETHRenewerV1.</p><button id="deploy" disabled>Deploy helper</button><div id="deployment" class="tx"></div></div>
    <div class="step"><span class="number">02 · Schedule</span><h2>Governance update</h2><p>Schedule the existing pointer’s <code>setHelper</code> call. The live timelock delay is <span id="delay">60</span> seconds.</p><button id="schedule" disabled>Schedule activation</button><div id="scheduling" class="tx"></div></div>
    <div class="step"><span class="number">03 · Activate</span><h2>Resume renewals</h2><p id="countdown">After the delay, check progress and sign the activation transaction.</p><button id="execute" disabled>Activate helper</button><div id="activation" class="tx"></div></div>
  </section>
  <section class="panel"><h2>Deployment inputs</h2><div class="fields" id="inputs"></div></section>
  <section class="panel"><h2>Resume an existing deployment</h2><p>If you already deployed this helper, paste its address. The page checks its runtime code and every constructor value before enabling governance actions.</p><label for="existing">Helper address</label><input id="existing" placeholder="0x…" autocomplete="off" spellcheck="false"><div class="actions"><button id="resume" class="secondary" disabled>Verify deployed helper</button></div><div id="helper-address" class="tx"></div></section>
  <p class="small">Contract checks use a public Sepolia RPC. Rainbow handles all transaction signatures. This page contains no backend keys and does not submit the renewal payment itself.</p>
`;
function el<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
function text(id: string, value: string) {
  el(id).textContent = value;
}
for (const [label, value] of [
  ["New ETHRegistrar", config.registrar],
  ["New ETHRenewerV1", config.v1],
  ["Permanent factory", config.factory],
  ["Permanent gateway", config.gateway],
  ["Existing helper pointer", config.pointer],
  ["Existing timelock", config.timelock],
  ["Sepolia USDC", config.token],
  ["ENS referrer", config.referrer],
]) {
  const item = document.createElement("dl");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  const code = document.createElement("code");
  code.textContent = value;
  dd.append(code);
  item.append(dt, dd);
  el("inputs").append(item);
}
function txLink(id: string, hash: Hex | undefined) {
  const container = el(id);
  container.replaceChildren();
  if (!hash) return;
  const link = document.createElement("a");
  link.href = `https://sepolia.etherscan.io/tx/${hash}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `View transaction ↗ ${hash}`;
  container.append(link);
}
function render() {
  const enabled = !busy && !!account && verified;
  el<HTMLButtonElement>("connect").disabled = busy;
  el<HTMLSelectElement>("wallet").disabled = busy;
  el<HTMLButtonElement>("switch").disabled = busy;
  el<HTMLButtonElement>("refresh").disabled = busy || !provider;
  el<HTMLButtonElement>("resume").disabled = !enabled || active;
  el<HTMLButtonElement>("deploy").disabled =
    !enabled || !!journal.deploymentTx || !!journal.helper || active;
  el<HTMLButtonElement>("schedule").disabled =
    !enabled || !helperVerified || !proposer || scheduled || active;
  el<HTMLButtonElement>("execute").disabled =
    !enabled || !helperVerified || !executor || !ready || active;
  text("delay", delay.toString());
  txLink("deployment", journal.deploymentTx);
  txLink("scheduling", journal.scheduleTx);
  txLink("activation", journal.activationTx);
  text(
    "helper-address",
    journal.helper
      ? `Helper: ${journal.helper}${helperVerified ? " · runtime and inputs verified" : " · awaiting verification"}`
      : "",
  );
  if (active) {
    text("execute", "Helper active");
    text(
      "countdown",
      "The pointer now uses the replacement helper. Automation can retry the funded payment.",
    );
  } else if (scheduled) {
    const remaining = Math.max(
      0,
      Math.ceil(readyAt - (Date.now() / 1000 + chainTimeOffset)),
    );
    text(
      "countdown",
      ready
        ? "The operation is ready. Sign activation to update the pointer."
        : remaining > 0
          ? `Timelock: about ${remaining}s remaining. Check progress after the delay.`
          : "The delay has elapsed. Check progress to confirm on-chain readiness.",
    );
  }
}
setInterval(render, 1000); // Display-only countdown; no background RPC polling.
function requireClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http("https://ethereum-sepolia-rpc.publicnode.com", {
      timeout: 15000,
      retryCount: 1,
    }),
  });
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
async function checkWallet() {
  assert(provider && account, "Connect your browser wallet first.");
  const chainId = await provider.request({ method: "eth_chainId" });
  el("switch").classList.toggle("hidden", Number(chainId) === sepolia.id);
  assert(
    Number(chainId) === sepolia.id,
    "Switch your wallet to Ethereum Sepolia before continuing.",
  );
  const accounts = await provider.request({ method: "eth_accounts" });
  assert(
    accounts[0] && same(accounts[0], account),
    "The wallet account changed. Connect again and recheck the contracts.",
  );
  return account;
}
function maskRuntime(code: string) {
  const chars = code.slice(2).toLowerCase().split("");
  for (const refs of Object.values(artifact.immutableReferences)) {
    for (const { start, length } of refs)
      chars.fill("0", start * 2, (start + length) * 2);
  }
  return chars.join("");
}
async function verifyHelper(helper: Address) {
  const client = requireClient();
  const blockNumber = await client.getBlockNumber();
  const code = await client.getCode({ address: helper, blockNumber });
  assert(
    code && maskRuntime(code) === maskRuntime(artifact.deployedBytecode),
    "The helper runtime does not match the compiled contract.",
  );
  for (const [functionName, expected] of [
    ["gateway", config.gateway],
    ["factory", config.factory],
    ["paymentToken", config.token],
    ["ethRegistrar", config.registrar],
    ["ethRenewerV1", config.v1],
  ] as const) {
    const value = await client.readContract({
      address: helper,
      abi,
      functionName,
      blockNumber,
    });
    assert(
      same(value, expected),
      `The helper ${functionName} does not match the deployment inputs.`,
    );
  }
  assert(
    (await client.readContract({
      address: helper,
      abi,
      functionName: "interfaceVersion",
      blockNumber,
    })) === 1n,
    "Unsupported helper interface.",
  );
  assert(
    same(
      await client.readContract({
        address: helper,
        abi,
        functionName: "referrer",
        blockNumber,
      }),
      config.referrer,
    ),
    "Incorrect ENS referrer.",
  );
  const [duration, charge] = await client.readContract({
    address: helper,
    abi,
    functionName: "quote",
    args: ["farcaster", 400000n],
    blockNumber,
  });
  assert(
    duration > 0n && charge > 0n && charge <= 400000n,
    "The funded renewal quote is not valid.",
  );
  helperVerified = true;
}
async function reconcile() {
  const client = requireClient();
  if (!journal.helper && journal.deploymentTx) {
    const receipt = await client.getTransactionReceipt({
      hash: journal.deploymentTx,
    });
    assert(
      receipt.status === "success" && receipt.contractAddress,
      "The saved deployment did not succeed.",
    );
    journal.helper = getAddress(receipt.contractAddress);
    save();
  }
  if (journal.helper) await verifyHelper(journal.helper);
  active =
    !!journal.helper &&
    same(
      await client.readContract({
        address: config.pointer,
        abi,
        functionName: "currentHelper",
      }),
      journal.helper,
    );
  if (journal.helper && journal.salt) {
    const operationId = await client.readContract({
      address: config.timelock,
      abi,
      functionName: "hashOperation",
      args: operationArgs(),
    });
    assert(
      !journal.operationId || same(journal.operationId, operationId),
      "The saved operation does not match this helper.",
    );
    journal.operationId = operationId;
    save();
    const timestamp = await client.readContract({
      address: config.timelock,
      abi,
      functionName: "getTimestamp",
      args: [operationId],
    });
    scheduled = timestamp > 0n;
    readyAt = Number(timestamp);
    ready = await client.readContract({
      address: config.timelock,
      abi,
      functionName: "isOperationReady",
      args: [operationId],
    });
    const done = await client.readContract({
      address: config.timelock,
      abi,
      functionName: "isOperationDone",
      args: [operationId],
    });
    assert(
      !done || active,
      "This operation completed, but the pointer no longer selects this helper.",
    );
  }
}
async function preflight() {
  verified = false;
  helperVerified = false;
  ready = false;
  scheduled = false;
  active = false;
  render();
  const currentAccount = await checkWallet();
  assert(
    artifact.forkVerified,
    "The disposable fork verification has not passed. Deployment is disabled.",
  );
  const client = requireClient();
  const block = await client.getBlock();
  const blockNumber = block.number;
  assert(
    (await client.getChainId()) === sepolia.id,
    "The read RPC is not Ethereum Sepolia.",
  );
  chainTimeOffset = Number(block.timestamp) - Date.now() / 1000;
  text(
    "verify-results",
    "Checking ENS permissions, permanent contracts and governance…",
  );
  const read = <
    N extends
      | "gateway"
      | "factory"
      | "paymentToken"
      | "pointer"
      | "ensGovernanceExecutor"
      | "currentHelper"
      | "ETH_REGISTRY"
      | "BASE_REGISTRAR"
      | "rentPriceOracle",
  >(
    address: Address,
    functionName: N,
  ) => client.readContract({ address, abi, functionName, blockNumber });
  for (const address of [
    config.pointer,
    config.timelock,
    config.factory,
    config.gateway,
    config.token,
    config.registrar,
    config.v1,
  ]) {
    const code = await client.getCode({ address, blockNumber });
    assert(code && code !== "0x", `No contract at ${address}.`);
  }
  for (const [address, fn, expected] of [
    [config.pointer, "gateway", config.gateway],
    [config.pointer, "factory", config.factory],
    [config.pointer, "paymentToken", config.token],
    [config.pointer, "ensGovernanceExecutor", config.timelock],
    [config.gateway, "pointer", config.pointer],
    [config.gateway, "factory", config.factory],
    [config.gateway, "paymentToken", config.token],
    [config.v1, "BASE_REGISTRAR", config.base],
  ] as const)
    assert(
      same(await read(address, fn), expected),
      `Unexpected ${fn} on ${address}.`,
    );
  const current = await read(config.pointer, "currentHelper");
  assert(
    same(current, config.oldHelper) ||
      (journal.helper && same(current, journal.helper)),
    "The pointer changed to another helper. Review it before continuing.",
  );
  assert(
    same(
      await read(config.registrar, "ETH_REGISTRY"),
      await read(config.v1, "ETH_REGISTRY"),
    ),
    "The new ENS contracts use different registries.",
  );
  assert(
    same(
      await read(config.registrar, "rentPriceOracle"),
      await read(config.v1, "rentPriceOracle"),
    ),
    "The new ENS contracts use different pricing oracles.",
  );
  assert(
    await client.readContract({
      address: config.base,
      abi,
      functionName: "controllers",
      args: [config.v1],
      blockNumber,
    }),
    "The new V1 renewer has no BaseRegistrar permission.",
  );
  assert(
    await client.readContract({
      address: config.v1,
      abi,
      functionName: "isRenewable",
      args: ["farcaster"],
      blockNumber,
    }),
    "The new V1 renewer does not accept farcaster.",
  );
  delay = await client.readContract({
    address: config.timelock,
    abi,
    functionName: "getMinDelay",
    blockNumber,
  });
  const proposerRole = await client.readContract({
    address: config.timelock,
    abi,
    functionName: "PROPOSER_ROLE",
    blockNumber,
  });
  const executorRole = await client.readContract({
    address: config.timelock,
    abi,
    functionName: "EXECUTOR_ROLE",
    blockNumber,
  });
  proposer = await client.readContract({
    address: config.timelock,
    abi,
    functionName: "hasRole",
    args: [proposerRole, currentAccount],
    blockNumber,
  });
  executor =
    (await client.readContract({
      address: config.timelock,
      abi,
      functionName: "hasRole",
      args: [executorRole, currentAccount],
      blockNumber,
    })) ||
    (await client.readContract({
      address: config.timelock,
      abi,
      functionName: "hasRole",
      args: [executorRole, zeroAddress],
      blockNumber,
    }));
  await reconcile();
  await checkWallet();
  verified = true;
  text(
    "verify-results",
    `Contracts verified at Sepolia block ${blockNumber}.\n${proposer ? "This wallet can schedule governance." : "This wallet has no proposer role; use the governance wallet to schedule."} ${executor ? "This wallet can execute ready operations." : "This wallet has no executor role."}${active ? "\nReplacement helper is active." : ""}`,
  );
}
function operationArgs(): readonly [Address, bigint, Hex, Hex, Hex] {
  assert(
    journal.helper && journal.salt,
    "A verified helper and operation salt are required.",
  );
  return [
    config.pointer,
    0n,
    encodeFunctionData({
      abi,
      functionName: "setHelper",
      args: [journal.helper],
    }),
    zeroHash,
    journal.salt,
  ];
}
async function action(task: () => Promise<void>) {
  if (busy) return;
  busy = true;
  el("error").classList.add("hidden");
  render();
  try {
    await task();
  } catch (error) {
    verified = false;
    ready = false;
    const value = error as { shortMessage?: string; message?: string };
    text(
      "error",
      (
        value.shortMessage ??
        value.message ??
        "Wallet operation failed."
      ).replace(/https?:\/\/\S+/g, "[RPC URL omitted]"),
    );
    el("error").classList.remove("hidden");
  } finally {
    busy = false;
    render();
  }
}
function bind(id: string, task: () => Promise<void>) {
  el(id).addEventListener("click", () => void action(task));
}
bind("connect", async () => {
  const wallet = wallets[Number(el<HTMLSelectElement>("wallet").value)];
  assert(
    wallet,
    "No injected browser wallet found. Open this page in Chrome with Rainbow enabled.",
  );
  provider = wallet.provider;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  assert(accounts[0], "No wallet account selected.");
  account = getAddress(accounts[0]);
  text("wallet-address", `${wallet.info.name} · ${account}`);
  await preflight();
});
bind("switch", async () => {
  assert(provider, "Connect a wallet first.");
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0xaa36a7" }],
  });
  await preflight();
});
bind("refresh", preflight);
bind("deploy", async () => {
  await preflight();
  assert(
    !journal.helper && !journal.deploymentTx,
    "A deployment is already recorded.",
  );
  const currentAccount = await checkWallet();
  const client = requireClient();
  const data = encodeDeployData({
    abi: helperAbi,
    bytecode: artifact.bytecode as Hex,
    args: constructorArgs,
  });
  const estimate = await client.estimateGas({ account: currentAccount, data });
  await checkWallet();
  const wallet = createWalletClient({
    chain: sepolia,
    transport: custom(provider!),
  });
  const hash = await wallet.deployContract({
    account: currentAccount,
    abi: helperAbi,
    bytecode: artifact.bytecode as Hex,
    args: constructorArgs,
    gas: (estimate * 12n) / 10n,
  });
  journal.deploymentTx = hash;
  save();
  render();
  text("verify-results", "Waiting for the helper deployment receipt…");
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert(
    receipt.status === "success" && receipt.contractAddress,
    "Helper deployment failed.",
  );
  journal.helper = getAddress(receipt.contractAddress);
  save();
  await preflight();
});
bind("resume", async () => {
  await checkWallet();
  const helper = getAddress(el<HTMLInputElement>("existing").value.trim());
  assert(
    !journal.helper || same(journal.helper, helper),
    "A different helper is already recorded. Keep this operation journal intact.",
  );
  await verifyHelper(helper);
  journal.helper = helper;
  save();
  await preflight();
});
bind("schedule", async () => {
  await preflight();
  assert(
    helperVerified && proposer && !active && !scheduled,
    "The operation is not eligible for scheduling.",
  );
  if (!journal.salt) {
    journal.salt = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    save();
  }
  const currentAccount = await checkWallet();
  const client = requireClient();
  const args = operationArgs();
  journal.operationId = await client.readContract({
    address: config.timelock,
    abi,
    functionName: "hashOperation",
    args,
  });
  save();
  const { request } = await client.simulateContract({
    account: currentAccount,
    address: config.timelock,
    abi,
    functionName: "schedule",
    args: [...args, delay],
  });
  await checkWallet();
  const hash = await createWalletClient({
    chain: sepolia,
    transport: custom(provider!),
  }).writeContract(request);
  journal.scheduleTx = hash;
  save();
  render();
  text("verify-results", "Waiting for the scheduling receipt…");
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", "Scheduling failed.");
  await preflight();
});
bind("execute", async () => {
  await preflight();
  assert(
    helperVerified && executor && ready && !active,
    "The operation is not ready for activation.",
  );
  const currentAccount = await checkWallet();
  const client = requireClient();
  const { request } = await client.simulateContract({
    account: currentAccount,
    address: config.timelock,
    abi,
    functionName: "execute",
    args: operationArgs(),
  });
  await checkWallet();
  const hash = await createWalletClient({
    chain: sepolia,
    transport: custom(provider!),
  }).writeContract(request);
  journal.activationTx = hash;
  save();
  render();
  text("verify-results", "Waiting for the activation receipt…");
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", "Activation failed.");
  await preflight();
  assert(active, "The pointer did not select the replacement helper.");
});
el("export").addEventListener("click", () => {
  const record = {
    chainId: sepolia.id,
    ...config,
    compiler: artifact.compiler,
    sourceSha256: artifact.sourceSha256,
    ...journal,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "namepass-ens-helper-rotation.json";
  link.click();
  URL.revokeObjectURL(url);
});
function announce(wallet: Wallet) {
  if (
    !wallet?.provider?.request ||
    wallets.some((item) => item.info.uuid === wallet.info.uuid)
  )
    return;
  wallets.push(wallet);
  const option = document.createElement("option");
  option.value = String(wallets.length - 1);
  option.textContent = wallet.info.name;
  el<HTMLSelectElement>("wallet").append(option);
  if (
    wallet.info.rdns?.includes("rainbow") ||
    /rainbow/i.test(wallet.info.name)
  )
    el<HTMLSelectElement>("wallet").value = option.value;
}
window.addEventListener("eip6963:announceProvider", (event) =>
  announce((event as CustomEvent<Wallet>).detail),
);
window.dispatchEvent(new Event("eip6963:requestProvider"));
const injected = (
  window as Window & { ethereum?: EIP1193Provider & { isRainbow?: boolean } }
).ethereum;
if (injected)
  announce({
    info: {
      uuid: "injected",
      name: injected.isRainbow ? "Rainbow" : "Browser wallet",
    },
    provider: injected,
  });
render();
