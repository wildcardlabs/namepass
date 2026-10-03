import { ArrowUpRight } from "lucide-react";

/** Integration action on the shared page wash, without a separate graphic panel. */
export default function CtaBand({ onDocs }: { onDocs: () => void }) {
	return (
		<section id="docs" className="site-cta-section">
			<div className="site-cta">
				<div className="site-cta-content">
					<h2>Bring renewals into your application.</h2>
					<p>
						Let users fund ENS renewals from your app with universal deposit addresses and settlement tracking.
					</p>
					<button
						onClick={onDocs}
						className="primary-action inline-flex items-center gap-2"
					>
						Read the docs
						<ArrowUpRight aria-hidden="true" className="w-4 h-4" />
					</button>
				</div>
			</div>
		</section>
	);
}
