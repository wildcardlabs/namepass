import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	createPublicClient,
	createWalletClient,
	custom,
	encodeFunctionData,
	getAddress,
	parseAbi,
	type Address,
	type Chain,
	type EIP1193Provider,
	type Hex,
} from "viem";
import { arbitrumSepolia, arcTestnet, baseSepolia, sepolia } from "viem/chains";
import { Check, ExternalLink, Loader2, Wallet as WalletIcon } from "lucide-react";
import { BackButton } from "./BackButton";
import { FUNDING_CHAINS, HUB_CHAIN, IS_TESTNET, chainById, type ChainDefinition } from "../lib/chains";
import { fmtDate, fmtDurationPrecise, fmtUsdcExact, truncAddress } from "../lib/format";
import { depositAddress, labelProblem, LABEL_PROBLEM_TEXT, normalizeLabel } from "../lib/namepass";
import { getPublicConfig } from "../lib/publicApi";
import { creditLogIndex, parseUsdc, pollStatus, v1, V1Error, type QuoteResponse, type StatusResponse } from "../lib/renewalTest";

/**
 * `/test`: renew any testnet ENS name with USDC from a browser wallet.
 *
 * One card: name, network, amount and a live price. One button walks the
 * visitor through connecting, switching network and paying; then the page
 * follows the renewal to completion. Underneath it uses only the public API
 * (`quote`, `address`, `status`, `renewals`) and one wallet-signed USDC
 * transfer. Before asking for a signature it checks, silently, that the API's
 * deposit address equals this build's derivation and that the token is the
 * registry's USDC. Unlinked and testnet-only.
 */

const WALLET_CHAINS: Record<number, Chain> = {
	[sepolia.id]: sepolia,
	[baseSepolia.id]: baseSepolia,
	[arbitrumSepolia.id]: arbitrumSepolia,
	[arcTestnet.id]: arcTestnet,
};
const ERC20 = parseAbi([
	"function balanceOf(address) view returns (uint256)",
	"function transfer(address to, uint256 value) returns (bool)",
]);
const PRESETS = ["1", "5", "10"];
const STORAGE_KEY = "namepass-test-renewal";
const FAUCET = "https://faucet.circle.com";

type ProviderInfo = { uuid: string; name: string; icon?: string };
type Wallet = { info: ProviderInfo; provider: EIP1193Provider };

/** A payment in flight, kept so a reload resumes the progress view. */
interface Payment {
	name: string;
	chainId: number;
	transactionHash: Hex;
	amount: string;
	secondsAdded: string;
}

type Phase =
	| { kind: "form" }
	| { kind: "paying"; stage: string }
	| { kind: "tracking"; payment: Payment; status: StatusResponse | null }
	| { kind: "done"; payment: Payment; status: StatusResponse }
	| { kind: "failed"; payment: Payment };

function loadPayment(): Payment | null {
	try {
		const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Payment | null;
		return value && /^0x[0-9a-fA-F]{64}$/.test(value.transactionHash) && chainById(value.chainId) ? value : null;
	} catch {
		return null;
	}
}
function savePayment(payment: Payment | null) {
	try {
		if (payment) localStorage.setItem(STORAGE_KEY, JSON.stringify(payment));
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Storage only enables resuming; the flow works without it.
	}
}

/** Plain-language text for API and wallet errors. */
function friendly(error: unknown): string {
	if (error instanceof V1Error) {
		switch (error.code) {
			case "name_not_renewable":
				return "This name isn't registered, or it can't be renewed right now.";
			case "invalid_name":
				return "That isn't a valid ENS name.";
			case "rate_limited":
			case "quote_capacity":
			case "address_capacity":
				return "Namepass is busy. Try again in a moment.";
			case "ens_unavailable":
			case "activation_unavailable":
				return "ENS data is temporarily unavailable. Try again in a moment.";
			default:
				return error.message;
		}
	}
	const code = (error as { code?: number; cause?: { code?: number } })?.code ?? (error as { cause?: { code?: number } })?.cause?.code;
	if (code === 4001) return "You cancelled the request in your wallet.";
	if (error instanceof Error) return (error as { shortMessage?: string }).shortMessage ?? error.message;
	return String(error);
}

