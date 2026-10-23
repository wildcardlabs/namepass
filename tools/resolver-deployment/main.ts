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
import { sepolia } from "viem/chains";
import {
  config,
  hub,
  plan,
  readName,
  readiness,
  resolveSubname,
  resolverInitCode,
  setResolverCalldata,
  steps,
  verify,
  type NameState,
  type Readiness,
  type SubnameResolution,
} from "./deployment";

// An isolated localhost tool. It loads no server environment and holds no key.
// Rainbow signs the two transactions; a public RPC performs the read-only checks.

const app = document.querySelector<HTMLDivElement>("#app")!;
if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) {
  app.textContent = "This deployment tool is only available on localhost.";
  throw new Error("Localhost required");
}

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const rpcUrl = env.VITE_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const definition: Chain = { ...sepolia, rpcUrls: { default: { http: [rpcUrl] } } };
const client: PublicClient = createPublicClient({ chain: definition, transport: http(rpcUrl, { timeout: 30_000, retryCount: 1 }) });

/*//////////////////////////////////////////////////////////////
                              JOURNAL
//////////////////////////////////////////////////////////////*/

interface Journal {
  deployTx?: Hex;
  resolver?: Address;
  setTx?: Hex;
  verified?: string[];
  resolutions: (SubnameResolution & { activation: string; at: string })[];
}
const storageKey = `namepass-resolver-deployment:${hub.chainId}:${plan().contract.runtimeCodeHash}`;
const isHash = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const isAddress = (value: unknown): value is Address => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
function loadJournal(): Journal {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<Journal>;
    return {
      deployTx: isHash(value.deployTx) ? value.deployTx : undefined,
      resolver: isAddress(value.resolver) ? getAddress(value.resolver) : undefined,
      setTx: isHash(value.setTx) ? value.setTx : undefined,
      verified: Array.isArray(value.verified) ? value.verified : undefined,
      resolutions: Array.isArray(value.resolutions) ? value.resolutions : [],
    };
  } catch {
    return { resolutions: [] };
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
let name: NameState | undefined;
let nameError: string | undefined;
const states: Partial<Record<string, Readiness>> = {};

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
const explorerTx = (hash: Hex) => `${hub.explorerUrl}/tx/${hash}`;
const explorerAddress = (address: Address) => `${hub.explorerUrl}/address/${address}`;
const when = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

function render() {
  const p = plan();
  const labelInput = document.querySelector<HTMLInputElement>("#label")?.value ?? "nick";
  app.innerHTML = `
    <header><div class="brand">Namepass</div><div class="badge">Resolver deployment · Ethereum Sepolia</div></header>
    <h1>Deploy the namepass.eth wildcard resolver</h1>
    <p class="lede">Two transactions on Sepolia. The resolver answers <code>&lt;label&gt;.namepass.eth</code> through the hosted CCIP-Read gateway, which activates the label and returns the deposit address the October 23 factory derives. Every step is checked against the chain before its button is enabled and after its receipt.</p>

    <section>
      <h2>Wallet</h2>
      <div id="wallets" class="row"></div>
      <p id="wallet-status" class="muted">${account ? `${esc(account)} on chain ${walletChainId ?? "unknown"}` : "Not connected."}</p>
      <p class="muted">The signing wallet must own <code>${esc(config.name)}</code> in the ENS V2 ETH registry: <code>${config.owner}</code>.</p>
    </section>

    <section>
      <h2>Plan</h2>
      <table>
        <tr><th>Name</th><td><code>${esc(config.name)}</code> in ETH registry <code>${config.ethRegistry}</code></td></tr>
        <tr><th>Universal resolver</th><td><code>${config.universalResolver}</code></td></tr>
        <tr><th>Factory compiled in</th><td><code>${config.factory}</code></td></tr>
        <tr><th>Apex address</th><td><code>${config.apexAddr}</code> (the mainnet namepass.eth addr record)</td></tr>
        <tr><th>Gateway URL</th><td><code>${esc(config.gatewayUrl)}</code></td></tr>
        <tr><th>url / description</th><td><code>${esc(config.url)}</code> / ${esc(config.description)}</td></tr>
        <tr><th>Creation code hash</th><td><code>${p.contract.creationCodeHash}</code></td></tr>
        <tr><th>Runtime code hash</th><td><code>${p.contract.runtimeCodeHash}</code></td></tr>
      </table>
      <h3>Registry state</h3>
      ${
        name
          ? `<table>
        <tr><th>Token ID</th><td><code>0x${name.tokenId.toString(16)}</code></td></tr>
        <tr><th>Owner</th><td><code>${name.owner}</code></td></tr>
        <tr><th>Expiry</th><td>${esc(when(name.expiry))}</td></tr>
        <tr><th>Current resolver</th><td><code>${name.resolver}</code></td></tr>
        <tr><th>Owner holds ROLE_SET_RESOLVER</th><td>${name.ownerMaySetResolver ? "yes" : "no"}</td></tr>
      </table>`
          : `<p class="muted">${esc(nameError ?? "not read yet")}</p>`
      }
      <div class="row"><button id="recheck">Recheck</button><button id="export">Export deployment record</button><button id="clear">Clear journal</button></div>
    </section>

    <section>
      <h2>Steps</h2>
      ${steps
        .map((step, i) => {
          const s = states[step.id];
          const tx = step.id === "deploy-resolver" ? journal.deployTx : journal.setTx;
          const cls = s?.state ?? "unknown";
          return `<div class="step ${cls}">
            <span class="number">${String(i + 1).padStart(2, "0")} · ${esc(hub.network)}</span>
            <h3>${esc(step.title)}</h3>
            <p class="muted">${esc(step.detail)}</p>
            <p class="state">${s ? `${esc(s.state)} — ${esc(s.reason)}` : "not checked"}</p>
            ${tx ? `<p class="tx"><a href="${explorerTx(tx)}" target="_blank" rel="noreferrer">${tx}</a></p>` : ""}
            ${step.id === "deploy-resolver" && journal.resolver ? `<p class="tx">Resolver: <a href="${explorerAddress(journal.resolver)}" target="_blank" rel="noreferrer">${journal.resolver}</a></p>` : ""}
            <details><summary>Transaction</summary><pre>${
              step.id === "deploy-resolver"
                ? `to: (contract creation)\ndata: ${esc(resolverInitCode)}`
                : `to: ${config.ethRegistry}\ndata: ${name && journal.resolver ? esc(setResolverCalldata(name.tokenId, journal.resolver)) : "(needs the deployed resolver and the token ID)"}`
            }</pre></details>
            <div class="row">
              <button data-send="${step.id}" ${s?.state === "ready" && !busy ? "" : "disabled"}>Sign with wallet</button>
              <button data-switch="${hub.chainId}">Switch wallet to ${esc(hub.network)}</button>
            </div>
          </div>`;
        })
        .join("")}
    </section>

    <section>
      <h2>Verification</h2>
      <div class="row"><button id="verify" ${journal.resolver ? "" : "disabled"}>Verify the resolver and the registry</button><span class="muted">${journal.verified?.length ? `${journal.verified.length} checks passed` : ""}</span></div>
      <h3>Resolve a subname</h3>
      <p class="muted">Resolves <code>&lt;label&gt;.namepass.eth</code> through the universal resolver. The gateway activates the label in the hosted application the first time it is resolved; the address must equal the factory's prediction.</p>
      <div class="row"><input id="label" value="${esc(labelInput)}" placeholder="label without .eth" /><button id="resolve" ${journal.resolver ? "" : "disabled"}>Resolve and check activation</button></div>
      ${
        journal.resolutions.length
          ? `<table><tr><th>Subname</th><th>Resolved</th><th>Factory</th><th>Activation</th><th>At</th></tr>${journal.resolutions
              .map(
                (r) =>
                  `<tr><td><code>${esc(r.subname)}</code></td><td><code>${r.resolved ?? "null"}</code></td><td><code>${r.onChain}</code>${r.resolved && r.resolved === r.onChain && r.expected === r.onChain ? " ✓" : " ✗"}</td><td>${esc(r.activation)}</td><td>${esc(r.at)}</td></tr>`,
              )
              .join("")}</table>`
          : ""
      }
      <pre id="log"></pre>
    </section>`;
  renderWallets();
  app.querySelectorAll<HTMLButtonElement>("[data-send]").forEach((b) => (b.onclick = () => guard(() => send(b.dataset.send as "deploy-resolver" | "set-resolver"))));
  app.querySelectorAll<HTMLButtonElement>("[data-switch]").forEach((b) => (b.onclick = () => guard(switchChain)));
  el("recheck").onclick = () => guard(recheck);
  el("export").onclick = () => guard(exportRecord);
  el("clear").onclick = () => guard(clearJournal);
  el("verify").onclick = () => guard(runVerify);
  el("resolve").onclick = () => guard(() => runResolve(el<HTMLInputElement>("label").value.trim()));
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
const logLines: string[] = [];
function log(message: string) {
  logLines.unshift(`${new Date().toISOString()} ${message}`);
  const node = document.querySelector<HTMLPreElement>("#log");
  if (node) node.textContent = logLines.join("\n");
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
    const node = document.querySelector<HTMLPreElement>("#log");
    if (node) node.textContent = logLines.join("\n");
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

async function switchChain() {
  assert(provider, "Connect a wallet first.");
  const hex = `0x${hub.chainId.toString(16)}`;
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  walletChainId = Number(await provider.request({ method: "eth_chainId" }));
}

/** The resolver address comes from the deployment receipt, so a reload re-derives it from the journal's hash. */
async function resolverFromJournal(): Promise<Address | undefined> {
  if (journal.resolver) return journal.resolver;
  if (!journal.deployTx) return undefined;
  const receipt = await client.getTransactionReceipt({ hash: journal.deployTx }).catch(() => undefined);
  if (receipt?.status === "success" && receipt.contractAddress) {
    journal.resolver = getAddress(receipt.contractAddress);
    save();
  }
  return journal.resolver;
}

async function recheck() {
  try {
    name = await readName(client);
    nameError = undefined;
  } catch (error) {
    name = undefined;
    nameError = `Registry read failed: ${error instanceof Error ? error.message : String(error)}`;
    render();
    return;
  }
  const resolver = await resolverFromJournal();
  for (const step of steps) states[step.id] = await readiness(client, step, resolver, name);
  render();
}

async function send(id: "deploy-resolver" | "set-resolver") {
  const step = steps.find((s) => s.id === id)!;
  assert(provider && account, "Connect a wallet first.");
  assert(account.toLowerCase() === config.owner.toLowerCase(), `Sign with the owner wallet ${config.owner}.`);
  name = await readName(client);
  const resolver = await resolverFromJournal();
  const state = await readiness(client, step, resolver, name);
  states[step.id] = state;
  assert(state.state === "ready", `Step is ${state.state}: ${state.reason}`);
  if (walletChainId !== hub.chainId) await switchChain();
  assert(Number(await provider.request({ method: "eth_chainId" })) === hub.chainId, `Switch the wallet to ${hub.network}.`);

  const wallet = createWalletClient({ chain: definition, transport: custom(provider) });
  if (id === "deploy-resolver") {
    const estimate = await client.estimateGas({ account, data: resolverInitCode });
    const hash = await wallet.sendTransaction({ account, data: resolverInitCode, gas: (estimate * 12n) / 10n });
    journal.deployTx = hash;
    save();
    render();
    log(`${step.title}: sent ${hash}`);
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert(receipt.status === "success" && receipt.contractAddress, `${step.title}: transaction reverted.`);
    journal.resolver = getAddress(receipt.contractAddress);
    save();
    log(`${step.title}: resolver at ${journal.resolver}, block ${receipt.blockNumber}`);
  } else {
    assert(resolver, "Deploy the resolver first.");
    const data = setResolverCalldata(name.tokenId, resolver);
    const estimate = await client.estimateGas({ account, to: config.ethRegistry, data });
    const hash = await wallet.sendTransaction({ account, to: config.ethRegistry, data, gas: (estimate * 12n) / 10n });
    journal.setTx = hash;
    save();
    render();
    log(`${step.title}: sent ${hash}`);
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert(receipt.status === "success", `${step.title}: transaction reverted.`);
    log(`${step.title}: confirmed in block ${receipt.blockNumber}`);
  }
  name = await readName(client);
  const after = await readiness(client, step, journal.resolver, name);
  states[step.id] = after;
  assert(after.state === "done", `${step.title}: receipt succeeded but the chain does not show the expected state: ${after.reason}`);
  await recheck();
}

async function runVerify() {
  assert(journal.resolver, "Deploy the resolver first.");
  const notes = await verify(client, journal.resolver);
  journal.verified = notes;
  save();
  log(`${notes.length} checks passed\n  ${notes.join("\n  ")}`);
}

async function runResolve(label: string) {
  assert(journal.resolver, "Deploy the resolver first.");
  assert(/^[a-z0-9-]+$/.test(label), "Enter one lowercase label without a dot or .eth.");
  log(`Resolving ${label}.${config.name} through the universal resolver and the gateway …`);
  const result = await resolveSubname(client, label);
  let activation: string;
  try {
    const response = await fetch(`/api/names/${encodeURIComponent(label)}`);
    const body = (await response.json()) as { depositAddress?: string; message?: string; error?: { message?: string } };
    activation =
      response.status === 200 && body.depositAddress
        ? `activated, deposit address ${body.depositAddress}${result.onChain.toLowerCase() === body.depositAddress.toLowerCase() ? " ✓" : " ✗ differs"}`
        : `${response.status}: ${body.message ?? body.error?.message ?? "no record"}`;
  } catch (error) {
    activation = `activation check failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  journal.resolutions.unshift({ ...result, activation, at: new Date().toISOString() });
  save();
  log(
    `${result.subname} → ${result.resolved ?? "null"}; factory predictWallet ${result.onChain}; local derivation ${result.expected}; ${activation}`,
  );
  assert(result.resolved && result.resolved === result.onChain && result.expected === result.onChain, "Resolved address does not match the factory.");
}

async function clearJournal() {
  if (!confirm("Clear the local journal? The chain state is re-read on the next recheck, but the deployment transaction hash and resolver address are forgotten.")) return;
  localStorage.removeItem(storageKey);
  journal.deployTx = undefined;
  journal.resolver = undefined;
  journal.setTx = undefined;
  journal.verified = undefined;
  journal.resolutions = [];
  await recheck();
}

async function exportRecord() {
  const record = {
    schema: 1,
    exportedAt: new Date().toISOString(),
    plan: plan(),
    registry: name
      ? { tokenId: `0x${name.tokenId.toString(16)}`, owner: name.owner, expiry: when(name.expiry), resolver: name.resolver, ownerMaySetResolver: name.ownerMaySetResolver }
      : null,
    resolver: journal.resolver ?? null,
    transactions: { deploy: journal.deployTx ?? null, setResolver: journal.setTx ?? null },
    steps: steps.map((s) => ({ id: s.id, title: s.title, state: states[s.id] ?? null })),
    verified: journal.verified ?? [],
    resolutions: journal.resolutions,
    note: "Transaction records are not proof of completion. Recheck the registry and resolve a subname before relying on this.",
  };
  const blob = new Blob([JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `namepass-resolver-deployment-sepolia-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

render();
void guard(recheck);
