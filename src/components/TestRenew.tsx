import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { BackButton } from "./BackButton";
import { ACTIVE_CHAINS, IS_TESTNET, chainById } from "../lib/chains";
import { fmtDurationPrecise, fmtUsdcExact } from "../lib/format";
import { depositAddress, labelProblem, LABEL_PROBLEM_TEXT, normalizeLabel } from "../lib/namepass";
import {
	creditLogIndex,
	parseUsdc,
	pollStatus,
	v1,
	V1Error,
	type AddressResponse,
	type HistoryResponse,
	type QuoteResponse,
	type StatusResponse,
} from "../lib/renewalTest";

/**
 * `/test`: renew a name end to end through the public API with a browser wallet.
 *
 * The page does what an integrator does. `POST /api/v1/address` activates the
 * name and returns its deposit address and funding chains. `POST /api/v1/quote`
 * prices the chosen amount. The wallet signs one USDC transfer. `GET
 * /api/v1/status/{chainId}` is polled until the renewal is verified, and `GET
 * /api/v1/names/{name}/renewals` shows the resulting history. The page holds no
 * key and calls no internal endpoint. It is not linked from navigation and only
 * renders on the testnet deployment.
 *
 * Before any signature it checks the API's answers against this build: the
 * deposit address must equal the local derivation and each token address must
 * equal the chain registry's USDC.
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
const STORAGE_KEY = "namepass-test-renewal";

type ProviderInfo = { uuid: string; name: string };
type Wallet = { info: ProviderInfo; provider: EIP1193Provider };
type SentTransfer = { chainId: string; transactionHash: Hex; name: string; logIndex: number | null };

function readSaved(): SentTransfer | null {
	try {
		const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as SentTransfer | null;
		return value && /^0x[0-9a-fA-F]{64}$/.test(value.transactionHash) ? value : null;
	} catch {
		return null;
	}
}
function writeSaved(value: SentTransfer) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// Storage is a convenience; the transaction hash is also shown on the page.
	}
}

const message = (error: unknown) =>
	error instanceof V1Error
		? `${error.message} (${error.status} ${error.code})`
		: error instanceof Error
			? (error as { shortMessage?: string }).shortMessage ?? error.message
			: String(error);

export default function TestRenew({ onBack }: { onBack: () => void }) {
	if (!IS_TESTNET) {
		return (
			<div className="w-full px-5 md:px-10 pt-4 pb-20">
				<div className="max-w-[760px] mx-auto">
					<BackButton onClick={onBack} label="Back to Namepass" />
					<h1 className="mt-8 text-ink-primary">Test renewal</h1>
					<p className="mt-4 text-ink-secondary">The test renewal page is only available on the testnet deployment.</p>
				</div>
			</div>
		);
	}
	return <TestRenewTestnet onBack={onBack} />;
}

function TestRenewTestnet({ onBack }: { onBack: () => void }) {
	/* Wallet */
	const [wallets, setWallets] = useState<Wallet[]>([]);
	const [provider, setProvider] = useState<EIP1193Provider | null>(null);
	const [account, setAccount] = useState<Address | null>(null);
	const [walletChainId, setWalletChainId] = useState<number | null>(null);

	/* Inputs and API state */
	const [nameInput, setNameInput] = useState("");
	const [amountInput, setAmountInput] = useState("1");
	const [chainId, setChainId] = useState<string>(String(ACTIVE_CHAINS[0]?.chainId ?? ""));
	const [address, setAddress] = useState<AddressResponse | null>(null);
	const [quote, setQuote] = useState<QuoteResponse | null>(null);
	const [balance, setBalance] = useState<bigint | null>(null);
	const [sent, setSent] = useState<SentTransfer | null>(() => readSaved());
	const [status, setStatus] = useState<StatusResponse | null>(null);
	const [waiting, setWaiting] = useState<string | null>(null);
	const [history, setHistory] = useState<HistoryResponse | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const polling = useRef<AbortController | null>(null);

	const label = useMemo(() => {
		try {
			return normalizeLabel(nameInput);
		} catch {
			return null;
		}
	}, [nameInput]);
	const amount = parseUsdc(amountInput);
	const selectedChain = address?.chains.find((c) => c.chainId === chainId) ?? null;
	const belowMinimum = selectedChain && amount !== null && amount < BigInt(selectedChain.minimumAmount);

	useEffect(() => {
		document.title = "Test renewal · Namepass";
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
		const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
		const fallback = setTimeout(() => {
			if (injected) setWallets((list) => (list.length ? list : [{ info: { uuid: "injected", name: "Browser wallet" }, provider: injected }]));
		}, 400);
		return () => {
			window.removeEventListener("eip6963:announceProvider", announce);
			clearTimeout(fallback);
			robots.remove();
			polling.current?.abort();
		};
	}, []);

	/* Wallet-provider event subscriptions follow the connected provider. */
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

	const run = useCallback(async (label: string, action: () => Promise<void>) => {
		setBusy(label);
		setError(null);
		try {
			await action();
		} catch (cause) {
			if ((cause as { name?: string })?.name !== "AbortError") setError(message(cause));
		} finally {
			setBusy(null);
		}
	}, []);

	const connect = (wallet: Wallet) =>
		run("Connecting wallet…", async () => {
			const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
			if (!accounts[0]) throw new Error("No wallet account was selected.");
			setProvider(wallet.provider);
			setAccount(getAddress(accounts[0]));
			setWalletChainId(Number(await wallet.provider.request({ method: "eth_chainId" })));
		});

	const lookUp = () =>
		run("Requesting the deposit address…", async () => {
			if (!label) throw new Error("Enter a valid ENS name.");
			setAddress(null);
			setQuote(null);
			setBalance(null);
			const response = await v1.address(`${label}.eth`);
			/* The API's answer must agree with this build before anyone pays it. */
			const local = depositAddress(label);
			if (getAddress(response.depositAddress) !== getAddress(local))
				throw new Error(`The API returned ${response.depositAddress}, but this build derives ${local}. Do not fund either.`);
			for (const chain of response.chains) {
				const registry = chainById(Number(chain.chainId));
				if (!registry || getAddress(registry.usdcAddress) !== getAddress(chain.tokenAddress))
					throw new Error(`The API's token for chain ${chain.chainId} does not match this build's USDC.`);
			}
			setAddress(response);
			if (!response.chains.some((c) => c.chainId === chainId) && response.chains[0]) setChainId(response.chains[0].chainId);
		});

	const getQuote = () =>
		run("Requesting a quote…", async () => {
			if (!address || amount === null) throw new Error("Look up the name and enter an amount first.");
			setQuote(null);
			setQuote(await v1.quote(address.name, chainId, amount.toString()));
		});

	const switchChain = async (target: number) => {
		if (!provider) throw new Error("Connect a wallet first.");
		const hex = `0x${target.toString(16)}`;
		try {
			await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
		} catch (cause) {
			if ((cause as { code?: number }).code !== 4902) throw cause;
			const chain = WALLET_CHAINS[target];
			await provider.request({
				method: "wallet_addEthereumChain",
				params: [{
					chainId: hex,
					chainName: chain.name,
					nativeCurrency: chain.nativeCurrency,
					rpcUrls: [...chain.rpcUrls.default.http],
					blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
				}],
			});
		}
		const now = Number(await provider.request({ method: "eth_chainId" }));
		setWalletChainId(now);
		if (now !== target) throw new Error(`Switch the wallet to chain ${target}.`);
	};

	const clients = (target: number) => {
		const chain = WALLET_CHAINS[target];
		if (!provider || !chain) throw new Error("Connect a wallet first.");
		return {
			reads: createPublicClient({ chain, transport: custom(provider) }),
			writes: createWalletClient({ chain, transport: custom(provider) }),
		};
	};

	const checkBalance = () =>
		run("Reading the wallet's USDC balance…", async () => {
			if (!account || !selectedChain) throw new Error("Connect a wallet and look up a name first.");
			const target = Number(selectedChain.chainId);
			await switchChain(target);
			const { reads } = clients(target);
			setBalance(await reads.readContract({ address: getAddress(selectedChain.tokenAddress), abi: ERC20, functionName: "balanceOf", args: [account] }));
		});

	const startPolling = useCallback((transfer: SentTransfer) => {
		polling.current?.abort();
		const controller = new AbortController();
		polling.current = controller;
		setStatus(null);
		setWaiting("Waiting for the first status response…");
		setHistory(null);
		pollStatus(
			transfer.chainId,
			transfer.transactionHash,
			(update) => {
				if ("status" in update) {
					setStatus(update.status);
					setWaiting(null);
				} else setWaiting(update.waiting);
			},
			controller.signal,
		)
			.then(async (final) => {
				setWaiting(null);
				if (final.status === "complete") setHistory(await v1.renewals(transfer.name, controller.signal));
			})
			.catch((cause) => {
				if (!controller.signal.aborted) setError(message(cause));
			});
	}, []);

	const send = () =>
		run("Sending the USDC transfer…", async () => {
			if (!account || !address || !selectedChain || amount === null || !quote) throw new Error("Complete the steps above first.");
			if (belowMinimum) throw new Error("The amount is below the chain's minimum.");
			if (quote.chainId !== chainId || quote.amount !== amount.toString()) throw new Error("Request a new quote for this chain and amount.");
			const target = Number(selectedChain.chainId);
			await switchChain(target);
			const { reads, writes } = clients(target);
			const token = getAddress(selectedChain.tokenAddress);
			const to = getAddress(address.depositAddress);
			const held = await reads.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account] });
			setBalance(held);
			if (held < amount) throw new Error(`The wallet holds ${fmtUsdcExact(held)} USDC on this chain; the transfer needs ${fmtUsdcExact(amount)}.`);
			const data = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, amount] });
			/* Arc prices gas in USDC with legacy fees. */
			const fees = target === arcTestnet.id ? { type: "legacy" as const, gasPrice: await reads.getGasPrice() } : {};
			const gas = await reads.estimateGas({ account, to: token, data, ...fees });
			setBusy("Waiting for your wallet signature…");
			const transactionHash = await writes.sendTransaction({ account, to: token, data, gas: (gas * 12n) / 10n, ...fees });
			const transfer: SentTransfer = { chainId: selectedChain.chainId, transactionHash, name: address.name, logIndex: null };
			setSent(transfer);
			writeSaved(transfer);
			setBusy("Waiting for the transfer receipt…");
			const receipt = await reads.waitForTransactionReceipt({ hash: transactionHash, timeout: 180_000 });
			if (receipt.status !== "success") throw new Error("The transfer reverted.");
			const logIndex = creditLogIndex(receipt.logs, { token, to, amount });
			if (logIndex === null) throw new Error("The receipt does not contain exactly one matching USDC credit to the deposit address.");
			const confirmed = { ...transfer, logIndex };
			setSent(confirmed);
			writeSaved(confirmed);
			startPolling(confirmed);
		});

	const resume = () => {
		if (sent) startPolling(sent);
	};

	const nameError = nameInput.trim() && !label ? LABEL_PROBLEM_TEXT[labelProblem(nameInput) ?? "not-normalizable"] : null;
	const explorer = (id: string) => chainById(Number(id))?.explorerUrl ?? "";

	return (
		<div className="w-full px-5 md:px-10 pt-4 pb-20 md:pb-28">
			<div className="max-w-[760px] mx-auto">
				<BackButton onClick={onBack} label="Back to Namepass" />
				<h1 className="mt-8 text-ink-primary">Test renewal</h1>
				<p className="mt-4 text-ink-secondary">
					Renew a testnet ENS name through the public API with your browser wallet. Testnet USDC only.
				</p>

				{error && <p role="alert" className="mt-6 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-800">{error}</p>}
				{busy && <p role="status" className="mt-6 text-[14px] text-ink-secondary">{busy}</p>}

				<Step n={1} title="Connect a wallet">
					{account ? (
						<p className="text-[14px] text-ink-secondary">
							<code className="break-all">{account}</code> on {chainById(walletChainId ?? 0)?.network ?? `chain ${walletChainId}`}
						</p>
					) : wallets.length ? (
						<div className="flex flex-wrap gap-2">
							{wallets.map((w) => (
								<button key={w.info.uuid} type="button" className="primary-action inline-flex items-center" disabled={!!busy} onClick={() => void connect(w)}>
									Connect {w.info.name}
								</button>
							))}
						</div>
					) : (
						<p className="text-[14px] text-ink-secondary">No browser wallet found. Install or unlock one and reload.</p>
					)}
				</Step>

				<Step n={2} title="Get the deposit address" api="POST /api/v1/address">
					<div className="flex flex-col sm:flex-row gap-2">
						<input
							aria-label="ENS name"
							className="h-[38px] flex-1 rounded-[6px] border border-[rgba(28,58,41,0.16)] bg-white px-3 text-[14px]"
							placeholder="name.eth"
							value={nameInput}
							onChange={(e) => {
								setNameInput(e.target.value);
								setAddress(null);
								setQuote(null);
							}}
						/>
						<button type="button" className="primary-action inline-flex items-center justify-center" disabled={!label || !!busy} onClick={() => void lookUp()}>
							Get address
						</button>
					</div>
					{nameError && <p className="mt-2 text-[13px] text-red-700">{nameError}</p>}
					{address && (
						<dl className="mt-4 grid gap-2 text-[14px]">
							<Row term="Name">{address.name}</Row>
							<Row term="Deposit address"><code className="break-all">{address.depositAddress}</code></Row>
							<Row term="Subname">{address.subname} {address.subnameVerified ? "(verified)" : "(unverified: use the full address)"}</Row>
							<Row term="Checks">Deposit address matches this build's derivation; token addresses match the chain registry.</Row>
						</dl>
					)}
				</Step>

				<Step n={3} title="Quote the renewal" api="POST /api/v1/quote">
					<div className="flex flex-col sm:flex-row gap-2">
						<select
							aria-label="Funding chain"
							className="h-[38px] rounded-[6px] border border-[rgba(28,58,41,0.16)] bg-white px-3 text-[14px]"
							value={chainId}
							disabled={!address}
							onChange={(e) => {
								setChainId(e.target.value);
								setQuote(null);
								setBalance(null);
							}}
						>
							{(address?.chains ?? ACTIVE_CHAINS.map((c) => ({ chainId: String(c.chainId), name: c.network }))).map((c) => (
								<option key={c.chainId} value={c.chainId}>{c.name}</option>
							))}
						</select>
						<input
							aria-label="Amount in USDC"
							className="h-[38px] w-full sm:w-36 rounded-[6px] border border-[rgba(28,58,41,0.16)] bg-white px-3 text-[14px]"
							inputMode="decimal"
							value={amountInput}
							onChange={(e) => {
								setAmountInput(e.target.value);
								setQuote(null);
							}}
						/>
						<button type="button" className="primary-action inline-flex items-center justify-center" disabled={!address || amount === null || !!busy} onClick={() => void getQuote()}>
							Get quote
						</button>
					</div>
					{amountInput && amount === null && <p className="mt-2 text-[13px] text-red-700">Enter a USDC amount with at most six decimal places.</p>}
					{selectedChain && <p className="mt-2 text-[13px] text-ink-secondary">Minimum on {selectedChain.name}: {fmtUsdcExact(BigInt(selectedChain.minimumAmount))} USDC.</p>}
					{belowMinimum && <p className="mt-1 text-[13px] text-red-700">The amount is below the minimum; the deposit would wait for more funds.</p>}
					{quote && (
						<dl className="mt-4 grid gap-2 text-[14px]">
							<Row term="Adds">{fmtDurationPrecise(BigInt(quote.secondsAdded))} ({quote.secondsAdded} seconds)</Row>
							<Row term="Applied to ENS">{fmtUsdcExact(BigInt(quote.amountApplied))} USDC</Row>
							<Row term="Renewal fee">{fmtUsdcExact(BigInt(quote.renewalFee))} USDC</Row>
							<Row term="Bridge fee">{fmtUsdcExact(BigInt(quote.bridgeFee))} USDC</Row>
							<Row term="Rounding remainder">{fmtUsdcExact(BigInt(quote.roundingRemainder))} USDC</Row>
							<Row term="Priced at">Sepolia block {quote.pricingBlock}; estimate valid until {new Date(quote.expiresAt).toLocaleTimeString()}</Row>
						</dl>
					)}
				</Step>

				<Step n={4} title="Send USDC from the wallet">
					<p className="text-[14px] text-ink-secondary">
						The wallet signs one <code>transfer</code> of {amount !== null ? fmtUsdcExact(amount) : "—"} USDC
						{selectedChain ? <> on {selectedChain.name} from token <code className="break-all">{selectedChain.tokenAddress}</code></> : null}
						{address ? <> to <code className="break-all">{address.depositAddress}</code></> : null}.
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						<button type="button" className="inline-flex h-[38px] items-center rounded-[6px] border border-[rgba(28,58,41,0.16)] bg-white px-3 text-[14px]" disabled={!account || !selectedChain || !!busy} onClick={() => void checkBalance()}>
							Check balance
						</button>
						<button type="button" className="primary-action inline-flex items-center" disabled={!account || !quote || !!belowMinimum || !!busy} onClick={() => void send()}>
							Send transfer
						</button>
					</div>
					{balance !== null && <p className="mt-2 text-[13px] text-ink-secondary">Wallet balance: {fmtUsdcExact(balance)} USDC.</p>}
					{sent && (
						<dl className="mt-4 grid gap-2 text-[14px]">
							<Row term="Transaction">
								<a className="break-all text-ink-action underline" href={`${explorer(sent.chainId)}/tx/${sent.transactionHash}`} target="_blank" rel="noreferrer">{sent.transactionHash}</a>
							</Row>
							<Row term="Credit">{sent.logIndex === null ? "Receipt not checked yet" : `Log index ${sent.logIndex} on ${chainById(Number(sent.chainId))?.network}`}</Row>
						</dl>
					)}
				</Step>

				<Step n={5} title="Track the renewal" api="GET /api/v1/status/{chainId}">
					{sent ? (
						<button type="button" className="inline-flex h-[38px] items-center rounded-[6px] border border-[rgba(28,58,41,0.16)] bg-white px-3 text-[14px]" disabled={!!busy} onClick={resume}>
							{status || waiting ? "Restart polling" : "Track the last transfer"}
						</button>
					) : (
						<p className="text-[14px] text-ink-secondary">Status polling starts after the transfer receipt.</p>
					)}
					{waiting && <p className="mt-2 text-[13px] text-ink-secondary">{waiting} Polling every five seconds.</p>}
					{status && (
						<div className="mt-4 text-[14px]">
							<p>Status: <strong>{status.status}</strong></p>
							{status.deposits.map((d) => (
								<div key={`${d.depositAddress}:${d.logIndex}`} className="mt-3 inset-panel rounded-[10px] p-3">
									<p>{d.name}: {fmtUsdcExact(BigInt(d.amount))} USDC, log {d.logIndex ?? "native"}, {d.status}{d.reason ? ` (${d.reason})` : ""}</p>
									{d.renewals?.map((r) => (
										<p key={r.renewalId} className="mt-1 text-ink-secondary">
											Renewed +{fmtDurationPrecise(BigInt(r.secondsAdded))}, expiry {new Date(r.expiry).toUTCString()},{" "}
											<a className="text-ink-action underline" href={`${explorer(r.chainId)}/tx/${r.transactionHash}`} target="_blank" rel="noreferrer">renewal transaction</a>
										</p>
									))}
								</div>
							))}
						</div>
					)}
				</Step>

				<Step n={6} title="Name history" api="GET /api/v1/names/{name}/renewals">
					<button
						type="button"
						className="inline-flex h-[38px] items-center rounded-[6px] border border-[rgba(28,58,41,0.16)] bg-white px-3 text-[14px]"
						disabled={!(address?.name ?? sent?.name) || !!busy}
						onClick={() => void run("Reading the renewal history…", async () => setHistory(await v1.renewals((address?.name ?? sent?.name)!)))}
					>
						Load history
					</button>
					{history && (
						<div className="mt-4 text-[14px]">
							<p>Current expiry: {history.currentExpiry ? new Date(history.currentExpiry).toUTCString() : "unknown"}</p>
							<ul className="mt-2 grid gap-1">
								{history.items.map((item) => (
									<li key={item.renewalId} className="text-ink-secondary">
										{item.renewedAt ? new Date(item.renewedAt).toLocaleString() : "—"}: +{fmtDurationPrecise(BigInt(item.secondsAdded))} from {chainById(Number(item.sourceChainId))?.network ?? item.sourceChainId}, {item.status}
									</li>
								))}
								{!history.items.length && <li className="text-ink-secondary">No renewals recorded.</li>}
							</ul>
						</div>
					)}
				</Step>
			</div>
		</div>
	);
}

function Step({ n, title, api, children }: { n: number; title: string; api?: string; children: ReactNode }) {
	return (
		<section className="site-panel mt-6 rounded-[12px] bg-white p-5 md:p-6">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-[18px] leading-7 text-ink-primary">{n}. {title}</h2>
				{api && <code className="text-[12px] text-ink-secondary">{api}</code>}
			</div>
			<div className="mt-3">{children}</div>
		</section>
	);
}

function Row({ term, children }: { term: string; children: ReactNode }) {
	return (
		<div className="grid gap-1 sm:grid-cols-[150px_1fr]">
			<dt className="text-ink-secondary">{term}</dt>
			<dd className="min-w-0 text-ink-primary">{children}</dd>
		</div>
	);
}
