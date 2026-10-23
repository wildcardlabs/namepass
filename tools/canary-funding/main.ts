import "@fontsource-variable/geist";
import "../payment-canary/style.css";
import {
  createPublicClient, createWalletClient, custom, decodeEventLog, encodeFunctionData, getAddress, http, parseAbi,
  type Address, type Chain, type EIP1193Provider, type Hex, type PublicClient,
} from "viem";
import { sepolia, baseSepolia, arbitrumSepolia, arcTestnet } from "viem/chains";
import { ACTIVE_CHAINS, HUB_CHAIN } from "../../src/lib/chains";
import { depositAddress } from "../../src/lib/namepass";

// Phase 6 canary funding for the two-contract deployment. An isolated localhost page: it loads no
// server environment and holds no key. Public RPCs do the read-only checks; Rainbow signs the
// transfers; the journal lives in local storage and a private local file.
if (!["127.0.0.1", "localhost"].includes(location.hostname)) throw Error("Localhost required");

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const withRpc = (chain: Chain, url: string | undefined): Chain => (url ? { ...chain, rpcUrls: { default: { http: [url] } } } : chain);
const definitions: Record<number, Chain> = {
  [sepolia.id]: withRpc(sepolia, env.VITE_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
  [baseSepolia.id]: withRpc(baseSepolia, env.VITE_BASE_SEPOLIA_RPC_URL),
  [arbitrumSepolia.id]: withRpc(arbitrumSepolia, env.VITE_ARBITRUM_SEPOLIA_RPC_URL),
  [arcTestnet.id]: withRpc(arcTestnet, env.VITE_ARC_TESTNET_RPC_URL),
};
const readers: Record<number, PublicClient> = {};
for (const chain of ACTIVE_CHAINS) {
  const definition = definitions[chain.chainId];
  readers[chain.chainId] = createPublicClient({ chain: definition, transport: http(definition.rpcUrls.default.http[0], { timeout: 20_000, retryCount: 1 }) });
}
const hub = readers[HUB_CHAIN.chainId];

const abi = parseAbi([
  "function predictWallet(string) view returns (address)",
  "function currentHelper() view returns (address)",
  "function ethRegistrar() view returns (address)",
  "function ethRenewerV1() view returns (address)",
  "function GAS_ALLOWANCE() view returns (uint256)",
  "function quote(string,uint256) view returns (uint64,uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

/** Six-decimal USDC base units. Native Arc value is this times 10^12. */
const AMOUNT = 1_000_000n;
const NATIVE_SCALE = 1_000_000_000_000n;
type Payment = { id: string; chainId: number; label: string; native?: boolean; optional?: boolean; title: string; note: string };
const payments: Payment[] = [
  { id: "sepolia", chainId: sepolia.id, label: "vitalik", title: "Ethereum Sepolia · vitalik.eth", note: "Direct renewal on the hub through the V1 renewer. ERC-20 transfer." },
  { id: "base", chainId: baseSepolia.id, label: "skellat", title: "Base Sepolia · skellat.eth", note: "CCTP burn and claim, V2 registrar. ERC-20 transfer." },
  { id: "arbitrum", chainId: arbitrumSepolia.id, label: "farcaster", title: "Arbitrum Sepolia · farcaster.eth", note: "CCTP burn and claim, V1 renewer. ERC-20 transfer." },
  { id: "arc-native", chainId: arcTestnet.id, label: "steve", native: true, title: "Arc Testnet · steve.eth · native", note: "Native USDC value transfer; gas is also USDC. CCTP claim, V2 registrar." },
  { id: "arc-erc20", chainId: arcTestnet.id, label: "steve", optional: true, title: "Arc Testnet · steve.eth · ERC-20", note: "Optional second deposit through the token interface of the same system contract, so both Arc forms get a fresh canary." },
];
type Entry = {
  id: string; chainId: number; name: string; destination: Address; amount: string; native: boolean; sender: Address; signedAt: string;
  transactionHash: Hex; receipt?: { status: string; blockNumber: string; blockTime: string; logIndex: number | null; verified: boolean };
};
type Journal = { schema: 1; deployment: string; entries: Entry[] };
const key = "namepass-canary-funding:2026-10-23";
let journal: Journal;
try { journal = JSON.parse(localStorage.getItem(key) ?? "null"); if (!Array.isArray(journal?.entries)) throw Error(); }
catch { journal = { schema: 1, deployment: "two-contract-2026-10-23", entries: [] }; }
const save = () => { localStorage.setItem(key, JSON.stringify(journal)); void fetch("/funding-record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(journal) }).catch(() => {}); };

const wallets: { name: string; uuid: string; provider: EIP1193Provider }[] = [];
let provider: EIP1193Provider | undefined, account: Address | undefined, busy = false;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<header><span class="brand">Namepass</span><span class="badge">Testnet · Phase 6 canaries</span></header>
<h1>Fund the four canaries</h1>
<p>One deposit per chain to the two-contract deployment, <strong>1.00 testnet USDC</strong> each, plus network gas. Every button checks the chain, the factory's own address prediction, the name's activation on the beta and a live renewal quote before it asks Rainbow to sign. The relayer processes each deposit; this page only funds.</p>
<section class="panel"><div class="row between wallet-row"><h2>Browser wallet</h2><div class="row wallet-row"><select id="wallet" aria-label="Browser wallet"></select><button id="connect">Connect Rainbow</button></div></div><div id="account" class="status">No wallet connected.</div><div id="error" class="error hidden" role="alert"></div></section>
<div class="payment-grid" id="payments"></div>
<section class="panel"><h2>Funding record</h2><p class="tip">A confirmed receipt proves funding only. Indexing, finality and the renewal are verified separately from the receipts. Export this record when all transfers are confirmed.</p><div class="row actions wallet-row"><button id="export" class="secondary">Export funding record</button><button id="reset" class="secondary">Forget local record</button></div><div id="journal" class="journal"></div></section>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, value: string) => { el(id).textContent = value; };
const explorer = (chainId: number, hash: Hex) => `${ACTIVE_CHAINS.find(c => c.chainId === chainId)!.explorerUrl}/tx/${hash}`;

function render() {
  for (const p of payments) {
    const done = journal.entries.some(e => e.id === p.id && e.receipt?.status === "success");
    el<HTMLButtonElement>("sign-" + p.id).disabled = busy || !account || done;
    el<HTMLButtonElement>("resume-" + p.id).disabled = busy || !account || done;
  }
  el<HTMLButtonElement>("connect").disabled = busy;
  el("journal").replaceChildren();
  for (const e of journal.entries) {
    const row = document.createElement("p");
    const a = document.createElement("a"); a.href = explorer(e.chainId, e.transactionHash); a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = e.transactionHash;
    row.append(`${payments.find(p => p.id === e.id)?.title ?? e.id} · ${(Number(e.amount) / 1e6).toFixed(2)} USDC · ${e.receipt ? `${e.receipt.status}${e.receipt.verified ? ", credit verified" : ""}, block ${e.receipt.blockNumber}` : "submitted"}\n`, a);
    el("journal").append(row);
  }
}
async function action(task: () => Promise<void>) {
  if (busy) return; busy = true; el("error").classList.add("hidden"); render();
  try { await task(); } catch (error) { const e = error as { shortMessage?: string; message?: string }; setText("error", (e.shortMessage ?? e.message ?? "The request failed.").replace(/https?:\/\/\S+/g, "[RPC URL omitted]")); el("error").classList.remove("hidden"); }
  finally { busy = false; render(); }
}
function bind(id: string, task: () => Promise<void>) { el(id).addEventListener("click", () => void action(task)); }

async function ensureChain(chainId: number) {
  if (!provider || !account) throw Error("Connect your wallet first.");
  const definition = definitions[chainId];
  if (Number(await provider.request({ method: "eth_chainId" })) !== chainId) {
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}`, chainName: definition.name, nativeCurrency: definition.nativeCurrency, rpcUrls: [...definition.rpcUrls.default.http], blockExplorerUrls: definition.blockExplorers ? [definition.blockExplorers.default.url] : [] }] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
    }
  }
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!accounts[0] || getAddress(accounts[0]) !== account) throw Error("Wallet account changed. Connect again.");
  if (Number(await provider.request({ method: "eth_chainId" })) !== chainId) throw Error("The wallet is on a different network.");
}

/** The hub must be able to buy renewal time with this deposit through the active adapter. */
async function quote(label: string) {
  const factory = getAddress(HUB_CHAIN.factoryAddress!);
  const adapter = await hub.readContract({ address: factory, abi, functionName: "currentHelper" });
  const [registrar, v1, allowance] = await Promise.all([
    hub.readContract({ address: adapter, abi, functionName: "ethRegistrar" }),
    hub.readContract({ address: adapter, abi, functionName: "ethRenewerV1" }),
    hub.readContract({ address: factory, abi, functionName: "GAS_ALLOWANCE" }),
  ]);
  if (registrar.toLowerCase() !== HUB_CHAIN.ensRegistrarAddress!.toLowerCase() || v1.toLowerCase() !== HUB_CHAIN.ensRenewerV1Address!.toLowerCase()) throw Error("The active adapter uses different ENS contracts than the configuration.");
  const [seconds, applied] = await hub.readContract({ address: factory, abi, functionName: "quote", args: [label, AMOUNT - allowance] });
  if (!seconds || !applied || applied > AMOUNT - allowance) throw Error("This deposit cannot buy a verified renewal.");
  return seconds;
}

async function readiness(p: Payment) {
  const chain = ACTIVE_CHAINS.find(c => c.chainId === p.chainId)!, destination = getAddress(depositAddress(p.label)), reads = readers[p.chainId];
  if (await reads.getChainId() !== p.chainId) throw Error("The read RPC is on a different network.");
  const predicted = await reads.readContract({ address: getAddress(chain.factoryAddress!), abi, functionName: "predictWallet", args: [p.label] });
  if (getAddress(predicted) !== destination) throw Error("The factory's address prediction disagrees with the displayed destination.");
  const view = await fetch(`/api/names/${p.label}.eth`, { cache: "no-store" });
  if (!view.ok) throw Error("The beta does not report this name. Activate it before funding.");
  const data = await view.json();
  if (data.name?.depositAddress?.toLowerCase() !== destination.toLowerCase() || !data.name?.activatedAt) throw Error("Beta monitoring is not registered for this destination.");
  const seconds = await quote(p.label);
  return { chain, destination, reads, seconds };
}

async function send(p: Payment) {
  const stage = (message: string) => setText("state-" + p.id, message);
  if (journal.entries.some(e => e.id === p.id)) throw Error("A transfer is already recorded for this card. Use its hash to check it; do not send again.");
  stage("Switching the wallet network…");
  await ensureChain(p.chainId);
  stage("Checking destination, monitoring and renewal quote…");
  const { chain, destination, reads, seconds } = await readiness(p);
  const wallet = createWalletClient({ chain: definitions[p.chainId], transport: custom(provider!) });
  const token = getAddress(chain.usdcAddress);
  if (p.native) {
    const balance = await reads.getBalance({ address: account! });
    if (balance <= AMOUNT * NATIVE_SCALE) throw Error("Insufficient native USDC for this payment and gas.");
  } else {
    const balance = await reads.readContract({ address: token, abi, functionName: "balanceOf", args: [account!] });
    if (balance < AMOUNT) throw Error("Insufficient testnet USDC on this network.");
  }
  const tx = p.native
    ? { account: account!, to: destination, value: AMOUNT * NATIVE_SCALE }
    : { account: account!, to: token, data: encodeFunctionData({ abi, functionName: "transfer", args: [destination, AMOUNT] }), value: 0n };
  // Arc prices gas in USDC with legacy fees; read them from the verified RPC rather than the wallet.
  const fees = p.chainId === arcTestnet.id ? { type: "legacy" as const, gasPrice: await reads.getGasPrice() } : {};
  if ("gasPrice" in fees && (!fees.gasPrice || fees.gasPrice <= 0n)) throw Error("Arc gas pricing is unavailable.");
  const gas = await reads.estimateGas({ ...tx, ...fees });
  await ensureChain(p.chainId);
  stage(`Quote buys ${(Number(seconds) / 86400).toFixed(1)} days. Waiting for your wallet signature. Do not reload while the prompt is open.`);
  const transactionHash = await wallet.sendTransaction({ ...tx, ...fees, gas: gas * 12n / 10n });
  const entry: Entry = { id: p.id, chainId: p.chainId, name: `${p.label}.eth`, destination, amount: AMOUNT.toString(), native: !!p.native, sender: account!, signedAt: new Date().toISOString(), transactionHash };
  journal.entries.push(entry); save(); render();
  stage("Transfer submitted. Waiting for its receipt…");
  await confirmCredit(p, entry);
}

/** Binds the receipt to the expected credit: one matching Transfer log, or the native value to the wallet. */
async function confirmCredit(p: Payment, entry: Entry) {
  const reads = readers[p.chainId], token = getAddress(ACTIVE_CHAINS.find(c => c.chainId === p.chainId)!.usdcAddress);
  const receipt = await reads.waitForTransactionReceipt({ hash: entry.transactionHash, timeout: 180_000 });
  const tx = await reads.getTransaction({ hash: entry.transactionHash });
  const block = await reads.getBlock({ blockNumber: receipt.blockNumber });
  let logIndex: number | null = null, verified = false;
  if (receipt.status === "success" && getAddress(tx.from) === entry.sender) {
    if (p.native) verified = !!tx.to && getAddress(tx.to) === entry.destination && tx.value === AMOUNT * NATIVE_SCALE;
    else {
      const matches: number[] = [];
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== token) continue;
        try {
          const event = decodeEventLog({ abi, eventName: "Transfer", data: log.data, topics: log.topics });
          if (getAddress(event.args.from) === entry.sender && getAddress(event.args.to) === entry.destination && event.args.value === AMOUNT && log.logIndex !== null) matches.push(log.logIndex);
        } catch { /* other token events are not this credit */ }
      }
      verified = matches.length === 1; logIndex = matches[0] ?? null;
    }
  }
  entry.receipt = { status: receipt.status, blockNumber: receipt.blockNumber.toString(), blockTime: new Date(Number(block.timestamp) * 1000).toISOString(), logIndex, verified };
  save();
  setText("state-" + p.id, receipt.status !== "success" ? "The transfer reverted; nothing was delivered." : verified ? "Credit confirmed on chain. The relayer takes it from here." : "The receipt succeeded but does not show the expected credit. Keep the hash for inspection.");
}

async function resume(p: Payment) {
  const existing = journal.entries.find(e => e.id === p.id);
  const typed = el<HTMLInputElement>("hash-" + p.id).value.trim();
  const hash = (existing?.transactionHash ?? typed) as Hex;
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error("Paste the transaction hash from Rainbow to check a lost submission.");
  if (!existing) {
    const destination = getAddress(depositAddress(p.label));
    journal.entries.push({ id: p.id, chainId: p.chainId, name: `${p.label}.eth`, destination, amount: AMOUNT.toString(), native: !!p.native, sender: account!, signedAt: new Date().toISOString(), transactionHash: hash });
    save();
  }
  setText("state-" + p.id, "Checking the submitted transaction…");
  await confirmCredit(p, journal.entries.find(e => e.id === p.id)!);
}

for (const p of payments) {
  const card = document.createElement("section"); card.className = "payment-card";
  card.innerHTML = `<h2>${p.title}</h2><p>${p.note}</p><span class="badge">${p.optional ? "Optional · " : ""}1.00 testnet USDC${p.native ? " · native value" : ""}</span><p class="destination">${getAddress(depositAddress(p.label))}</p><button id="sign-${p.id}" disabled>Sign 1.00 USDC</button><label for="hash-${p.id}" class="tip">Recovery hash (only if the wallet result was lost)</label><input id="hash-${p.id}" placeholder="0x…" autocomplete="off" spellcheck="false"><button id="resume-${p.id}" class="secondary" disabled>Check submitted transaction</button><div id="state-${p.id}" class="payment-state" aria-live="polite"></div>`;
  el("payments").append(card); bind("sign-" + p.id, () => send(p)); bind("resume-" + p.id, () => resume(p));
}
bind("connect", async () => {
  const wallet = wallets[Number(el<HTMLSelectElement>("wallet").value)];
  if (!wallet) throw Error("Open this page in Chrome with Rainbow enabled.");
  provider = wallet.provider;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts[0]) throw Error("Select a wallet account.");
  account = getAddress(accounts[0]); setText("account", `${wallet.name} · ${account}`);
});
bind("export", async () => {
  const blob = new Blob([JSON.stringify({ ...journal, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "namepass-canary-funding-2026-10-23.json"; a.click(); URL.revokeObjectURL(a.href);
});
bind("reset", async () => { if (window.confirm("Forget the local funding record? Confirmed transfers stay on chain and in the mirrored file.")) { journal = { schema: 1, deployment: journal.deployment, entries: [] }; save(); } });
window.addEventListener("eip6963:announceProvider", (event) => {
  const { info, provider: found } = (event as CustomEvent<{ info: { name: string; uuid: string }; provider: EIP1193Provider }>).detail;
  if (wallets.some(w => w.uuid === info.uuid)) return;
  wallets.push({ name: info.name, uuid: info.uuid, provider: found });
  const select = el<HTMLSelectElement>("wallet"); select.replaceChildren(...wallets.map((w, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = w.name; return o; }));
  const rainbow = wallets.findIndex(w => /rainbow/i.test(w.name)); if (rainbow >= 0) select.value = String(rainbow);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
render();
