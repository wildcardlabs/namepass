import "@fontsource-variable/geist";
import "./style.css";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia, baseSepolia, arbitrumSepolia, arcTestnet } from "viem/chains";
import {
  adapterAddress,
  chains,
  config,
  factoryAddress,
  hub,
  plan,
  readiness,
  scheduleCalldata,
  steps,
  timelockAbi,
  verifyChain,
  type Readiness,
} from "./deployment";

// An isolated localhost tool. It loads no server environment and holds no key.
// Rainbow signs every transaction; public RPCs perform the read-only checks.

const app = document.querySelector<HTMLDivElement>("#app")!;
if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) {
  app.textContent = "This deployment tool is only available on localhost.";
  throw new Error("Localhost required");
}

/** Optional RPC overrides from the shell that starts Vite, for example a keyed Arc endpoint. The key never enters the repository. */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const withRpc = (chain: Chain, url: string | undefined): Chain =>
  url ? { ...chain, rpcUrls: { default: { http: [url] } } } : chain;
const definitions: Record<number, Chain> = {
  [sepolia.id]: withRpc(sepolia, env.VITE_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
  [baseSepolia.id]: withRpc(baseSepolia, env.VITE_BASE_SEPOLIA_RPC_URL),
  [arbitrumSepolia.id]: withRpc(arbitrumSepolia, env.VITE_ARBITRUM_SEPOLIA_RPC_URL),
  [arcTestnet.id]: withRpc(arcTestnet, env.VITE_ARC_TESTNET_RPC_URL),
};
const readers: Record<number, PublicClient> = {};
for (const chain of chains) {
  const definition = definitions[chain.chainId];
  readers[chain.chainId] = createPublicClient({
    chain: definition,
    transport: http(definition.rpcUrls.default.http[0], { timeout: 20_000, retryCount: 1 }),
  });
}

/*//////////////////////////////////////////////////////////////
                              JOURNAL
//////////////////////////////////////////////////////////////*/

type Journal = { txs: Partial<Record<string, Hex>>; verified: Partial<Record<number, string[]>> };
const storageKey = `namepass-protocol-deployment:${config.saltLabel}`;
const isHash = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
function loadJournal(): Journal {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<Journal>;
    const txs: Journal["txs"] = {};
    for (const [id, hash] of Object.entries(value.txs ?? {})) if (isHash(hash)) txs[id] = hash;
    return { txs, verified: value.verified ?? {} };
  } catch {
    return { txs: {}, verified: {} };
  }
}
const journal = loadJournal();
const save = () => localStorage.setItem(storageKey, JSON.stringify(journal));

/*//////////////////////////////////////////////////////////////
                               STATE
//////////////////////////////////////////////////////////////*/

type ProviderInfo = { uuid: string; name: string; rdns?: string };
type Wallet = { info: ProviderInfo; provider: EIP1193Provider };
const wallets: Wallet[] = [];
let provider: EIP1193Provider | undefined;
let account: Address | undefined;
let walletChainId: number | undefined;
let busy = false;
const stepList = steps();
const states: Partial<Record<string, Readiness>> = {};
const presence: Partial<Record<number, string>> = {};

