import "@fontsource-variable/geist";
import "./style.css";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, getAddress, http, keccak256, parseAbi, parseEther, type Address, type EIP1193Provider, type Hex } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia, arcTestnet } from "viem/chains";
import { ACTIVE_CHAINS, HUB_CHAIN, chainById } from "../../src/lib/chains";
import { depositAddress, normalizeLabel } from "../../src/lib/namepass";
import { batchCreditPositions, batchDepositAmount, batchData, multicallAddress, multicallCodeHash } from "./batch";

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
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transferFrom(address,address,uint256) returns (bool)",
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
type Batch = { id: string; chainId: number; sender: Address; destination: Address; requestedAt: string; approvalHash?: Hex; approved?: boolean; fundingRequestedAt?: string; transactionHash?: Hex; logIndices?: number[] };
type Journal = { entries: Entry[]; batch?: Batch; firstWatch?: { name: string; destination: Address; checkedAt: string; activatedAt?: string; activationResponse?: unknown }; capture?: unknown; gasFunding?: { chainId: number; destination: Address; amountWei: string; transactionHash: Hex; receipt?: { status: string; blockNumber: string } } };
const gasRecipient = getAddress("0xd3f6f8F45F1cc6DcA75B918311302E852d268d9C");
const key = "namepass-api-payment-canary:october-2026";
let journal: Journal;
try { journal = JSON.parse(localStorage.getItem(key) ?? '{"entries":[]}'); if (!Array.isArray(journal.entries)) throw Error(); }
catch { journal = { entries: [] }; }
const save = () => { localStorage.setItem(key, JSON.stringify(journal)); void fetch("/payment-record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(journal) }).catch(() => {}); };
const wallets: { name: string; uuid: string; provider: EIP1193Provider }[] = [];
let provider: EIP1193Provider | undefined, account: Address | undefined, busy = false;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<header><span class="brand">Namepass</span><span class="badge">Testnet · live API checks</span></header>
<h1>Verify the remaining payment case</h1><p>The previous route payments are recorded below. The next check sends two USDC deposits in one transaction, so the API must account for both before reporting completion.</p>
<section class="panel"><div class="row between wallet-row"><h2>Browser wallet</h2><div class="row wallet-row"><select id="wallet" aria-label="Browser wallet"></select><button id="connect">Connect Rainbow</button></div></div><div id="account" class="status">No wallet connected.</div><div id="error" class="error hidden" role="alert"></div></section>
<section class="panel"><span class="number">Next check · multiple deposits in one transaction</span><h2>Two deposits, one transaction</h2><p><strong>Ethereum Sepolia · 2 × 0.50 testnet USDC</strong> to farcaster.eth, plus network gas. First approve exactly 1.00 USDC to public Multicall3, then send both deposits in one normal Rainbow transaction.</p><p class="tip">Anyone can use this public contract to spend the approved 1.00 USDC before your deposit transaction. Use testnet USDC only. Successful funding consumes the full allowance.</p><p class="destination">${getAddress(depositAddress("farcaster"))}</p><div class="row actions wallet-row"><button id="approve-batch" class="secondary" disabled>1. Approve 1.00 testnet USDC</button><button id="sign-batch" disabled>2. Send two deposits · 1.00 USDC</button><button id="resume-batch" class="secondary" disabled>Check submitted transaction</button></div><label for="batch-hash">Recovery transaction hash (only if the wallet result was lost)</label><input id="batch-hash" placeholder="0x…" autocomplete="off" spellcheck="false"><div id="batch-state" class="payment-state" aria-live="polite"></div></section>
<div class="notice">Earlier route checks: four separate <strong>0.50 testnet-USDC payments</strong>. Completed payments cannot be submitted again. This page holds no backend key.</div>
<div class="payment-grid" id="payments"></div>
<section class="panel"><span class="number">Automation gas · separate transfer</span><h2>Fund the pending claims</h2><p>The automation account needs Sepolia ETH to execute the Base and Arc claims. This sends 0.01 testnet ETH to the automation account, not to an ENS deposit address. Existing recovery will retry the prepared claims.</p><p class="destination">${gasRecipient}</p><button id="fund-gas" disabled>Sign 0.01 Sepolia ETH</button><div id="gas-state" class="payment-state" aria-live="polite"></div></section>
<section class="panel"><span class="number">First-time activation · separate check</span><h2>A newly watched name</h2><p>Check an eligible name that Namepass has never activated. Activate through the same core route used by the app, then fund it while the existing Goldsky capture is running.</p><label for="new-name">ENS name</label><input id="new-name" value="stressfully.eth" autocomplete="off" spellcheck="false"><div class="row actions wallet-row"><button id="check-new" class="secondary">Check name</button><button id="activate" disabled>Activate monitoring</button><button id="fund-new" disabled>Sign 0.50 USDC · Sepolia</button></div><div id="new-destination" class="destination"></div><div id="new-state" class="payment-state" aria-live="polite"></div></section>
<section class="panel"><h2>Payment record</h2><p class="tip">A successful transfer receipt confirms funding. The API checks must separately confirm indexing, finality and renewal. Export or copy these hashes for verification.</p><button id="export" class="secondary">Export public payment record</button><div id="journal" class="journal"></div></section>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, value: string) => { el(id).textContent = value; };
if (journal.firstWatch) el<HTMLInputElement>("new-name").value = journal.firstWatch.name;
function hashLink(entry: Entry) {
  const a = document.createElement("a"); a.href = `${chainById(entry.chainId)!.explorerUrl}/tx/${entry.transactionHash}`; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = entry.transactionHash; return a;
}
function render() {
  for (const p of payments) el<HTMLButtonElement>("sign-" + p.id).disabled = busy || !account || journal.entries.some(e => e.id === p.id);
  for (const id of ["connect", "check-new"]) el<HTMLButtonElement>(id).disabled = busy;
  el<HTMLInputElement>("new-name").disabled = busy || !!journal.firstWatch?.activatedAt;
  el<HTMLButtonElement>("activate").disabled = busy || !journal.firstWatch || !!journal.firstWatch.activatedAt;
  el<HTMLButtonElement>("fund-new").disabled = busy || !account || !journal.firstWatch?.activatedAt || journal.entries.some(e => e.id === "first-watch");
  el<HTMLButtonElement>("fund-gas").disabled = busy || !account || !!journal.gasFunding;
  el<HTMLButtonElement>("approve-batch").disabled = busy || !account || !!journal.batch;
  el<HTMLButtonElement>("sign-batch").disabled = busy || !account || !journal.batch?.approved || !!journal.batch.fundingRequestedAt;
  el<HTMLButtonElement>("resume-batch").disabled = busy || !account || !journal.batch || !!journal.batch.logIndices;
  if (journal.gasFunding) setText("gas-state", `Gas funding ${journal.gasFunding.receipt?.status ?? "submitted"}. Transaction: ${journal.gasFunding.transactionHash}`);
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
  const statusId = p.id === "first-watch" ? "new-state" : "state-" + p.id;
  const stage = (message: string) => setText(statusId, message);
  stage("Checking the stream capture…");
  await capture();
  if (!provider || !account) throw Error("Connect your wallet first.");
  const definition = definitions.find(c => c.id === p.chainId)!;
  if (Number(await provider.request({ method: "eth_chainId" })) !== p.chainId) {
    stage(`Waiting for the wallet to switch to ${definition.name}…`);
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${p.chainId.toString(16)}` }] }); }
    catch (error) { if ((error as { code?: number }).code !== 4902) throw error; await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: `0x${p.chainId.toString(16)}`, chainName: definition.name, nativeCurrency: definition.nativeCurrency, rpcUrls: [...definition.rpcUrls.default.http], blockExplorerUrls: [definition.blockExplorers!.default.url] }] }); await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${p.chainId.toString(16)}` }] }); }
  }
  stage("Checking network, destination, monitoring and renewal quote…");
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
  // Prepare Arc's legacy fee on its verified RPC. Do not depend on a wallet's
  // supported-network gas estimator for this custom USDC gas-token chain.
  stage("Simulating the payment and reading network gas pricing…");
  const fees = p.chainId === arcTestnet.id ? { type: "legacy" as const, gasPrice: await reads.getGasPrice() } : {};
  if ("gasPrice" in fees && (!fees.gasPrice || fees.gasPrice <= 0n)) throw Error("Arc gas pricing is unavailable.");
  const gas = await reads.estimateGas({ ...tx, ...fees }); await walletCheck(p.chainId);
  stage("RPC checks passed. Waiting for your wallet signature. If Rainbow's preview cannot load, reject the request and select another browser wallet. Do not reload while a signature is pending.");
  const transactionHash = await wallet.sendTransaction({ ...tx, ...fees, gas: gas * 12n / 10n });
  const entry: Entry = { id: p.id, chainId: p.chainId, name: `${p.label}.eth`, destination, amount: p.amount.toString(), native: !!p.native, signedAt: new Date().toISOString(), transactionHash };
  journal.entries.push(entry); save(); render();
  stage("Payment submitted. Waiting for its receipt…");
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
const batchChain = chainById(sepolia.id)!;
const batchToken = getAddress(batchChain.usdcAddress);
async function batchWallet() {
  if (!provider || !account) throw Error("Connect your wallet first.");
  setText("batch-state", "Checking Ethereum Sepolia and Multicall3…");
  if (Number(await provider.request({ method: "eth_chainId" })) !== sepolia.id)
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${sepolia.id.toString(16)}` }] });
  await walletCheck(sepolia.id);
  const code = await hub.getCode({ address: multicallAddress });
  if (!code || keccak256(code) !== multicallCodeHash) throw Error("Sepolia Multicall3 code does not match the verified deployment.");
  return createWalletClient({ chain: sepolia, transport: custom(provider) });
}
async function batchPreflight(batch: Batch) {
  await capture();
  const [predicted, balance, view] = await Promise.all([
    hub.readContract({ address: getAddress(batchChain.factoryAddress!), abi, functionName: "predictWallet", args: ["farcaster"] }),
    hub.readContract({ address: batchToken, abi, functionName: "balanceOf", args: [batch.sender] }),
    fetch("/api/names/farcaster.eth", { cache: "no-store" }),
  ]);
  if (getAddress(predicted) !== batch.destination || balance < 2n * batchDepositAmount) throw Error("Destination or 1.00-USDC balance check failed.");
  if (!view.ok) throw Error("Name monitoring is unavailable.");
  const body = await view.json();
  if (!body.name?.activatedAt || body.name?.depositAddress?.toLowerCase() !== batch.destination.toLowerCase()) throw Error("Name monitoring does not match the destination.");
  await quote("farcaster", 2n * batchDepositAmount);
}
async function batchFees(to: Address, data: Hex) {
  const tx = { account: account!, to, data, value: 0n };
  const [gas, fees, balance] = await Promise.all([hub.estimateGas(tx), hub.estimateFeesPerGas(), hub.getBalance({ address: account! })]);
  const gasLimit = gas * 12n / 10n;
  if (!fees.maxFeePerGas || balance < gasLimit * fees.maxFeePerGas) throw Error("Insufficient Sepolia ETH for gas.");
  return { ...tx, ...fees, gas: gasLimit };
}
async function checkSubmittedBatch() {
  const batch = journal.batch;
  if (!batch || !account || getAddress(account) !== getAddress(batch.sender)) throw Error("Connect the account recorded for this test.");
  const funding = !!batch.fundingRequestedAt;
  const knownHash = funding ? batch.transactionHash : batch.approvalHash;
  const hash = knownHash ?? el<HTMLInputElement>("batch-hash").value.trim() as Hex;
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error("Paste the missing transaction hash from Rainbow to recover this request. Do not submit another payment.");
  const transaction = await hub.getTransaction({ hash });
  const expectedData = funding ? batchData(batchToken, batch.sender, batch.destination) : encodeFunctionData({ abi, functionName: "approve", args: [multicallAddress, 2n * batchDepositAmount] });
  if (getAddress(transaction.from) !== getAddress(batch.sender) || !transaction.to || getAddress(transaction.to) !== (funding ? multicallAddress : batchToken)
    || transaction.input.toLowerCase() !== expectedData.toLowerCase() || transaction.value !== 0n) throw Error("Transaction does not match the recorded request.");
  if (funding) batch.transactionHash = hash; else batch.approvalHash = hash;
  save();
  if (transaction.blockNumber === null) { setText("batch-state", "Transaction is pending. Check again without submitting another request."); return; }
  const receipt = await hub.getTransactionReceipt({ hash });
  if (receipt.status !== "success") throw Error("Transaction reverted. Keep the record for inspection; do not submit again.");
  if (!funding) {
    const allowance = await hub.readContract({ address: batchToken, abi, functionName: "allowance", args: [batch.sender, multicallAddress] });
    if (allowance !== 2n * batchDepositAmount) throw Error("The exact 1.00-USDC approval is no longer available. Do not approve again.");
    batch.approved = true; save(); setText("batch-state", "1.00-USDC approval confirmed. Send the two deposits next."); return;
  }
  const logIndices = batchCreditPositions(receipt, batchToken, batch.sender, batch.destination);
  const allowance = await hub.readContract({ address: batchToken, abi, functionName: "allowance", args: [batch.sender, multicallAddress] });
  if (allowance !== 0n) throw Error("Funding receipt is successful but an allowance remains. Inspect it before continuing.");
  batch.logIndices = logIndices;
  for (const [index, logIndex] of batch.logIndices.entries()) {
    const id = "batch-" + index;
    if (!journal.entries.some(e => e.id === id)) journal.entries.push({ id, chainId: batch.chainId, name: "farcaster.eth", destination: batch.destination,
      amount: batchDepositAmount.toString(), native: false, signedAt: batch.fundingRequestedAt!, transactionHash: hash,
      receipt: { status: receipt.status, blockNumber: receipt.blockNumber.toString(), logIndices: [logIndex] } });
  }
  save(); setText("batch-state", `Confirmed two 0.50-USDC credits in ${hash}. Log positions: ${batch.logIndices.join(", ")}. Allowance is zero. Codex can now verify indexing and the renewal.`);
}
bind("approve-batch", async () => {
  if (!account || journal.batch) throw Error("Connect your wallet; a recorded request must not be submitted again.");
  const wallet = await batchWallet();
  const allowance = await hub.readContract({ address: batchToken, abi, functionName: "allowance", args: [account, multicallAddress] });
  if (allowance !== 0n) throw Error("An allowance already exists. Inspect it before preparing this test.");
  const data = encodeFunctionData({ abi, functionName: "approve", args: [multicallAddress, 2n * batchDepositAmount] });
  const tx = await batchFees(batchToken, data); await walletCheck(sepolia.id);
  const batch: Batch = { id: crypto.randomUUID(), chainId: sepolia.id, sender: account, destination: getAddress(depositAddress("farcaster")), requestedAt: new Date().toISOString() };
  journal.batch = batch; save(); render();
  setText("batch-state", "Review the exact 1.00 testnet-USDC approval in Rainbow. Do not reload while the request is open.");
  try { batch.approvalHash = await wallet.sendTransaction(tx); }
  catch (error) { if ((error as { cause?: { code?: number }; code?: number }).code === 4001 || (error as { cause?: { code?: number } }).cause?.code === 4001) { delete journal.batch; save(); } throw error; }
  save(); setText("batch-state", "Approval submitted. Check submitted transaction after confirmation.");
});
bind("resume-batch", checkSubmittedBatch);
bind("sign-batch", async () => {
  const batch = journal.batch;
  if (!account || !batch?.approved || batch.fundingRequestedAt || getAddress(account) !== getAddress(batch.sender)) throw Error("Use the approved account; a recorded funding request must not be submitted again.");
  const wallet = await batchWallet(); await batchPreflight(batch);
  const allowance = await hub.readContract({ address: batchToken, abi, functionName: "allowance", args: [batch.sender, multicallAddress] });
  if (allowance !== 2n * batchDepositAmount) throw Error("The exact 1.00-USDC allowance is unavailable. Do not approve again.");
  const tx = await batchFees(multicallAddress, batchData(batchToken, batch.sender, batch.destination)); await walletCheck(sepolia.id);
  batch.fundingRequestedAt = new Date().toISOString(); save(); render();
  setText("batch-state", "Review one Multicall3 transaction with two 0.50-USDC transfers in Rainbow. Do not reload while the request is open.");
  try { batch.transactionHash = await wallet.sendTransaction(tx); }
  catch (error) { if ((error as { cause?: { code?: number }; code?: number }).code === 4001 || (error as { cause?: { code?: number } }).cause?.code === 4001) { delete batch.fundingRequestedAt; save(); } throw error; }
  save(); setText("batch-state", "Funding submitted. Check submitted transaction after confirmation.");
});
bind("fund-gas", async () => {
  if (!provider || !account || journal.gasFunding) throw Error("Connect your wallet; gas funding must not be submitted twice.");
  setText("gas-state", "Waiting for the wallet to switch to Ethereum Sepolia…");
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${sepolia.id.toString(16)}` }] });
  await walletCheck(sepolia.id);
  const tx = { account, to: gasRecipient, value: parseEther("0.01") };
  const [gas, fees, balance] = await Promise.all([hub.estimateGas(tx), hub.estimateFeesPerGas(), hub.getBalance({ address: account })]);
  const gasLimit = gas * 12n / 10n;
  if (!fees.maxFeePerGas || balance < tx.value + gasLimit * fees.maxFeePerGas) throw Error("Insufficient Sepolia ETH for the top-up and gas.");
  await walletCheck(sepolia.id);
  setText("gas-state", "Review the 0.01 testnet ETH transfer and automation address in your wallet. Waiting for your signature…");
  const wallet = createWalletClient({ chain: sepolia, transport: custom(provider) });
  const transactionHash = await wallet.sendTransaction({ ...tx, ...fees, gas: gasLimit });
  journal.gasFunding = { chainId: sepolia.id, destination: gasRecipient, amountWei: tx.value.toString(), transactionHash }; save(); render();
  const receipt = await hub.waitForTransactionReceipt({ hash: transactionHash, timeout: 120000 });
  journal.gasFunding.receipt = { status: receipt.status, blockNumber: receipt.blockNumber.toString() }; save();
});
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
if (journal.batch) setText("batch-state", journal.batch.logIndices ? `Funding verified: ${journal.batch.transactionHash}. Do not submit it again.`
  : journal.batch.approved && !journal.batch.fundingRequestedAt ? "1.00-USDC approval confirmed. Send the two deposits next."
  : "A wallet request is recorded. Connect the original account and check its transaction. Do not submit another request.");
render();
