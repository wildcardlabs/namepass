-- Prepared from SELECT-only audit ens-expiry-audit.json. Requires separate approval.
-- Apply only after the expiry-fix deployment is verified. No schema, amounts or status changes.
BEGIN;
SET LOCAL statement_timeout = '10000ms';
SET LOCAL lock_timeout = '1500ms';
DO $repair$
DECLARE affected integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM chain_events WHERE event_id='11155111:log_0xc26ae8dbd36388afc2d94ce972f56c7fd17ebd8fcab2295b648069658fcbdb11_164' AND canonical=true AND chain_id=11155111 AND tx_hash='0x9055fe091741e3edf419b1f83ab7acd0781d63e510e180713aff9c7565033551' AND log_index=164 AND block_number='11766145' AND facts->>'new_expiry'='3146224415') THEN
    UPDATE chain_events SET facts=jsonb_set(facts,'{new_expiry}',to_jsonb('3146224415'::text)) WHERE event_id='11155111:log_0xc26ae8dbd36388afc2d94ce972f56c7fd17ebd8fcab2295b648069658fcbdb11_164' AND canonical=true AND chain_id=11155111 AND tx_hash='0x9055fe091741e3edf419b1f83ab7acd0781d63e510e180713aff9c7565033551' AND log_index=164 AND block_number='11766145' AND facts->>'new_expiry' IS NOT DISTINCT FROM '3151581215';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chain_events WHERE event_id='11155111:log_0x306160db68c966f8b9c3e27903ad36241c5596705b501bf84f9f42b361e36a67_181' AND canonical=true AND chain_id=11155111 AND tx_hash='0xc3d5098291eecdfdbaf2c2fc115a7ecaac0b9fe0bf0bc43aa4db3abff892cd36' AND log_index=181 AND block_number='11766153' AND facts->>'new_expiry'='1798608633') THEN
    UPDATE chain_events SET facts=jsonb_set(facts,'{new_expiry}',to_jsonb('1798608633'::text)) WHERE event_id='11155111:log_0x306160db68c966f8b9c3e27903ad36241c5596705b501bf84f9f42b361e36a67_181' AND canonical=true AND chain_id=11155111 AND tx_hash='0xc3d5098291eecdfdbaf2c2fc115a7ecaac0b9fe0bf0bc43aa4db3abff892cd36' AND log_index=181 AND block_number='11766153' AND facts->>'new_expiry' IS NOT DISTINCT FROM '1803965433';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chain_events WHERE event_id='11155111:log_0x4e3fc01f5c8bd263091b0fdfac3394dab420aac1bd0c9ec436413bd294765e4a_234' AND canonical=true AND chain_id=11155111 AND tx_hash='0x5dbed0687ebd330067677fe501bb4119292823926739600b503bc7cb01dd91b7' AND log_index=234 AND block_number='11766181' AND facts->>'new_expiry'='1837299741') THEN
    UPDATE chain_events SET facts=jsonb_set(facts,'{new_expiry}',to_jsonb('1837299741'::text)) WHERE event_id='11155111:log_0x4e3fc01f5c8bd263091b0fdfac3394dab420aac1bd0c9ec436413bd294765e4a_234' AND canonical=true AND chain_id=11155111 AND tx_hash='0x5dbed0687ebd330067677fe501bb4119292823926739600b503bc7cb01dd91b7' AND log_index=234 AND block_number='11766181' AND facts->>'new_expiry' IS NOT DISTINCT FROM '1842656541';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chain_events WHERE event_id='11155111:log_0xa881039931fbee539129482bd24bb1a412fe49ee4278e55c7f774a3ce190a2cf_225' AND canonical=true AND chain_id=11155111 AND tx_hash='0x24b337d6b5fb2aef862341b36620b7f2083076b0dc881bbf31f15569ed6423c8' AND log_index=225 AND block_number='11766200' AND facts->>'new_expiry'='1845356014') THEN
    UPDATE chain_events SET facts=jsonb_set(facts,'{new_expiry}',to_jsonb('1845356014'::text)) WHERE event_id='11155111:log_0xa881039931fbee539129482bd24bb1a412fe49ee4278e55c7f774a3ce190a2cf_225' AND canonical=true AND chain_id=11155111 AND tx_hash='0x24b337d6b5fb2aef862341b36620b7f2083076b0dc881bbf31f15569ed6423c8' AND log_index=225 AND block_number='11766200' AND facts->>'new_expiry' IS NOT DISTINCT FROM '1850712814';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM flows WHERE id='76f746d1-7d5a-4461-ae6c-f9c2dedd8c9d'::uuid AND renewal_event_id='11155111:log_0x4e3fc01f5c8bd263091b0fdfac3394dab420aac1bd0c9ec436413bd294765e4a_234' AND expiry_after='2028-03-22T01:02:21.000Z'::timestamptz) THEN
    UPDATE flows SET expiry_after='2028-03-22T01:02:21.000Z'::timestamptz WHERE id='76f746d1-7d5a-4461-ae6c-f9c2dedd8c9d'::uuid AND renewal_event_id='11155111:log_0x4e3fc01f5c8bd263091b0fdfac3394dab420aac1bd0c9ec436413bd294765e4a_234' AND expiry_after IS NOT DISTINCT FROM '2028-05-23T01:02:21.000Z'::timestamptz;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM flows WHERE id='778da1d0-b59d-4c88-818a-2d5e9784fdeb'::uuid AND renewal_event_id='11155111:log_0xc26ae8dbd36388afc2d94ce972f56c7fd17ebd8fcab2295b648069658fcbdb11_164' AND expiry_after='2069-09-12T15:13:35.000Z'::timestamptz) THEN
    UPDATE flows SET expiry_after='2069-09-12T15:13:35.000Z'::timestamptz WHERE id='778da1d0-b59d-4c88-818a-2d5e9784fdeb'::uuid AND renewal_event_id='11155111:log_0xc26ae8dbd36388afc2d94ce972f56c7fd17ebd8fcab2295b648069658fcbdb11_164' AND expiry_after IS NOT DISTINCT FROM '2069-11-13T15:13:35.000Z'::timestamptz;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM flows WHERE id='a192c01d-37ce-40b4-8639-0182a87886fe'::uuid AND renewal_event_id='11155111:log_0x306160db68c966f8b9c3e27903ad36241c5596705b501bf84f9f42b361e36a67_181' AND expiry_after='2026-12-30T05:30:33.000Z'::timestamptz) THEN
    UPDATE flows SET expiry_after='2026-12-30T05:30:33.000Z'::timestamptz WHERE id='a192c01d-37ce-40b4-8639-0182a87886fe'::uuid AND renewal_event_id='11155111:log_0x306160db68c966f8b9c3e27903ad36241c5596705b501bf84f9f42b361e36a67_181' AND expiry_after IS NOT DISTINCT FROM '2027-03-02T05:30:33.000Z'::timestamptz;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM flows WHERE id='eec07fbc-2c4b-4396-8c47-a309b1b15cbf'::uuid AND renewal_event_id='11155111:log_0xa881039931fbee539129482bd24bb1a412fe49ee4278e55c7f774a3ce190a2cf_225' AND expiry_after='2028-06-23T06:53:34.000Z'::timestamptz) THEN
    UPDATE flows SET expiry_after='2028-06-23T06:53:34.000Z'::timestamptz WHERE id='eec07fbc-2c4b-4396-8c47-a309b1b15cbf'::uuid AND renewal_event_id='11155111:log_0xa881039931fbee539129482bd24bb1a412fe49ee4278e55c7f774a3ce190a2cf_225' AND expiry_after IS NOT DISTINCT FROM '2028-08-24T06:53:34.000Z'::timestamptz;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM names WHERE id='975f3c03-725b-424f-ba4c-57d2e2f92507'::uuid AND normalized_label='farcaster' AND current_expiry='2032-03-07T21:32:37.000Z'::timestamptz AND renewable_by='v1'::renewable_by) THEN
    UPDATE names SET current_expiry='2032-03-07T21:32:37.000Z'::timestamptz, renewable_by='v1'::renewable_by, ens_synced_at='2026-10-06T11:07:47.639Z'::timestamptz WHERE id='975f3c03-725b-424f-ba4c-57d2e2f92507'::uuid AND normalized_label='farcaster' AND current_expiry IS NOT DISTINCT FROM '2032-05-08T21:32:37.000Z'::timestamptz AND renewable_by IS NOT DISTINCT FROM 'v1'::renewable_by AND ens_synced_at='2026-09-23T20:08:25.698Z'::timestamptz;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM names WHERE id='d440a810-bbf1-4c4b-919c-6275b9a4a898'::uuid AND normalized_label='gregskril' AND current_expiry='2028-03-22T01:02:21.000Z'::timestamptz AND renewable_by='v1'::renewable_by) THEN
    UPDATE names SET current_expiry='2028-03-22T01:02:21.000Z'::timestamptz, renewable_by='v1'::renewable_by, ens_synced_at='2026-10-06T11:07:47.992Z'::timestamptz WHERE id='d440a810-bbf1-4c4b-919c-6275b9a4a898'::uuid AND normalized_label='gregskril' AND current_expiry IS NOT DISTINCT FROM '2028-05-23T01:02:21.000Z'::timestamptz AND renewable_by IS NOT DISTINCT FROM 'v1'::renewable_by AND ens_synced_at='2026-10-05T09:57:16.322Z'::timestamptz;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM names WHERE id='87921a4f-7739-4cec-9a23-be72335b7e02'::uuid AND normalized_label='nick' AND current_expiry='2026-12-30T05:30:33.000Z'::timestamptz AND renewable_by='v1'::renewable_by) THEN
    UPDATE names SET current_expiry='2026-12-30T05:30:33.000Z'::timestamptz, renewable_by='v1'::renewable_by, ens_synced_at='2026-10-06T11:07:48.329Z'::timestamptz WHERE id='87921a4f-7739-4cec-9a23-be72335b7e02'::uuid AND normalized_label='nick' AND current_expiry IS NOT DISTINCT FROM '2027-03-02T05:30:33.000Z'::timestamptz AND renewable_by IS NOT DISTINCT FROM 'v1'::renewable_by AND ens_synced_at='2026-10-02T11:44:15.308Z'::timestamptz;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM names WHERE id='9e0e695c-255c-4759-af82-2763225d61c6'::uuid AND normalized_label='slobo' AND current_expiry='2028-06-23T06:53:34.000Z'::timestamptz AND renewable_by='v1'::renewable_by) THEN
    UPDATE names SET current_expiry='2028-06-23T06:53:34.000Z'::timestamptz, renewable_by='v1'::renewable_by, ens_synced_at='2026-10-06T11:07:49.333Z'::timestamptz WHERE id='9e0e695c-255c-4759-af82-2763225d61c6'::uuid AND normalized_label='slobo' AND current_expiry IS NOT DISTINCT FROM '2028-08-24T06:53:34.000Z'::timestamptz AND renewable_by IS NOT DISTINCT FROM 'v1'::renewable_by AND ens_synced_at='2026-10-03T10:10:12.905Z'::timestamptz;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM names WHERE id='5d0f2e10-cea9-4e99-975f-b2d31ecd323e'::uuid AND normalized_label='vitalik' AND current_expiry='2069-09-12T15:13:35.000Z'::timestamptz AND renewable_by='v1'::renewable_by) THEN
    UPDATE names SET current_expiry='2069-09-12T15:13:35.000Z'::timestamptz, renewable_by='v1'::renewable_by, ens_synced_at='2026-10-06T11:07:50.433Z'::timestamptz WHERE id='5d0f2e10-cea9-4e99-975f-b2d31ecd323e'::uuid AND normalized_label='vitalik' AND current_expiry IS NOT DISTINCT FROM '2069-11-13T15:13:35.000Z'::timestamptz AND renewable_by IS NOT DISTINCT FROM 'v1'::renewable_by AND ens_synced_at='2026-10-03T10:23:57.716Z'::timestamptz;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expiry audit is stale; entire repair rolled back'; END IF;
  END IF;
END;
$repair$;
COMMIT;
