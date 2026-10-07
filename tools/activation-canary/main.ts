import "@fontsource-variable/geist";
import "../payment-canary/style.css";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, getAddress, http, parseAbi, type Address, type EIP1193Provider, type Hex } from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { chainById, HUB_CHAIN } from "../../src/lib/chains";
import { depositAddress } from "../../src/lib/namepass";
import { canaryAmount, checkedTransfer, tokenAbi, transactionHash } from "./receipt";

if (!["127.0.0.1", "localhost"].includes(location.hostname)) throw Error("Localhost required");
const name = "brantly.eth", label = "brantly", destination = getAddress(depositAddress(label));
const chain = chainById(baseSepolia.id)!, token = getAddress(chain.usdcAddress);
const reads = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org", { timeout: 15000, retryCount: 0 }) });
const hub = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 15000, retryCount: 0 }) });
const abi = parseAbi(["function predictWallet(string) view returns (address)", "function currentHelper() view returns (address)", "function ethRegistrar() view returns (address)", "function ethRenewerV1() view returns (address)", "function GAS_ALLOWANCE() view returns (uint256)", "function quote(string,uint256) view returns (uint64,uint256)"]);
type Journal = { name: string; chainId: number; destination: Address; sender?: Address; activationRequestedAt?: string; activationReturnedAt?: string; activationResponse?: unknown; fundingRequestedAt?: string; transactionHash?: Hex; hashReturnedAt?: string; receipt?: { blockNumber: string; blockTime: string; logIndex: number }; capture?: unknown };
const key = "namepass-activation-boundary:brantly:2026-10-07";
let journal: Journal;
try { journal = JSON.parse(localStorage.getItem(key) ?? "null"); if (journal?.name !== name || journal?.destination !== destination) throw Error(); }
catch { journal = { name, chainId: baseSepolia.id, destination }; }
const wallets: { name: string; uuid: string; provider: EIP1193Provider }[] = [];
let provider: EIP1193Provider | undefined, account: Address | undefined, busy = false;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `<header><span class="brand">Namepass</span><span class="badge">Testnet · activation timing</span></header><h1>Check a newly watched name</h1><p>Register monitoring for <strong>${name}</strong>, then immediately request one Base Sepolia payment in your wallet. We will compare the watch commit, source transfer, index delivery and renewal.</p>
<section class="panel"><h2>Browser wallet</h2><div class="row actions wallet-row"><select id="wallet" aria-label="Browser wallet"></select><button id="connect" class="secondary">Connect Rainbow</button></div><p id="account" class="status">No wallet connected.</p><div id="error" class="error hidden" role="alert"></div></section>
<section class="panel"><span class="number">One payment · no token approval</span><h2>${name}</h2><p><strong>0.50 testnet USDC · Base Sepolia</strong>, plus network gas. The button activates the name through the normal application route before requesting your transfer signature.</p><p class="destination">${destination}</p><p class="tip">The read-only Goldsky capture must be active. This is a test of watch propagation; confirmation alone does not prove indexing or renewal. Do not reload while your wallet prompt is open.</p><div class="row actions wallet-row"><button id="check" class="secondary">Check readiness</button><button id="fund" disabled>Activate & sign 0.50 USDC</button></div><div id="state" class="payment-state" aria-live="polite"></div></section>
<section class="panel"><h2>Submitted payment</h2><p class="tip">A recorded or uncertain wallet request blocks another transfer. Use its hash to check the original payment.</p><label for="hash">Transaction hash</label><input id="hash" autocomplete="off" spellcheck="false" placeholder="0x…"><button id="resume" class="secondary" disabled>Check original payment</button><pre id="record" class="journal"></pre></section>`;
function render() {
  el<HTMLButtonElement>("fund").disabled = busy || !account || !!journal.fundingRequestedAt || !!journal.transactionHash;
  el("fund").textContent = journal.activationRequestedAt ? "Sign recorded 0.50-USDC payment" : "Activate & sign 0.50 USDC";
  el<HTMLButtonElement>("connect").disabled = busy;
  el<HTMLButtonElement>("check").disabled = busy;
  el<HTMLButtonElement>("resume").disabled = busy || !journal.fundingRequestedAt;
  el("record").textContent = JSON.stringify(journal, null, 2);
}
async function save() {
  localStorage.setItem(key, JSON.stringify(journal)); render();
  const response = await fetch("/canary-record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(journal) });
  if (!response.ok) throw Error("The local payment journal could not be saved.");
}
function bind(id: string, action: () => Promise<void>) { el(id).addEventListener("click", async () => {
  if (busy) return; busy = true; render(); el("error").classList.add("hidden");
  try { await action(); } catch (error) { el("error").textContent = error instanceof Error ? error.message : String(error); el("error").classList.remove("hidden"); }
  finally { busy = false; render(); }
}); }
async function capture() {
  const r = await fetch("/capture-status", { cache: "no-store" }), state = await r.json();
  if (!state.active || state.targetAddress?.toLowerCase() !== destination.toLowerCase()) throw Error("Codex must start the read-only capture for this address first.");
  journal.capture = state;
}
async function walletCheck() {
  if (!provider || !account) throw Error("Connect your wallet first.");
  const accounts = await provider.request({ method: "eth_accounts" });
  if (getAddress(accounts[0]) !== account || Number(await provider.request({ method: "eth_chainId" })) !== baseSepolia.id) throw Error("Wallet account or network changed.");
}
async function readiness() {
  if (await reads.getChainId() !== baseSepolia.id || await hub.getChainId() !== sepolia.id) throw Error("RPC network mismatch.");
  const prediction = await reads.readContract({ address: getAddress(chain.factoryAddress!), abi, functionName: "predictWallet", args: [label] });
  if (getAddress(prediction) !== destination) throw Error("Factory address prediction mismatch.");
  const helper = await hub.readContract({ address: getAddress(HUB_CHAIN.pointerAddress!), abi, functionName: "currentHelper" });
  const [registrar, v1, allowance] = await Promise.all([
    hub.readContract({ address: helper, abi, functionName: "ethRegistrar" }), hub.readContract({ address: helper, abi, functionName: "ethRenewerV1" }),
    hub.readContract({ address: getAddress(HUB_CHAIN.gatewayAddress!), abi, functionName: "GAS_ALLOWANCE" }),
  ]);
  if (registrar.toLowerCase() !== HUB_CHAIN.ensRegistrarAddress!.toLowerCase() || v1.toLowerCase() !== HUB_CHAIN.ensRenewerV1Address!.toLowerCase() || allowance !== 100000n) throw Error("Current ENS deployment or allowance mismatch.");
  const [duration] = await hub.readContract({ address: getAddress(HUB_CHAIN.gatewayAddress!), abi, functionName: "quote", args: [label, canaryAmount - allowance] });
  if (duration <= 0n) throw Error("The name is not renewable.");
  const response = await fetch(`/api/names/${name}`, { cache: "no-store" });
  if (!journal.activationRequestedAt) { if (response.status !== 404) throw Error("This name is already watched, or its state is unavailable."); }
  else if (response.ok) { const body = await response.json(); if (body.name?.depositAddress?.toLowerCase() !== destination.toLowerCase()) throw Error("Stored name identity differs."); }
  else if (response.status !== 404) throw Error("Activation state is unavailable.");
}
async function verify(hash: Hex) {
  if (!journal.sender) throw Error("Original funding account is missing.");
  const receipt = await reads.waitForTransactionReceipt({ hash, timeout: 120000 }), tx = await reads.getTransaction({ hash });
  const logIndex = checkedTransfer(tx, receipt, journal.sender, token, destination), block = await reads.getBlock({ blockNumber: receipt.blockNumber });
  journal.transactionHash = hash; journal.receipt = { blockNumber: receipt.blockNumber.toString(), blockTime: new Date(Number(block.timestamp) * 1000).toISOString(), logIndex }; await save();
  el("state").textContent = "Payment confirmed. Codex can now verify watch timing, index delivery and renewal. Do not send it again.";
}
bind("connect", async () => { const selected = wallets[Number(el<HTMLSelectElement>("wallet").value)]; if (!selected) throw Error("Open in Chrome with Rainbow enabled."); provider = selected.provider; const accounts = await provider.request({ method: "eth_requestAccounts" }); account = getAddress(accounts[0]); el("account").textContent = `${selected.name} · ${account}`; });
bind("check", async () => { await readiness(); el("state").textContent = journal.activationRequestedAt
  ? "An activation attempt is already recorded. A funding retry is not a new-watch timing sample. Check the original request first."
  : "Renewable, not yet watched, and factory address verified. Codex must start capture before funding."; });
bind("fund", async () => {
  if (!provider || !account || journal.fundingRequestedAt || journal.transactionHash) throw Error("Connect the wallet, or check the original recorded request.");
  if (journal.sender && journal.sender !== account) throw Error("Use the original funding account.");
  if (Number(await provider.request({ method: "eth_chainId" })) !== baseSepolia.id) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
  await walletCheck(); await readiness(); await capture();
  if (await reads.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account] }) < canaryAmount) throw Error("Insufficient Base Sepolia testnet USDC.");
  const tx = { account, to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [destination, canaryAmount] }), value: 0n };
  const [estimate, fees, balance] = await Promise.all([reads.estimateGas(tx), reads.estimateFeesPerGas(), reads.getBalance({ address: account })]);
  const gas = estimate * 12n / 10n;
  if (!fees.maxFeePerGas || balance < gas * fees.maxFeePerGas) throw Error("Insufficient Base Sepolia ETH for gas.");
  journal.sender = account; journal.activationRequestedAt ??= new Date().toISOString(); await save();
  el("state").textContent = "Registering monitoring through the normal activation route…";
  const response = await fetch("/api/names/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }), body = await response.json();
  if (!response.ok || body.name?.depositAddress?.toLowerCase() !== destination.toLowerCase()) throw Error("Activation did not confirm the expected address. No wallet transfer was requested.");
  journal.activationReturnedAt = new Date().toISOString(); journal.activationResponse = body; await save();
  await capture(); await walletCheck(); journal.fundingRequestedAt = new Date().toISOString(); await save();
  el("state").textContent = "Monitoring registered. Review the 0.50 testnet-USDC Base Sepolia transfer in your wallet now.";
  try {
    const wallet = createWalletClient({ chain: baseSepolia, transport: custom(provider) });
    journal.transactionHash = await wallet.sendTransaction({ ...tx, ...fees, gas }); journal.hashReturnedAt = new Date().toISOString(); await save();
  } catch (error) {
    if ((error as { code?: number }).code === 4001 || (error as { cause?: { code?: number } }).cause?.code === 4001) { delete journal.fundingRequestedAt; await save(); }
    throw error;
  }
  await verify(journal.transactionHash!);
});
bind("resume", async () => { const hash = journal.transactionHash ?? transactionHash(el<HTMLInputElement>("hash").value.trim()); await verify(hash); });
function announce(wallet: { info: { uuid: string; name: string }; provider: EIP1193Provider }) { if (!wallet?.provider?.request || wallets.some(w => w.uuid === wallet.info.uuid)) return; wallets.push({ ...wallet.info, provider: wallet.provider }); const option = document.createElement("option"); option.value = String(wallets.length - 1); option.textContent = wallet.info.name; el<HTMLSelectElement>("wallet").append(option); if (/rainbow/i.test(wallet.info.name)) el<HTMLSelectElement>("wallet").value = option.value; }
window.addEventListener("eip6963:announceProvider", event => announce((event as CustomEvent).detail)); window.dispatchEvent(new Event("eip6963:requestProvider"));
render();