const txUrl = (chainId: number | string, hash: string) => `${chainById(Number(chainId))?.explorerUrl ?? ""}/tx/${hash}`;

export default function TestRenew({ onBack }: { onBack: () => void }) {
	return (
		<div className="w-full px-5 md:px-10 pt-4 pb-20 md:pb-28">
			<div className="max-w-[520px] mx-auto">
				<BackButton onClick={onBack} label="Back to Namepass" />
				{IS_TESTNET ? <RenewApp /> : (
					<>
						<h1 className="mt-8 text-ink-primary">Renew a name</h1>
						<p className="mt-4 text-ink-secondary">This page is only available on the testnet.</p>
					</>
				)}
			</div>
		</div>
	);
}

function RenewApp() {
	/* Wallet */
	const [wallets, setWallets] = useState<Wallet[]>([]);
	const [choosing, setChoosing] = useState(false);
	const [provider, setProvider] = useState<EIP1193Provider | null>(null);
	const [account, setAccount] = useState<Address | null>(null);
	const [walletChainId, setWalletChainId] = useState<number | null>(null);

	/* Form */
	const [nameInput, setNameInput] = useState("");
	const [chainId, setChainId] = useState<number>(HUB_CHAIN.chainId);
	const [amountInput, setAmountInput] = useState("5");

	/* Live reads */
	const [quote, setQuote] = useState<QuoteResponse | null>(null);
	const [quoting, setQuoting] = useState(false);
	const [quoteError, setQuoteError] = useState<string | null>(null);
	const [expiry, setExpiry] = useState<string | null>(null);
	const [balance, setBalance] = useState<bigint | null>(null);
	const [minimums, setMinimums] = useState<Map<number, bigint>>(new Map());

	const [phase, setPhase] = useState<Phase>(() => {
		const saved = loadPayment();
		return saved ? { kind: "tracking", payment: saved, status: null } : { kind: "form" };
	});
	const [notice, setNotice] = useState<string | null>(null);
	const polling = useRef<AbortController | null>(null);

	const label = useMemo(() => {
		try {
			return normalizeLabel(nameInput);
		} catch {
			return null;
		}
	}, [nameInput]);
	const name = label ? `${label}.eth` : null;
	const amount = parseUsdc(amountInput);
	const chain = chainById(chainId) as ChainDefinition;
	const nameIssue = nameInput.trim() && !label ? LABEL_PROBLEM_TEXT[labelProblem(nameInput) ?? "not-normalizable"] : null;

	/* Page setup and wallet discovery (EIP-6963, with an injected-provider fallback). */
	useEffect(() => {
		document.title = "Renew a name · Namepass";
		const robots = document.createElement("meta");
		robots.name = "robots";
		robots.content = "noindex";
		document.head.appendChild(robots);
		const announce = (event: Event) => {
			const detail = (event as CustomEvent<Wallet>).detail;
			setWallets((list) => (list.some((w) => w.info.uuid === detail.info.uuid) ? list : [...list, detail]));
		};
		window.addEventListener("eip6963:announceProvider", announce);
		window.dispatchEvent(new Event("eip6963:requestProvider"));
		getPublicConfig()
			.then((config) => setMinimums(new Map(config.chains.map((c) => [c.chainId, BigInt(c.minimumTriggerAmount)]))))
			.catch(() => {});
		const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
		const fallback = setTimeout(() => {
			if (injected) setWallets((list) => (list.length ? list : [{ info: { uuid: "injected", name: "Browser wallet" }, provider: injected }]));
		}, 400);
		return () => {
			window.removeEventListener("eip6963:announceProvider", announce);
			clearTimeout(fallback);
			robots.remove();
			polling.current?.abort();
			polling.current = null;
		};
	}, []);

	useEffect(() => {
		if (!provider) return;
		const onChain = (id: string) => setWalletChainId(Number(id));
		const onAccounts = (list: string[]) => setAccount(list[0] ? getAddress(list[0]) : null);
		provider.on("chainChanged", onChain);
		provider.on("accountsChanged", onAccounts);
		return () => {
			provider.removeListener("chainChanged", onChain);
			provider.removeListener("accountsChanged", onAccounts);
		};
	}, [provider]);

	/* A notice belongs to the choice that caused it. */
	useEffect(() => setNotice(null), [name, chainId, amountInput]);

	/* Live price, debounced. Quotes are read-only: they do not activate the name. */
	useEffect(() => {
		setQuote(null);
		setQuoteError(null);
		if (!name || amount === null || phase.kind !== "form") return;
		const controller = new AbortController();
		setQuoting(true);
		const timer = setTimeout(() => {
			v1.quote(name, String(chainId), amount.toString(), controller.signal)
				.then(setQuote)
				.catch((error) => { if (!controller.signal.aborted) setQuoteError(friendly(error)); })
				.finally(() => { if (!controller.signal.aborted) setQuoting(false); });
		}, 450);
		return () => {
			clearTimeout(timer);
			controller.abort();
			setQuoting(false);
		};
	}, [name, chainId, amount, phase.kind]);

	/* Current expiry, when Namepass already tracks the name. */
	useEffect(() => {
		setExpiry(null);
		if (!name) return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			v1.renewals(name, controller.signal).then((h) => setExpiry(h.currentExpiry)).catch(() => {});
		}, 450);
		return () => { clearTimeout(timer); controller.abort(); };
	}, [name]);

	/* The wallet's USDC balance, read through the wallet when it is on the chosen network. */
	const readBalance = useCallback(async () => {
		setBalance(null);
		if (!provider || !account || walletChainId !== chainId) return;
		const reads = createPublicClient({ chain: WALLET_CHAINS[chainId], transport: custom(provider) });
		try {
			setBalance(await reads.readContract({ address: getAddress(chain.usdcAddress), abi: ERC20, functionName: "balanceOf", args: [account] }));
		} catch {
			setBalance(null);
		}
	}, [provider, account, walletChainId, chainId, chain.usdcAddress]);
	useEffect(() => { void readBalance(); }, [readBalance]);

	/* Follow a payment until the renewal is verified. */
	const track = useCallback((payment: Payment) => {
		polling.current?.abort();
		const controller = new AbortController();
		polling.current = controller;
		setPhase({ kind: "tracking", payment, status: null });
		pollStatus(String(payment.chainId), payment.transactionHash, (update) => {
			if ("status" in update) setPhase({ kind: "tracking", payment, status: update.status });
		}, controller.signal)
			.then((final) => setPhase(final.status === "complete" ? { kind: "done", payment, status: final } : { kind: "failed", payment }))
			.catch(() => {
				if (!controller.signal.aborted) setNotice("We lost contact with Namepass. Your payment is safe; reload the page to keep following it.");
			});
	}, []);
	useEffect(() => {
		if (phase.kind === "tracking" && !polling.current) track(phase.payment);
	}, [phase, track]);

	/* Actions */
	const connect = async (wallet: Wallet) => {
		setChoosing(false);
		setNotice(null);
		try {
			const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
			if (!accounts[0]) throw new Error("No account was selected.");
			setProvider(wallet.provider);
			setAccount(getAddress(accounts[0]));
			setWalletChainId(Number(await wallet.provider.request({ method: "eth_chainId" })));
		} catch (error) {
			setNotice(friendly(error));
		}
	};

	const switchNetwork = async () => {
		if (!provider) return;
		setNotice(null);
		const hex = `0x${chainId.toString(16)}`;
		try {
			try {
				await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
			} catch (error) {
				if ((error as { code?: number }).code !== 4902) throw error;
				const target = WALLET_CHAINS[chainId];
				await provider.request({
					method: "wallet_addEthereumChain",
					params: [{
						chainId: hex,
						chainName: target.name,
						nativeCurrency: target.nativeCurrency,
						rpcUrls: [...target.rpcUrls.default.http],
						blockExplorerUrls: target.blockExplorers ? [target.blockExplorers.default.url] : undefined,
					}],
				});
			}
			setWalletChainId(Number(await provider.request({ method: "eth_chainId" })));
		} catch (error) {
			setNotice(friendly(error));
		}
	};

	const renew = async () => {
		if (!provider || !account || !name || !label || amount === null || !quote) return;
		setNotice(null);
		const stage = (text: string) => setPhase({ kind: "paying", stage: text });
		try {
			stage("Preparing your payment…");
			const address = await v1.address(name);
			/* Pay only an address this build derives, with the registry's USDC. */
			const to = getAddress(address.depositAddress);
			const token = getAddress(chain.usdcAddress);
			const listed = address.chains.find((c) => Number(c.chainId) === chainId);
			if (to !== getAddress(depositAddress(label)) || !listed || getAddress(listed.tokenAddress) !== token)
				throw new Error("Namepass returned payment details this page does not recognise. Nothing was sent.");
			if (amount < BigInt(listed.minimumAmount)) throw new Error(`The minimum on ${chain.network} is ${fmtUsdcExact(BigInt(listed.minimumAmount))}.`);
			let priced = quote;
			if (Date.parse(priced.expiresAt) < Date.now()) priced = await v1.quote(name, String(chainId), amount.toString());

			const reads = createPublicClient({ chain: WALLET_CHAINS[chainId], transport: custom(provider) });
			const writes = createWalletClient({ chain: WALLET_CHAINS[chainId], transport: custom(provider) });
			const held = await reads.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account] });
			if (held < amount) throw new Error(`Your wallet has ${fmtUsdcExact(held)} USDC on ${chain.network}.`);
			const data = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, amount] });
			/* Arc prices gas in USDC with legacy fees. */
			const fees = chainId === arcTestnet.id ? { type: "legacy" as const, gasPrice: await reads.getGasPrice() } : {};
			const gas = await reads.estimateGas({ account, to: token, data, ...fees });

			stage("Confirm the payment in your wallet");
			const transactionHash = await writes.sendTransaction({ account, to: token, data, gas: (gas * 12n) / 10n, ...fees });
			const payment: Payment = { name, chainId, transactionHash, amount: amount.toString(), secondsAdded: priced.secondsAdded };
			savePayment(payment);

			stage("Sending your payment…");
			const receipt = await reads.waitForTransactionReceipt({ hash: transactionHash, timeout: 180_000 });
			if (receipt.status !== "success" || creditLogIndex(receipt.logs, { token, to, amount }) === null) {
				savePayment(null);
				throw new Error("The payment did not go through. No USDC left your wallet.");
			}
			void readBalance();
			track(payment);
		} catch (error) {
			setPhase({ kind: "form" });
			setNotice(friendly(error));
		}
	};

	const startOver = () => {
		polling.current?.abort();
		polling.current = null;
		savePayment(null);
		setNotice(null);
		setPhase({ kind: "form" });
	};

	/* Views */
	if (phase.kind === "tracking" || phase.kind === "done" || phase.kind === "failed")
		return <Progress phase={phase} notice={notice} onStartOver={startOver} />;

	const paying = phase.kind === "paying";
	const minimum = minimums.get(chainId) ?? null;
	const button = ((): { label: string; action?: () => void; busy?: boolean } => {
		if (paying) return { label: phase.stage, busy: true };
		if (!name) return { label: "Enter a name" };
		if (amount === null) return { label: "Enter an amount" };
		if (minimum !== null && amount < minimum) return { label: `Minimum is ${fmtUsdcExact(minimum)}` };
		if (quoteError) return { label: "Can't renew this name" };
		if (!quote) return { label: "Getting price…", busy: quoting };
		if (!account) {
			if (!wallets.length) return { label: "Install a browser wallet" };
			return { label: "Connect wallet", action: () => (wallets.length === 1 ? void connect(wallets[0]) : setChoosing(true)) };
		}
		if (walletChainId !== chainId) return { label: `Switch to ${chain.network}`, action: () => void switchNetwork() };
		if (balance !== null && balance < amount) return { label: `Not enough USDC on ${chain.network}` };
		return { label: `Renew for ${fmtUsdcExact(amount)}`, action: () => void renew() };
	})();
	const newExpiry = quote && expiry ? Date.parse(expiry) + Number(quote.secondsAdded) * 1000 : null;
	const short = balance !== null && amount !== null && balance < amount;

	return (
		<>
			<div className="mt-8 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-ink-primary">Renew a name</h1>
					<p className="mt-3 text-ink-secondary">Add time to any ENS name with USDC. You don't need to own it.</p>
				</div>
			</div>

			<section className="site-panel mt-8 rounded-[16px] bg-white p-5 md:p-6" aria-busy={paying}>
				<div className="flex items-center justify-between gap-3">
					<label htmlFor="renew-name" className="text-[13px] font-medium text-ink-secondary">ENS name</label>
					{account && (
						<span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--site-subtle)] px-2.5 py-1 text-[12px] text-ink-secondary">
							<WalletIcon className="h-3.5 w-3.5" aria-hidden="true" />
							{truncAddress(account)}
							<button type="button" className="ml-1 underline" disabled={paying} onClick={() => { setAccount(null); setProvider(null); setBalance(null); }}>Disconnect</button>
						</span>
					)}
				</div>
				<div className="mt-2 flex h-12 items-center rounded-[10px] border border-[rgba(28,58,41,0.16)] bg-white px-3 focus-within:border-[var(--site-action)]">
					<input
						id="renew-name"
						className="h-full min-w-0 flex-1 bg-transparent text-[18px] outline-none focus-visible:!outline-none"
						placeholder="vitalik"
						autoComplete="off"
						spellCheck={false}
						value={nameInput}
						disabled={paying}
						onChange={(e) => setNameInput(e.target.value)}
					/>
					<span className="text-[18px] text-ink-secondary">.eth</span>
				</div>
				<p className="mt-1.5 min-h-[20px] text-[13px]">
					{nameIssue ? <span className="text-red-700">{nameIssue}</span>
						: quoteError ? <span className="text-red-700">{quoteError}</span>
						: expiry ? <span className="text-ink-secondary">Expires {fmtDate(Date.parse(expiry))}</span>
						: null}
				</p>

				<p className="mt-4 text-[13px] font-medium text-ink-secondary">Pay from</p>
				<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Network">
					{FUNDING_CHAINS.map((c) => (
						<button
							key={c.chainId}
							type="button"
							role="radio"
							aria-checked={c.chainId === chainId}
							disabled={paying}
							onClick={() => setChainId(c.chainId)}
							className={`flex h-11 items-center gap-2 rounded-[10px] border px-3 text-[14px] transition-colors ${c.chainId === chainId ? "border-[var(--site-action)] bg-[var(--site-selected)] text-ink-primary" : "border-[rgba(28,58,41,0.16)] bg-white text-ink-secondary hover:border-[rgba(28,58,41,0.32)]"}`}
						>
							<img src={`${import.meta.env.BASE_URL}logos/${c.logo}`} alt="" className="h-5 w-5" />
							{c.name}
						</button>
					))}
				</div>

				<div className="mt-4 flex items-center justify-between">
					<label htmlFor="renew-amount" className="text-[13px] font-medium text-ink-secondary">Amount</label>
					{balance !== null && (
						<span className={`text-[12px] ${short ? "text-red-700" : "text-ink-secondary"}`}>
							Balance {fmtUsdcExact(balance)}
						</span>
					)}
				</div>
				<div className="mt-2 flex gap-2">
					<div className="flex h-12 min-w-0 flex-1 items-center rounded-[10px] border border-[rgba(28,58,41,0.16)] bg-white px-3 focus-within:border-[var(--site-action)]">
						<span className="text-[18px] text-ink-secondary">$</span>
						<input
							id="renew-amount"
							className="h-full min-w-0 flex-1 bg-transparent pl-1 text-[18px] outline-none focus-visible:!outline-none"
							inputMode="decimal"
							autoComplete="off"
							value={amountInput}
							disabled={paying}
							onChange={(e) => setAmountInput(e.target.value.replace(/^\$/, ""))}
						/>
						<span className="text-[14px] text-ink-secondary">USDC</span>
					</div>
					{PRESETS.map((p) => (
						<button
							key={p}
							type="button"
							disabled={paying}
							onClick={() => setAmountInput(p)}
							className={`hidden h-12 rounded-[10px] border px-3 text-[14px] sm:block ${amountInput === p ? "border-[var(--site-action)] bg-[var(--site-selected)]" : "border-[rgba(28,58,41,0.16)] bg-white text-ink-secondary"}`}
						>
							${p}
						</button>
					))}
				</div>
				{amountInput && amount === null && <p className="mt-1.5 text-[13px] text-red-700">Enter an amount like 5 or 2.50.</p>}

				<div className="mt-5 rounded-[12px] bg-[var(--site-subtle)] p-4 text-[14px]">
					<div className="flex items-center justify-between">
						<span className="text-ink-secondary">Adds</span>
						<span className="font-medium text-ink-primary">
							{quote ? fmtDurationPrecise(BigInt(quote.secondsAdded)) : quoting ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Getting price" /> : "—"}
						</span>
					</div>
					{newExpiry !== null && (
						<div className="mt-2 flex items-center justify-between">
							<span className="text-ink-secondary">New expiry</span>
							<span className="text-ink-primary">about {fmtDate(newExpiry)}</span>
						</div>
					)}
					{quote && (
						<div className="mt-2 flex items-center justify-between">
							<span className="text-ink-secondary">Network fee</span>
							<span className="text-ink-primary">{fmtUsdcExact(BigInt(quote.renewalFee) + BigInt(quote.bridgeFee))}</span>
						</div>
					)}
				</div>

				<button
					type="button"
					className="primary-action mt-5 inline-flex !h-12 w-full items-center justify-center gap-2 text-[15px] disabled:opacity-60"
					disabled={!button.action}
					onClick={button.action}
				>
					{button.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
					{button.label}
				</button>

				{choosing && (
					<div className="mt-3 grid gap-2">
						{wallets.map((w) => (
							<button key={w.info.uuid} type="button" onClick={() => void connect(w)} className="flex h-11 items-center gap-3 rounded-[10px] border border-[rgba(28,58,41,0.16)] bg-white px-3 text-[14px] hover:bg-[var(--site-subtle)]">
								{w.info.icon ? <img src={w.info.icon} alt="" className="h-5 w-5" /> : <WalletIcon className="h-5 w-5" aria-hidden="true" />}
								{w.info.name}
							</button>
						))}
					</div>
				)}

				{notice && <p role="alert" className="mt-3 text-[13px] text-red-700">{notice}</p>}
				{short && (
					<p className="mt-3 text-[13px] text-ink-secondary">
						Need testnet USDC? <a href={FAUCET} target="_blank" rel="noreferrer" className="text-ink-action underline">Get some from Circle's faucet</a>.
					</p>
				)}
				{name && label && (
					<p className="mt-4 text-[12px] leading-5 text-ink-secondary">
						Your USDC goes to {name}'s Namepass deposit address <span className="break-all font-mono">{depositAddress(label)}</span>. Testnet USDC only.
					</p>
				)}
			</section>
		</>
	);
}