window.addEventListener("eip6963:announceProvider", (event) => {
  const detail = (event as CustomEvent<Wallet>).detail;
  if (!wallets.some((w) => w.info.uuid === detail.info.uuid)) {
    wallets.push(detail);
    renderWallets();
  }
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

/*//////////////////////////////////////////////////////////////
                               RENDER
//////////////////////////////////////////////////////////////*/

const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const explorer = (chainId: number, hash: Hex) => `${chains.find((c) => c.chainId === chainId)!.explorerUrl}/tx/${hash}`;
const chainName = (chainId: number) => chains.find((c) => c.chainId === chainId)!.network;

function render() {
  const p = plan();
  app.innerHTML = `
    <header><div class="brand">Namepass</div><div class="badge">Protocol deployment · two-contract design</div></header>
    <h1>Deploy the factory and adapter</h1>
    <p class="lede">Eleven transactions across four testnets. Every address below is computed before anything is sent, and every step is checked against the chain before its button is enabled and after its receipt.</p>

    <section>
      <h2>Wallet</h2>
      <div id="wallets" class="row"></div>
      <p id="wallet-status" class="muted">${account ? `${esc(account)} on ${walletChainId ? esc(chainName(walletChainId) ?? String(walletChainId)) : "unknown chain"}` : "Not connected."}</p>
      <p class="muted">The deploying wallet must be the factory owner and timelock operator, <code>${config.owner}</code>.</p>
    </section>

    <section>
      <h2>Plan</h2>
      <table>
        <tr><th>Salt label</th><td><code>${esc(p.saltLabel)}</code></td></tr>
        <tr><th>Singleton factory</th><td><code>${p.singletonFactory}</code></td></tr>
        <tr><th>Factory address, all chains</th><td><code>${factoryAddress}</code></td></tr>
        <tr><th>Adapter address, Sepolia</th><td><code>${adapterAddress}</code></td></tr>
        <tr><th>Factory creation code hash</th><td><code>${p.contracts.NamepassFactory.creationCodeHash}</code></td></tr>
        <tr><th>Adapter creation code hash</th><td><code>${p.contracts.ENSV2RenewalAdapter.creationCodeHash}</code></td></tr>
        <tr><th>Governance executor</th><td><code>${config.timelock}</code> (existing Sepolia test timelock)</td></tr>
      </table>
      <table>
        <tr><th>Chain</th><th>Factory address state</th></tr>
        ${chains.map((c) => `<tr><td>${esc(c.network)}</td><td>${esc(presence[c.chainId] ?? "not checked")}</td></tr>`).join("")}
      </table>
      <div class="row"><button id="recheck">Recheck every chain</button><button id="export">Export deployment record</button></div>
    </section>

    <section>
      <h2>Steps</h2>
      ${stepList
        .map((step, i) => {
          const s = states[step.id];
          const tx = journal.txs[step.id];
          const cls = s?.state ?? "unknown";
          return `<div class="step ${cls}">
            <span class="number">${String(i + 1).padStart(2, "0")} · ${esc(chainName(step.chainId))}</span>
            <h3>${esc(step.title)}</h3>
            <p class="muted">${esc(step.detail)}</p>
            <p class="state">${s ? `${esc(s.state)} — ${esc(s.reason)}` : "not checked"}</p>
            ${tx ? `<p class="tx"><a href="${explorer(step.chainId, tx)}" target="_blank" rel="noreferrer">${tx}</a></p>` : ""}
            <details><summary>Transaction</summary><pre>to: ${step.tx.to}\ndata: ${step.id.startsWith("schedule") ? "(encoded at send time with the live timelock delay)" : esc(step.tx.data)}</pre></details>
            <div class="row">
              <button data-send="${step.id}" ${s?.state === "ready" && !busy ? "" : "disabled"}>Sign with wallet</button>
              <button data-switch="${step.chainId}">Switch wallet to ${esc(chainName(step.chainId))}</button>
            </div>
          </div>`;
        })
        .join("")}
    </section>

    <section>
      <h2>Verification</h2>
      ${chains
        .map(
          (c) => `<div class="row"><button data-verify="${c.chainId}">Verify ${esc(c.network)}</button><span class="muted">${(journal.verified[c.chainId] ?? []).length ? `${journal.verified[c.chainId]!.length} checks passed` : ""}</span></div>`,
        )
        .join("")}
      <pre id="log"></pre>
    </section>`;
  renderWallets();
  app.querySelectorAll<HTMLButtonElement>("[data-send]").forEach((b) => (b.onclick = () => guard(() => send(b.dataset.send!))));
  app.querySelectorAll<HTMLButtonElement>("[data-switch]").forEach((b) => (b.onclick = () => guard(() => switchChain(Number(b.dataset.switch)))));
  app.querySelectorAll<HTMLButtonElement>("[data-verify]").forEach((b) => (b.onclick = () => guard(() => verify(Number(b.dataset.verify)))));
  el("recheck").onclick = () => guard(recheck);
  el("export").onclick = () => guard(exportRecord);
}

function renderWallets() {
  const host = document.querySelector<HTMLDivElement>("#wallets");
  if (!host) return;
  host.innerHTML = wallets.length
    ? wallets.map((w) => `<button data-wallet="${esc(w.info.uuid)}">Connect ${esc(w.info.name)}</button>`).join("")
    : `<span class="muted">No browser wallet announced itself. Open Rainbow and reload.</span>`;
  host.querySelectorAll<HTMLButtonElement>("[data-wallet]").forEach((b) => (b.onclick = () => guard(() => connect(b.dataset.wallet!))));
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function log(message: string) {
  const node = el<HTMLPreElement>("log");
  node.textContent = `${new Date().toISOString()} ${message}\n${node.textContent ?? ""}`;
}
async function guard(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  try {
    await action();
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    busy = false;
    render();
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/*//////////////////////////////////////////////////////////////
                              ACTIONS
//////////////////////////////////////////////////////////////*/

async function connect(uuid: string) {
  const wallet = wallets.find((w) => w.info.uuid === uuid);
  assert(wallet, "Wallet not found.");
  provider = wallet.provider;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  assert(accounts[0], "No wallet account selected.");
  account = getAddress(accounts[0]);
  walletChainId = Number(await provider.request({ method: "eth_chainId" }));
  provider.on("chainChanged", (id) => {
    walletChainId = Number(id);
    render();
  });
  provider.on("accountsChanged", (list) => {
    account = list[0] ? getAddress(list[0]) : undefined;
    render();
  });
  await recheck();
}

async function switchChain(chainId: number) {
  assert(provider, "Connect a wallet first.");
  const definition = definitions[chainId];
  const hex = `0x${chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hex,
          chainName: definition.name,
          nativeCurrency: definition.nativeCurrency,
          rpcUrls: [...definition.rpcUrls.default.http],
          blockExplorerUrls: [definition.blockExplorers!.default.url],
        },
      ],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  }
  walletChainId = Number(await provider.request({ method: "eth_chainId" }));
}

async function recheck() {
  for (const chain of chains) {
    const client = readers[chain.chainId];
    try {
      const code = await client.getCode({ address: factoryAddress });
      presence[chain.chainId] = !code || code === "0x" ? "free" : "code present";
      for (const step of stepList.filter((s) => s.chainId === chain.chainId)) states[step.id] = await readiness(client, step);
    } catch (error) {
      presence[chain.chainId] = `unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  render();
}

async function send(id: string) {
  const step = stepList.find((s) => s.id === id);
  assert(step && provider && account, "Connect a wallet first.");
  assert(account.toLowerCase() === config.owner.toLowerCase(), `Sign with the owner wallet ${config.owner}.`);
  const client = readers[step.chainId];
  const state = await readiness(client, step);
  states[step.id] = state;
  assert(state.state === "ready", `Step is ${state.state}: ${state.reason}`);
  if (walletChainId !== step.chainId) await switchChain(step.chainId);
  assert(Number(await provider.request({ method: "eth_chainId" })) === step.chainId, `Switch the wallet to ${chainName(step.chainId)}.`);

  let data = step.tx.data;
  if (step.id.startsWith("schedule")) {
    const delay = await client.readContract({ address: config.timelock, abi: timelockAbi, functionName: "getMinDelay" });
    data = scheduleCalldata(delay);
  }
  const estimate = await client.estimateGas({ account, to: step.tx.to, data, value: step.tx.value ?? 0n });
  const definition = definitions[step.chainId];
  const wallet = createWalletClient({ chain: definition, transport: custom(provider) });
  const fees = step.chainId === arcTestnet.id ? { type: "legacy" as const, gasPrice: await client.getGasPrice() } : {};
  const hash = await wallet.sendTransaction({ account, to: step.tx.to, data, value: step.tx.value ?? 0n, gas: (estimate * 12n) / 10n, ...fees });
  journal.txs[step.id] = hash;
  save();
  render();
  log(`${step.title}: sent ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", `${step.title}: transaction reverted.`);
  const after = await readiness(client, step);
  states[step.id] = after;
  assert(after.state === "done", `${step.title}: receipt succeeded but the chain does not show the expected state: ${after.reason}`);
  log(`${step.title}: confirmed in block ${receipt.blockNumber}`);
  await recheck();
}

async function verify(chainId: number) {
  const notes = await verifyChain(readers[chainId], chainId);
  journal.verified[chainId] = notes;
  save();
  log(`${chainName(chainId)}: ${notes.length} checks passed\n  ${notes.join("\n  ")}`);
}

async function exportRecord() {
  const record = {
    schema: 2,
    exportedAt: new Date().toISOString(),
    plan: plan(),
    chains: Object.fromEntries(
      chains.map((c) => [
        c.chainId,
        {
          network: c.network,
          usdc: c.usdcAddress,
          tokenMessenger: c.tokenMessengerAddress,
          messageTransmitter: c.chainId === hub.chainId ? c.messageTransmitterAddress : null,
          factoryPresence: presence[c.chainId] ?? null,
          verified: journal.verified[c.chainId] ?? [],
        },
      ]),
    ),
    steps: stepList.map((s) => ({ id: s.id, chainId: s.chainId, title: s.title, tx: journal.txs[s.id] ?? null, state: states[s.id] ?? null })),
    note: "Transaction records are not proof of completion. Recheck all on-chain state before cutover.",
  };
  const blob = new Blob([JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `namepass-protocol-deployment-${config.saltLabel}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

render();
void guard(recheck);
