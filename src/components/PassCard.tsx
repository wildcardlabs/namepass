import { useMemo } from "react";
import { ArrowUpRight, Check, Copy, QrCode } from "lucide-react";
import { normalizeLabel } from "../lib/namepass";
import { encodeQR } from "../lib/qr";
import { useCopyFeedback } from "../hooks/use-copy-feedback";
import { FUNDING_CHAINS } from "../lib/chains";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

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
		<Card className="site-deposit-details" role="region" aria-label="Deposit details">
			<div className="site-pass-header">
				<h4 className="site-detail-section-title">Namepass</h4>
						<Button variant="ghost" size="icon" className="site-data-copy" onClick={() => void copy(subdomain)} aria-label={`Copy ${subdomain}`} title="Copy subname">
							{copied === subdomain ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
						</Button>
			</div>
			<dl className="site-deposit-fields">
				<div className="site-deposit-identity">
					<dt className="sr-only">Namepass</dt>
					<dd>
						<span>{subdomain}</span>

					</dd>
				</div>
				<div className="site-deposit-destination">
					<dt>Deposit address · any supported chain</dt>
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
									<DialogTitle>Deposit address</DialogTitle>
									<DialogDescription>Scan to send from any wallet</DialogDescription>
									{matrix && <svg viewBox={`0 0 ${matrix.length} ${matrix.length}`} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${address}`}>
										<path fill="#171717" d={matrix.flatMap((row, r) => row.flatMap((on, c) => on ? [`M${c} ${r}h1v1h-1z`] : [])).join("")} />
									</svg>}
									<p className="site-qr-address">{address}</p>
								</DialogContent>
							</Dialog>
						</div>
					</dd>
				</div>
			</dl>
			<p role="status" className="sr-only">{copied ? "Copied to clipboard" : ""}</p>
			{error && <p role="alert" className="mt-2 text-[12px] text-red-700">{error.message}</p>}
			<p className="site-deposit-note">Every payment extends <span>{name}</span></p>
			<div className="site-deposit-networks">
				<div className="site-deposit-token"><img src={`${import.meta.env.BASE_URL}logos/usdc.svg`} alt="" />USDC accepted</div>
				<p>On any of these chains</p>
				<div className="site-deposit-chain-list">
					{FUNDING_CHAINS.map((c) => <span key={c.name}><img src={`${import.meta.env.BASE_URL}logos/${c.logo}`} alt="" />{c.name}</span>)}
				</div>
				<button type="button" onClick={onSupportedTokens} className="site-contract-link">Check contract addresses <ArrowUpRight size={14} aria-hidden="true" /></button>
			</div>
		</Card>
	);
}
