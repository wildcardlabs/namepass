import { useMemo } from "react";
import { ArrowUpRight, Check, Copy, QrCode } from "lucide-react";
import { normalizeLabel } from "../lib/namepass";
import { encodeQR } from "../lib/qr";
import { useCopyFeedback } from "../hooks/use-copy-feedback";
import { FUNDING_CHAINS } from "../lib/chains";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

interface Props {
	name: string;
	address: string;
	/** Keep exact token contracts accessible before someone sends a payment. */
	onSupportedTokens: () => void;
}

/** Flat deposit details. The QR remains available without occupying the overview. */
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
		<section className="site-deposit-details" aria-label="Deposit details">
			<h4 className="site-detail-section-title">Deposit details</h4>
			<dl className="site-deposit-fields">
				<div>
					<dt>Namepass</dt>
					<dd>
						<span>{subdomain}</span>
						<Button variant="ghost" size="icon" className="site-data-copy" onClick={() => void copy(subdomain)} aria-label={`Copy ${subdomain}`} title="Copy subname">
							{copied === subdomain ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
						</Button>
					</dd>
				</div>
				<div>
					<dt>Deposit address · any supported chain</dt>
					<dd className="site-deposit-address">
						<span>{address}</span>
						<div className="site-deposit-actions">
							<Button variant="ghost" size="icon" className="site-data-copy" onClick={() => void copy(address)} aria-label={`Copy deposit address ${address}`} title="Copy deposit address">
								{copied === address ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
							</Button>
							<Dialog>
								<DialogTrigger asChild>
									<Button variant="ghost" size="icon" className="site-data-copy" aria-label="Show deposit address QR code" title="Show QR code" disabled={!matrix}>
										<QrCode aria-hidden="true" />
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
		</section>
	);
}
