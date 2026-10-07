import { Check, ChevronDown, Copy } from "lucide-react";
import { useId, useState } from "react";
import { useCopyFeedback } from "../hooks/use-copy-feedback";
import type { PublicActivityDeposit } from "../lib/publicApi";
import { fmtUsdcExact } from "../lib/format";

export function CopyableAddress({ address, label }: { address: string; label: string }) {
	const { copied: copiedValue, error, copy } = useCopyFeedback();
	const copied = copiedValue === address;
	const copyable = /^0x[a-f\d]{40}$/i.test(address);

	return (
		<span className="site-evidence-address">
			<span className={copyable ? "site-evidence-address-value" : "site-evidence-unavailable"}>
				{address}
				<span role="status" className="sr-only">{copied ? "Copied to clipboard" : ""}</span>
				{error && <span role="alert" className="mt-1 block font-sans text-red-700">{error.message}</span>}
			</span>
			{copyable && (
				<button
					type="button"
					onClick={() => void copy(address)}
					aria-label={copied ? `${label} address copied` : `Copy ${label} address`}
					title={copied ? "Copied" : `Copy ${label} address`}
					className="site-data-copy inline-flex items-center justify-center transition-colors hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]"
				>
					{copied ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
				</button>
			)}
		</span>
	);
}


/** Contributions are grouped by sender, never by shared transaction hash. */
export default function FundingSources({ deposits, fallback }: { deposits?: PublicActivityDeposit[] | null; fallback: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!deposits?.length) return <CopyableAddress address={fallback} label="funded by" />;
  const wallets = new Map<string | null, { address: string | null; amount: bigint }>();
  for (const deposit of deposits) {
    const key = deposit.senderAddress?.toLowerCase() ?? null;
    const wallet = wallets.get(key) ?? { address: deposit.senderAddress, amount: 0n };
    wallet.amount += BigInt(deposit.amount);
    wallets.set(key, wallet);
  }
  const sources = [...wallets.values()];
  if (sources.length === 1) return sources[0].address
    ? <CopyableAddress address={sources[0].address} label="funded by" />
    : <span className="text-[12px] text-ink-secondary">Sender unavailable</span>;
  const many = sources.length > 3;
  const knownWallets = sources.filter(wallet => wallet.address !== null).length;
  return <div className="min-w-0">
    {many && <button type="button" className="site-deposit-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}>
      <span className="text-[12px] text-ink-primary">{knownWallets} {knownWallets === 1 ? "wallet" : "wallets"}{wallets.has(null) ? " + unknown sender" : ""}</span>
      <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-ink-secondary transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>}
    {(!many || expanded) && <ol id={id} className="site-funding-sources site-scrollable-evidence" aria-label="Funding sources" tabIndex={many ? 0 : undefined}>
    {sources.map((wallet, index) => <li key={wallet.address?.toLowerCase() ?? "unknown"}>
      {wallet.address ? <CopyableAddress address={wallet.address} label={`funding wallet ${index + 1}`} />
        : <span className="site-funding-unknown">Sender unavailable</span>}
      <span className="site-funding-amount">{fmtUsdcExact(wallet.amount)} <span className="text-ink-secondary">USDC</span></span>
    </li>)}
    </ol>}
  </div>;
}
