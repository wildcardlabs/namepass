import { useMemo } from "react";
import { ArrowUpRight, Check, Copy, QrCode } from "lucide-react";
import { normalizeLabel } from "../lib/namepass";
import { encodeQR } from "../lib/qr";
import { useCopyFeedback } from "../hooks/use-copy-feedback";
import { FUNDING_CHAINS } from "../lib/chains";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

const DISPLAY_NETWORKS = [...FUNDING_CHAINS].sort(
	(a, b) => Number(b.key === "ethereum") - Number(a.key === "ethereum"),
);

interface Props {
	name: string;
	address: string;
	/** Keep exact token contracts accessible before someone sends a payment. */
	onSupportedTokens: () => void;
}

/** Funding panel with a full deposit address, copy actions and a QR dialog. */
export default function PassCard({ name, address, onSupportedTokens }: Props) {
	const { copied, error, copy } = useCopyFeedback();
	const subdomain = `${normalizeLabel(name)}.namepass.eth`;
	const matrix = useMemo(() => {
		try {
			return encodeQR(address);
		} catch {
			return null;
		}
	}, [address]);

	return (
		<Card className="site-deposit-details" role="region" aria-label="Renewal funding destination">
			<div className="site-pass-header">
				<h4 className="site-detail-section-title">Send USDC to renew</h4>
			</div>
			<p className="site-deposit-instruction">Renew <span>{name}</span> by sending USDC to the address below.</p>
			<dl className="site-deposit-fields">
				<div className="site-deposit-destination">
					<dt>Universal deposit address</dt>
					<dd className="site-deposit-address">
						<span>{address}</span>
						<div className="site-deposit-actions">
							<Button className="site-deposit-copy-action" onClick={() => void copy(address)} aria-label={`Copy deposit address ${address}`} title="Copy deposit address">
								{copied === address ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
								{copied === address ? "Copied" : "Copy address"}
							</Button>
							<Dialog>
								<DialogTrigger asChild>
									<Button variant="outline" className="site-deposit-qr-action" aria-label="Show deposit address QR code" title="Show QR code" disabled={!matrix}>
										<QrCode aria-hidden="true" />Show QR
									</Button>
								</DialogTrigger>
								<DialogContent className="site-qr-dialog">
									<DialogTitle>Universal deposit address</DialogTitle>
									<DialogDescription>Send USDC on a supported network to renew {name}.</DialogDescription>
									{matrix && <svg viewBox={`0 0 ${matrix.length} ${matrix.length}`} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${address}`}>
										<path fill="#171717" d={matrix.flatMap((row, r) => row.flatMap((on, c) => on ? [`M${c} ${r}h1v1h-1z`] : [])).join("")} />
									</svg>}
									<p className="site-qr-address">{address}</p>
								</DialogContent>
							</Dialog>
						</div>
					</dd>
				</div>
				<div className="site-deposit-identity">
					<dt>Readable deposit name</dt>
					<dd>
						<span>{subdomain}</span>
						<Button variant="ghost" size="icon" className="site-data-copy" onClick={() => void copy(subdomain)} aria-label={`Copy ${subdomain}`} title="Copy deposit name">
							{copied === subdomain ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
						</Button>
					</dd>
				</div>
			</dl>
			<p role="status" className="sr-only">{copied ? "Copied to clipboard" : ""}</p>
			{error && <p role="alert" className="mt-2 text-[12px] text-red-700">{error.message}</p>}
			<div className="site-deposit-networks">
				<div className="site-deposit-network-heading">
					<div className="site-deposit-token"><img src={`${import.meta.env.BASE_URL}logos/usdc.svg`} alt="" />USDC accepted</div>
					<button type="button" onClick={onSupportedTokens} className="site-contract-link">Token contracts <ArrowUpRight size={14} aria-hidden="true" /></button>
				</div>
				<ul className="site-deposit-chain-list" aria-label="Supported USDC networks">
					{DISPLAY_NETWORKS.map((c) => <li key={c.name}><img className={c.key === "base" ? "site-deposit-chain-logo-base" : undefined} src={`${import.meta.env.BASE_URL}logos/${c.logo}`} alt="" />{c.name}</li>)}
				</ul>
			</div>
		</Card>
	);
}
