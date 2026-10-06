-- One public Goldsky event was rejected because its whole amount had decimal zeros.
-- Apply only after verifying arc-native-deposit-repair.json against the live receipt.
-- This restores index evidence only. It does not start a flow or change a payment.
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '10000ms';
DO $repair$
DECLARE
  name_id_expected constant uuid := '975f3c03-725b-424f-ba4c-57d2e2f92507';
  event_id_expected constant text := '5042002:native:enriched_transaction_v2_0x1c1fdc1c78c0be77dfc10f354963030bc82deb63c9b7fd461e75ee904083ee24_1';
  tx_expected constant text := '0x83be711fb69f2bd185a5a418177438a43827d99c5f53b8df6bfc2a9936f2d562';
  wallet_expected constant text := '0x16cfeb29157376f55e7976562a850d04435c171d';
  sender_expected constant text := '0x1208a26faa0f4ac65b42098419eb4daa5e580ac6';
  token_expected constant text := '0x3600000000000000000000000000000000000000';
  facts_expected jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM names WHERE id=name_id_expected
    AND normalized_label='farcaster' AND lower(deposit_address)=wallet_expected) THEN
    RAISE EXCEPTION 'Repair name or wallet does not match';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM flows f JOIN chain_events e ON e.event_id=f.origin_event_id
    WHERE f.id='d49e1878-2f64-4138-b9d9-e2b6139ad883' AND f.name_id=name_id_expected
    AND f.origin_chain_id=5042002 AND f.amount_processed=1000000
    AND e.canonical AND e.chain_id=5042002 AND e.event_family='namepass'
    AND e.event_type='DepositProcessed' AND e.block_number=65859120
    AND e.tx_hash='0xba258920fbff2c1b91b1ab29b1eeb384b9bd186e91bee1dc4a3e154444db1c61'
    AND e.facts->>'amount'='1000000' AND e.facts->>'remaining_amount'='0'
    AND e.facts->>'wallet_address'=wallet_expected) THEN
    RAISE EXCEPTION 'The existing pooled drain does not match';
  END IF;
  facts_expected := jsonb_build_object('token_address',token_expected,
    'sender_address',sender_expected,'recipient_address',wallet_expected,'amount','500000');
  IF EXISTS (SELECT 1 FROM chain_events WHERE event_id=event_id_expected
    AND NOT (event_family='deposit' AND event_type='Transfer' AND chain_id=5042002
      AND tx_hash=tx_expected AND log_index=1 AND block_number=65859073
      AND block_time=to_timestamp(1791322130) AND gs_op='c' AND canonical
      AND facts=facts_expected)) THEN
    RAISE EXCEPTION 'Existing event differs from canonical repair';
  END IF;
  IF EXISTS (SELECT 1 FROM deposits WHERE event_id=event_id_expected
    AND NOT (name_id=name_id_expected AND chain_id=5042002 AND token_address=token_expected
      AND sender_address=sender_expected AND amount=500000 AND tx_hash=tx_expected
      AND log_index=1 AND block_number=65859073 AND block_time=to_timestamp(1791322130)
      AND source='goldsky' AND status='detected')) THEN
    RAISE EXCEPTION 'Existing deposit differs from canonical repair';
  END IF;
  INSERT INTO chain_events (event_id,event_family,event_type,chain_id,tx_hash,log_index,
    block_number,block_time,gs_op,canonical,facts)
  VALUES (event_id_expected,'deposit','Transfer',5042002,tx_expected,1,65859073,
    to_timestamp(1791322130),'c',true,facts_expected)
  ON CONFLICT (event_id) DO NOTHING;
  INSERT INTO deposits (event_id,name_id,chain_id,token_address,sender_address,amount,
    tx_hash,log_index,block_number,block_time,source,status)
  VALUES (event_id_expected,name_id_expected,5042002,token_expected,sender_expected,500000,
    tx_expected,1,65859073,to_timestamp(1791322130),'goldsky','detected')
  ON CONFLICT (event_id) DO NOTHING;
END;
$repair$;
COMMIT;
