import { useId, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { PublicActivityDeposit } from "../lib/publicApi";
import { chainById } from "../lib/chains";
import { explorerUrl, fmtUsdcExact, truncAddress, truncTx } from "../lib/format";

/** One payment stage, with separate event identities even when hashes are shared. */
export default function DepositTransactions({ deposits }: { deposits: PublicActivityDeposit[] | null }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!deposits?.length) return <li className="site-deposit-stage">
    <span className="site-transaction-step" aria-hidden="true">1</span>
    <div className="site-transaction-content"><div className="site-transaction-heading">Source deposits</div>
      <p className="mt-1 text-[12px] text-ink-secondary">Exact deposit breakdown unavailable.</p></div>
  </li>;
  const multiple = deposits.length > 1;
  const transactions = new Set(deposits.map(d => `${d.chainId}:${d.transactionHash.toLowerCase()}`)).size;
  const showList = !multiple || expanded;
  return <li>
    <div className="site-deposit-stage">
      <span className="site-transaction-step" aria-hidden="true">1</span>
      <div className="site-transaction-content">
        {multiple ? <button type="button" className="site-deposit-toggle" aria-expanded={expanded} aria-controls={id}
          onClick={() => setExpanded(value => !value)}>
          <span><span className="site-transaction-heading">Payments received</span>
            <span className="block text-[12px] text-ink-secondary">{deposits.length} deposits · {transactions} {transactions === 1 ? "transaction" : "transactions"}</span></span>
          <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-ink-secondary transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button> : <div className="site-transaction-heading">Payment received</div>}
        {showList && <ol id={id} className="site-deposit-list site-scrollable-evidence" aria-label="Source deposits" tabIndex={deposits.length > 3 ? 0 : undefined}>
          {deposits.map((deposit, index) => {
            const chain = chainById(Number(deposit.chainId));
            const name = chain?.name ?? deposit.chainId;
            return <li key={deposit.eventId}>
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-ink-secondary">Deposit {index + 1}</span>
                <span className="text-ink-primary tabular-nums">{fmtUsdcExact(BigInt(deposit.amount))} <span className="text-ink-secondary">USDC</span></span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <a href={explorerUrl(name, deposit.transactionHash)} target="_blank" rel="noopener noreferrer"
                className="site-transaction-hash" title={deposit.transactionHash}
                aria-label={`View ${name} deposit ${index + 1} transaction`}>
                {truncTx(deposit.transactionHash)} <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
              </a>
              <span className="text-[12px] leading-5 text-ink-secondary">{name}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px] leading-5 text-ink-secondary">
                <span title={deposit.senderAddress ?? undefined}>From {deposit.senderAddress ? truncAddress(deposit.senderAddress) : "unavailable"}</span>
              </div>
            </li>;
          })}
        </ol>}
      </div>
    </div>
  </li>;
}