function Progress({ phase, notice, onStartOver }: {
	phase: Extract<Phase, { kind: "tracking" | "done" | "failed" }>;
	notice: string | null;
	onStartOver: () => void;
}) {
	const { payment } = phase;
	const source = chainById(payment.chainId)!;
	const viaHub = payment.chainId === HUB_CHAIN.chainId;
	const status = phase.kind === "failed" ? null : phase.status;
	const value = status?.status;
	const renewals = phase.kind === "done" ? phase.status.deposits.flatMap((d) => d.renewals ?? []) : [];
	const unique = [...new Map(renewals.map((r) => [r.renewalId, r])).values()];
	const added = unique.reduce((sum, r) => sum + BigInt(r.secondsAdded), 0n);
	const latest = unique.map((r) => Date.parse(r.expiry)).sort((a, b) => b - a)[0];

	if (phase.kind === "done") {
		return (
			<section className="site-panel mt-8 rounded-[16px] bg-white p-6 text-center md:p-8">
				<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--site-selected)]">
					<Check className="h-7 w-7 text-ink-action" aria-hidden="true" />
				</div>
				<h1 className="mt-5 text-ink-primary">{payment.name} is renewed</h1>
				<p className="mt-3 text-ink-secondary">
					Added {fmtDurationPrecise(added || BigInt(payment.secondsAdded))}
					{latest ? <>. It now expires on <strong className="text-ink-primary">{fmtDate(latest)}</strong>.</> : "."}
				</p>
				<div className="mt-5 flex flex-wrap justify-center gap-4 text-[14px]">
					<a className="inline-flex items-center gap-1 text-ink-action underline" href={txUrl(payment.chainId, payment.transactionHash)} target="_blank" rel="noreferrer">
						Payment <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
					</a>
					{unique.map((r) => (
						<a key={r.renewalId} className="inline-flex items-center gap-1 text-ink-action underline" href={txUrl(r.chainId, r.transactionHash)} target="_blank" rel="noreferrer">
							Renewal <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
						</a>
					))}
				</div>
				<button type="button" className="primary-action mt-7 inline-flex !h-12 w-full items-center justify-center text-[15px]" onClick={onStartOver}>
					Renew another name
				</button>
			</section>
		);
	}

	if (phase.kind === "failed") {
		return (
			<section className="site-panel mt-8 rounded-[16px] bg-white p-6 md:p-8">
				<h1 className="text-ink-primary">Something went wrong</h1>
				<p className="mt-3 text-ink-secondary">
					Namepass couldn't verify this payment. Check the{" "}
					<a className="text-ink-action underline" href={txUrl(payment.chainId, payment.transactionHash)} target="_blank" rel="noreferrer">transaction</a>{" "}
					before trying again.
				</p>
				<button type="button" className="primary-action mt-6 inline-flex !h-12 w-full items-center justify-center text-[15px]" onClick={onStartOver}>Start over</button>
			</section>
		);
	}

	const steps: { label: string; state: "done" | "active" | "waiting" }[] = [
		{ label: `Payment sent from ${source.network}`, state: "done" },
		{ label: "Payment received by Namepass", state: value ? "done" : "active" },
		{ label: viaHub ? "Renewing on ENS" : `Moving USDC from ${source.name} to Ethereum`, state: value ? "active" : "waiting" },
		{ label: `${payment.name} renewed`, state: "waiting" },
	];
	const eta = viaHub ? "This usually takes about a minute." : source.key === "arc" ? "This usually takes a minute or two." : "This usually takes about 20 minutes while Circle confirms the transfer.";

	return (
		<section className="site-panel mt-8 rounded-[16px] bg-white p-6 md:p-8">
			<h1 className="text-ink-primary">Renewing {payment.name}</h1>
			<p className="mt-3 text-ink-secondary">
				{fmtUsdcExact(BigInt(payment.amount))} adds about {fmtDurationPrecise(BigInt(payment.secondsAdded))}. {eta} You can close this page and come back.
			</p>
			<ol className="mt-6 grid gap-4">
				{steps.map((step) => (
					<li key={step.label} className="flex items-center gap-3 text-[15px]">
						<span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${step.state === "done" ? "bg-[var(--site-action)] text-white" : step.state === "active" ? "bg-[var(--site-selected)] text-ink-action" : "border border-[rgba(28,58,41,0.16)]"}`}>
							{step.state === "done" ? <Check className="h-4 w-4" aria-hidden="true" /> : step.state === "active" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
						</span>
						<span className={step.state === "waiting" ? "text-ink-secondary" : "text-ink-primary"}>{step.label}</span>
					</li>
				))}
			</ol>
			<a className="mt-6 inline-flex items-center gap-1 text-[14px] text-ink-action underline" href={txUrl(payment.chainId, payment.transactionHash)} target="_blank" rel="noreferrer">
				View payment <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
			</a>
			{notice && <p role="alert" className="mt-4 text-[13px] text-red-700">{notice}</p>}
		</section>
	);
}
