import { sql } from "drizzle-orm";
import { database } from "./db/client";
import { checksumAddress } from "../src/lib/namepass";
import { chainById } from "../src/lib/chains";

export type ActivityDeposit = {
  eventId: string; chainId: string; amount: string; senderAddress: string | null;
  transactionHash: string; logIndex: number | null;
};

/** Indexed display evidence only. No RPC, new storage, or payment-completion claim. */
export async function activityDeposits(flowIds: string[]): Promise<Map<string, ActivityDeposit[] | null>> {
  if (!flowIds.length) return new Map();
  const result = await database().execute<{
    flow_id: string; chain_id: string; processed_amount: string; received_amount: string;
    remaining: string; prior_remaining: string | null; ambiguous_native: boolean;
    credits: Array<{ eventId: string; chainId: string; amount: string; senderAddress: string | null; transactionHash: string; logIndex: number; tokenAddress: string }>;
  }>(sql`
    SELECT f.id AS flow_id, f.origin_chain_id::text AS chain_id,
      p.facts->>'amount' AS processed_amount, r.facts->>'amount_received' AS received_amount,
      p.facts->>'remaining_amount' AS remaining, previous.facts->>'remaining_amount' AS prior_remaining,
      EXISTS (
        SELECT 1 FROM deposits d JOIN chain_events e ON e.event_id = d.event_id
        WHERE d.name_id = f.name_id AND d.chain_id = f.origin_chain_id AND e.canonical
          AND d.event_id LIKE d.chain_id::text || ':native:%'
          AND d.block_number IN (p.block_number, previous.block_number)
      ) AS ambiguous_native,
      COALESCE(credits.items, '[]'::jsonb) AS credits
    FROM flows f JOIN names n ON n.id = f.name_id
    JOIN chain_events r ON r.event_id = f.renewal_event_id AND r.canonical
    JOIN chain_events p ON p.event_id = f.origin_event_id AND p.canonical
      AND p.event_family = 'namepass' AND p.event_type = 'DepositProcessed'
      AND p.chain_id = f.origin_chain_id AND lower(p.facts->>'wallet_address') = lower(n.deposit_address)
    LEFT JOIN LATERAL (
      SELECT e.* FROM chain_events e
      WHERE e.chain_id = p.chain_id AND e.canonical
        AND e.event_family = 'namepass' AND e.event_type = 'DepositProcessed'
        AND lower(e.facts->>'wallet_address') = lower(n.deposit_address)
        AND (e.block_number, e.log_index) < (p.block_number, p.log_index)
      ORDER BY e.block_number DESC, e.log_index DESC LIMIT 1
    ) previous ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(item ORDER BY block_number, log_index, event_id) AS items FROM (
        SELECT d.block_number, d.log_index, d.event_id, jsonb_build_object(
          'eventId', d.event_id, 'chainId', d.chain_id::text, 'amount', d.amount::text,
          'senderAddress', d.sender_address, 'transactionHash', d.tx_hash,
          'logIndex', d.log_index, 'tokenAddress', d.token_address
        ) AS item
        FROM deposits d JOIN chain_events e ON e.event_id = d.event_id AND e.canonical
        WHERE d.name_id = f.name_id AND d.chain_id = f.origin_chain_id
          AND d.status IN ('detected', 'finalized') AND d.source = 'goldsky'
          AND (d.block_number, d.log_index) < (p.block_number, p.log_index)
          AND (previous.event_id IS NULL OR (d.block_number, d.log_index) > (previous.block_number, previous.log_index))
        ORDER BY d.block_number, d.log_index, d.event_id LIMIT 33
      ) bounded
    ) credits ON true
    WHERE f.id IN (${sql.join(flowIds.map(id => sql`${id}::uuid`), sql`, `)})
  `);
  const grouped = new Map<string, ActivityDeposit[] | null>(flowIds.map(id => [id, null]));
  for (const row of result.rows) {
    const token = chainById(Number(row.chain_id))?.usdcAddress;
    // Partial processing, an unknown opening balance, missing credits, and native
    // same-block ordering cannot provide an exact per-renewal breakdown here.
    if (!token || row.remaining !== "0" || (row.prior_remaining !== null && row.prior_remaining !== "0")
      || row.ambiguous_native || !row.credits.length || row.credits.length > 32
      || !/^[1-9][0-9]*$/.test(row.processed_amount ?? "") || row.processed_amount !== row.received_amount
      || row.credits.some(d => !/^[1-9][0-9]*$/.test(d.amount) || d.tokenAddress.toLowerCase() !== token.toLowerCase())
      || row.credits.reduce((sum, d) => sum + BigInt(d.amount), 0n) !== BigInt(row.processed_amount)) continue;
    grouped.set(row.flow_id, row.credits.map(({ tokenAddress: _token, ...d }) => ({ ...d,
      senderAddress: d.senderAddress ? checksumAddress(d.senderAddress) : null,
      logIndex: d.eventId.startsWith(`${d.chainId}:native:`) ? null : d.logIndex,
    })));
  }
  return grouped;
}
