import "@fontsource-variable/geist";
import "./style.css";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, getAddress, http, parseAbi, parseEther, type Address, type EIP1193Provider, type Hex } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia, arcTestnet } from "viem/chains";
import { ACTIVE_CHAINS, HUB_CHAIN, chainById } from "../../src/lib/chains";
import { depositAddress, normalizeLabel } from "../../src/lib/namepass";

if (!["127.0.0.1", "localhost"].includes(location.hostname)) throw Error("Localhost required");
const definitions = [sepolia, baseSepolia, arbitrumSepolia, arcTestnet];
const abi = parseAbi([
  "function predictWallet(string) view returns (address)",
  "function currentHelper() view returns (address)",
  "function ethRegistrar() view returns (address)",
  "function ethRenewerV1() view returns (address)",
  "function GAS_ALLOWANCE() view returns (uint256)",
  "function quote(string,uint256) view returns (uint64,uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);
const hub = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 15000, retryCount: 0 }) });
type Payment = { id: string; chainId: number; native?: boolean; label: string; amount: bigint; title: string; note: string };
const payments: Payment[] = [
  { id: "base", chainId: 84532, label: "farcaster", amount: 500000n, title: "Base Sepolia", note: "Cross-chain ERC-20 USDC renewal" },
  { id: "arbitrum", chainId: 421614, label: "farcaster", amount: 500000n, title: "Arbitrum Sepolia", note: "Cross-chain ERC-20 USDC renewal" },
  { id: "arc", chainId: 5042002, label: "farcaster", amount: 500000n, title: "Arc Testnet · ERC-20", note: "USDC transfer through the token interface" },
  { id: "arc-native", chainId: 5042002, native: true, label: "farcaster", amount: 500000n, title: "Arc Testnet · native", note: "Native USDC transfer; gas also uses USDC" },
];
type Entry = { id: string; chainId: number; name: string; destination: Address; amount: string; native: boolean; signedAt: string; transactionHash: Hex; receipt?: { status: string; blockNumber: string; logIndices: number[] } };
type Journal = { entries: Entry[]; firstWatch?: { name: string; destination: Address; checkedAt: string; activatedAt?: string; activationResponse?: unknown }; capture?: unknown };
const key = "namepass-api-payment-canary:october-2026";
let journal: Journal;
try { journal = JSON.parse(localStorage.getItem(key) ?? '{"entries":[]}'); if (!Array.isArray(journal.entries)) throw Error(); }
catch { journal = { entries: [] }; }
const save = () => { localStorage.setItem(key, JSON.stringify(journal)); void fetch("/payment-record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(journal) }).catch(() => {}); };
const wallets: { name: string; uuid: string; provider: EIP1193Provider }[] = [];
let provider: EIP1193Provider | undefined, account: Address | undefined, busy = false;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<header><span class="brand">Namepass</span><span class="badge">Testnet · live API checks</span></header>
<h1>Sign the test payments</h1><p>Each payment funds a real ENS renewal through normal Namepass automation. Review the network, amount and full destination before signing in Rainbow.</p>
<section class="panel"><div class="row between wallet-row"><h2>Browser wallet</h2><div class="row wallet-row"><select id="wallet" aria-label="Browser wallet"></select><button id="connect">Connect Rainbow</button></div></div><div id="account" class="status">No wallet connected.</div><div id="error" class="error hidden" role="alert"></div></section>
<div class="notice">Four route checks: <strong>2.00 testnet USDC total</strong>, plus network gas. Each click requests one payment signature. This page holds no backend key and grants no token approvals.</div>
<div class="payment-grid" id="payments"></div>
<section class="panel"><span class="number">First-time activation · separate check</span><h2>A newly watched name</h2><p>Check an eligible name that Namepass has never activated. Activate through the same core route used by the app, then fund it while the existing Goldsky capture is running.</p><label for="new-name">ENS name</label><input id="new-name" value="jbrannan.eth" autocomplete="off" spellcheck="false"><div class="row actions wallet-row"><button id="check-new" class="secondary">Check name</button><button id="activate" disabled>Activate monitoring</button><button id="fund-new" disabled>Sign 0.50 USDC · Sepolia</button></div><div id="new-destination" class="destination"></div><div id="new-state" class="payment-state" aria-live="polite"></div></section>
<section class="panel"><h2>Payment record</h2><p class="tip">A successful transfer receipt confirms funding. The API checks must separately confirm indexing, finality and renewal. Export or copy these hashes for verification.</p><button id="export" class="secondary">Export public payment record</button><div id="journal" class="journal"></div></section>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, value: string) => { el(id).textContent = value; };
function hashLink(entry: Entry) {
  const a = document.createElement("a"); a.href = `${chainById(entry.chainId)!.explorerUrl}/tx/${entry.transactionHash}`; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = entry.transactionHash; return a;
}
function render() {
  for (const p of payments) el<HTMLButtonElement>("sign-" + p.id).disabled = busy || !account || journal.entries.some(e => e.id === p.id);
  for (const id of ["connect", "check-new"]) el<HTMLButtonElement>(id).disabled = busy;
  el<HTMLInputElement>("new-name").disabled = busy || !!journal.firstWatch?.activatedAt;
  el<HTMLButtonElement>("activate").disabled = busy || !journal.firstWatch || !!journal.firstWatch.activatedAt;
  el<HTMLButtonElement>("fund-new").disabled = busy || !account || !journal.firstWatch?.activatedAt || journal.entries.some(e => e.id === "first-watch");
  el("journal").replaceChildren();
  for (const e of journal.entries) { const row = document.createElement("p"); row.append(`${chainById(e.chainId)!.network} · ${e.name} · ${(Number(e.amount) / 1e6).toFixed(2)} USDC · ${e.receipt?.status ?? "submitted"}\n`, hashLink(e)); el("journal").append(row); }
  if (journal.firstWatch) setText("new-destination", journal.firstWatch.destination);
}
async function action(task: () => Promise<void>) {
  if (busy) return; busy = true; el("error").classList.add("hidden"); render();
  try { await task(); } catch (error) { const e = error as { shortMessage?: string; message?: string }; setText("error", (e.shortMessage ?? e.message ?? "The request failed.").replace(/https?:\/\/\S+/g, "[RPC URL omitted]")); el("error").classList.remove("hidden"); }
  finally { busy = false; render(); }
}
function bind(id: string, task: () => Promise<void>) { el(id).addEventListener("click", () => void action(task)); }
async function walletCheck(chainId: number) {
  if (!provider || !account) throw Error("Connect your wallet first.");
  const accounts = await provider.request({ method: "eth_accounts" }); if (!accounts[0] || getAddress(accounts[0]) !== account) throw Error("Wallet account changed. Connect again.");
  if (Number(await provider.request({ method: "eth_chainId" })) !== chainId) throw Error("The wallet is on a different network.");
}
async function quote(label: string, amount: bigint) {
  const helper = await hub.readContract({ address: HUB_CHAIN.pointerAddress as Address, abi, functionName: "currentHelper" });
  const [registrar, v1, allowance] = await Promise.all([
    hub.readContract({ address: helper, abi, functionName: "ethRegistrar" }),
    hub.readContract({ address: helper, abi, functionName: "ethRenewerV1" }),
    hub.readContract({ address: HUB_CHAIN.gatewayAddress as Address, abi, functionName: "GAS_ALLOWANCE" }),
  ]);
  if (registrar.toLowerCase() !== HUB_CHAIN.ensRegistrarAddress!.toLowerCase() || v1.toLowerCase() !== HUB_CHAIN.ensRenewerV1Address!.toLowerCase()) throw Error("The active helper uses different ENS contracts.");
  const [seconds, applied] = await hub.readContract({ address: HUB_CHAIN.gatewayAddress as Address, abi, functionName: "quote", args: [label, amount - allowance] });
  if (!seconds || !applied || applied > amount - allowance) throw Error("This deposit cannot buy a verified renewal.");
}
async function capture() { const r = await fetch("/capture-status", { cache: "no-store" }); const state = await r.json(); if (!state.active) throw Error("The read-only stream capture is not running. Ask Codex to start it before activation or funding."); journal.capture = state; save(); }
async function send(p: Payment) {
  await capture();
  if (!provider || !account) throw Error("Connect your wallet first.");
  const definition = definitions.find(c => c.id === p.chainId)!;
  if (Number(await provider.request({ method: "eth_chainId" })) !== p.chainId) {
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${p.chainId.toString(16)}` }] }); }
    catch (error) { if ((error as { code?: number }).code !== 4902) throw error; await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: `0x${p.chainId.toString(16)}`, chainName: definition.name, nativeCurrency: definition.nativeCurrency, rpcUrls: [...definition.rpcUrls.default.http], blockExplorerUrls: [definition.blockExplorers!.default.url] }] }); await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${p.chainId.toString(16)}` }] }); }
  }
  await walletCheck(p.chainId);
  const chain = ACTIVE_CHAINS.find(c => c.chainId === p.chainId)!, destination = getAddress(depositAddress(p.label));
  const reads = createPublicClient({ chain: definition, transport: http(definition.rpcUrls.default.http[0], { timeout: 15000, retryCount: 0 }) });
  const predicted = await reads.readContract({ address: chain.factoryAddress as Address, abi, functionName: "predictWallet", args: [p.label] });
  if (predicted.toLowerCase() !== destination.toLowerCase()) throw Error("Factory address derivation disagrees with the displayed destination.");
  const view = await fetch(`/api/names/${p.label}.eth`, { cache: "no-store" }); if (!view.ok) throw Error("Activate the name before funding."); const data = await view.json();
  if (data.name?.depositAddress?.toLowerCase() !== destination.toLowerCase() || !data.name?.activatedAt) throw Error("Namepass monitoring is not registered for this destination.");
  await quote(p.label, p.amount);
  const wallet = createWalletClient({ chain: definition, transport: custom(provider) });
  const value = p.native ? parseEther((Number(p.amount) / 1e6).toFixed(6)) : 0n;
  if (p.native) { const balance = await reads.getBalance({ address: account }); if (balance <= value) throw Error("Insufficient native USDC for this payment and gas."); }
  else { const balance = await reads.readContract({ address: chain.usdcAddress as Address, abi, functionName: "balanceOf", args: [account] }); if (balance < p.amount) throw Error("Insufficient testnet USDC on this network."); }
  const tx = p.native ? { account, to: destination, value } : { account, to: chain.usdcAddress as Address, data: encodeFunctionData({ abi, functionName: "transfer", args: [destination, p.amount] }), value: 0n };
  const gas = await reads.estimateGas(tx); await walletCheck(p.chainId);
  const transactionHash = await wallet.sendTransaction({ ...tx, gas: gas * 12n / 10n });
  const entry: Entry = { id: p.id, chainId: p.chainId, name: `${p.label}.eth`, destination, amount: p.amount.toString(), native: !!p.native, signedAt: new Date().toISOString(), transactionHash };
  journal.entries.push(entry); save(); render();
  const receipt = await reads.waitForTransactionReceipt({ hash: transactionHash, timeout: 120000 });
  entry.receipt = { status: receipt.status, blockNumber: receipt.blockNumber.toString(), logIndices: receipt.logs.map(l => l.logIndex) }; save();
  setText(p.id === "first-watch" ? "new-state" : "state-" + p.id, receipt.status === "success" ? "Payment confirmed. Codex can verify indexing and the renewal." : "Payment reverted; no renewal funding was delivered.");
}
for (const p of payments) {
  const card = document.createElement("section"); card.className = "payment-card";
  card.innerHTML = `<h2>${p.title}</h2><p>${p.note}</p><span class="badge">0.50 testnet USDC · farcaster.eth</span><p class="destination">${getAddress(depositAddress(p.label))}</p><button id="sign-${p.id}" disabled>Sign 0.50 USDC</button><div id="state-${p.id}" class="payment-state" aria-live="polite"></div>`;
  el("payments").append(card); bind("sign-" + p.id, () => send(p));
}
bind("connect", async () => { const wallet = wallets[Number(el<HTMLSelectElement>("wallet").value)]; if (!wallet) throw Error("Open this page in Chrome with Rainbow enabled."); provider = wallet.provider; const accounts = await provider.request({ method: "eth_requestAccounts" }); if (!accounts[0]) throw Error("Select a wallet account."); account = getAddress(accounts[0]); setText("account", `${wallet.name} · ${account}`); });
bind("check-new", async () => {
  if (journal.firstWatch?.activatedAt) throw Error("The recorded first-watch activation is already complete.");
  const label = normalizeLabel(el<HTMLInputElement>("new-name").value); await quote(label, 500000n);
  const response = await fetch(`/api/names/${label}.eth`, { cache: "no-store" }); if (response.status !== 404) throw Error("This name is already activated, or its state could not be confirmed. Choose a different name.");
  journal.firstWatch = { name: `${label}.eth`, destination: getAddress(depositAddress(label)), checkedAt: new Date().toISOString() }; save(); setText("new-state", "Renewable and not yet activated. Start the capture, then activate monitoring.");
});
bind("activate", async () => {
  await capture(); const checked = journal.firstWatch; if (!checked || checked.activatedAt) throw Error("Check a new name first.");
  if (normalizeLabel(el<HTMLInputElement>("new-name").value) + ".eth" !== checked.name) throw Error("The name changed. Check it again.");
  const response = await fetch("/api/names/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: checked.name }) }); const body = await response.json();
  if (!response.ok) throw Error(body.error?.message ?? "Activation failed.");
  if (!body.activated || body.name?.depositAddress?.toLowerCase() !== checked.destination.toLowerCase()) throw Error("This activation does not establish a new watch for the checked address.");
  checked.activatedAt = new Date().toISOString(); checked.activationResponse = body; save(); setText("new-state", "Monitoring activated. Sign the Sepolia payment now to measure first-watch delivery.");
});
bind("fund-new", async () => { const checked = journal.firstWatch; if (!checked?.activatedAt) throw Error("Activate the checked name first."); await send({ id: "first-watch", chainId: sepolia.id, label: normalizeLabel(checked.name), amount: 500000n, title: "First watch", note: "" }); });
el("export").addEventListener("click", () => { const url = URL.createObjectURL(new Blob([JSON.stringify(journal, null, 2) + "\n"], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "namepass-live-api-payments.json"; a.click(); URL.revokeObjectURL(url); });
function announce(wallet: { info: { uuid: string; name: string }; provider: EIP1193Provider }) { if (!wallet?.provider?.request || wallets.some(w => w.uuid === wallet.info.uuid)) return; wallets.push({ ...wallet.info, provider: wallet.provider }); const option = document.createElement("option"); option.value = String(wallets.length - 1); option.textContent = wallet.info.name; el<HTMLSelectElement>("wallet").append(option); if (/rainbow/i.test(wallet.info.name)) el<HTMLSelectElement>("wallet").value = option.value; }
window.addEventListener("eip6963:announceProvider", event => announce((event as CustomEvent).detail)); window.dispatchEvent(new Event("eip6963:requestProvider"));
const injected = (window as Window & { ethereum?: EIP1193Provider & { isRainbow?: boolean } }).ethereum; if (injected) announce({ info: { uuid: "injected", name: injected.isRainbow ? "Rainbow" : "Browser wallet" }, provider: injected });
render();
