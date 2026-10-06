-- User-authorized obsolete testnet history cleanup, 2026-10-06.
-- Exact old row IDs only. Preserve farcaster's funded deposit, flow and new events.
-- Do not reset Namepass contracts, watches, balances, nonce counters or pipeline checkpoints.
-- Cached expiry is cleared only if it still matches the recorded pre-rotation observation.
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '10000ms';
LOCK TABLE balance_snapshots, chain_events, deposits, flow_transitions, flows,
  goldsky.watched_addresses, names, relayer_nonces, transaction_intents
  IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE reset_old_flows (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO reset_old_flows VALUES
  ('14cb7228-00ea-4e9d-a98c-823a27f125f8'::uuid),
  ('48d9cf71-7966-4e4d-a055-99ad1f2a5956'::uuid),
  ('747a9547-db97-4617-be17-4099b042958b'::uuid),
  ('6849f6d1-00f3-428b-9147-8bbd43099e1e'::uuid),
  ('b3277976-da0d-4e83-b81a-6edc94af63b6'::uuid),
  ('08880f31-ea2e-409f-bde3-232e017baef9'::uuid),
  ('778da1d0-b59d-4c88-818a-2d5e9784fdeb'::uuid),
  ('a192c01d-37ce-40b4-8639-0182a87886fe'::uuid),
  ('76f746d1-7d5a-4461-ae6c-f9c2dedd8c9d'::uuid),
  ('eec07fbc-2c4b-4396-8c47-a309b1b15cbf'::uuid),
  ('ee8dc126-d340-4afb-a2ae-447c306f44ea'::uuid),
  ('7a7e1c35-db06-4d17-8449-4c216f775963'::uuid);
CREATE TEMP TABLE reset_old_events (event_id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO reset_old_events VALUES
  ('11155111:log_0x0c719d3fa42be7ba9f54cc585b3202cdca38d29669edb24f8a606682d9c2cf73_293'),
  ('11155111:log_0x0c719d3fa42be7ba9f54cc585b3202cdca38d29669edb24f8a606682d9c2cf73_304'),
  ('11155111:log_0x306160db68c966f8b9c3e27903ad36241c5596705b501bf84f9f42b361e36a67_164'),
  ('11155111:log_0x306160db68c966f8b9c3e27903ad36241c5596705b501bf84f9f42b361e36a67_181'),
  ('11155111:log_0x4e3fc01f5c8bd263091b0fdfac3394dab420aac1bd0c9ec436413bd294765e4a_218'),
  ('11155111:log_0x4e3fc01f5c8bd263091b0fdfac3394dab420aac1bd0c9ec436413bd294765e4a_234'),
  ('11155111:log_0x7c7068e2fafb39423d4c35f10798cfe14dea0a256c7040e535d157b4679cf67d_163'),
  ('11155111:log_0x7c7068e2fafb39423d4c35f10798cfe14dea0a256c7040e535d157b4679cf67d_176'),
  ('11155111:log_0x7c7068e2fafb39423d4c35f10798cfe14dea0a256c7040e535d157b4679cf67d_177'),
  ('11155111:log_0x80991a9fb89dd20f524021df9dffaffb2185c0f84e03b77cbda7eb4ea808ab59_322'),
  ('11155111:log_0x80991a9fb89dd20f524021df9dffaffb2185c0f84e03b77cbda7eb4ea808ab59_323'),
  ('11155111:log_0x93a84434b6749e6b9dcbbad65369ba2c3298f834ae406b2986298ff64326a63f_214'),
  ('11155111:log_0x93a84434b6749e6b9dcbbad65369ba2c3298f834ae406b2986298ff64326a63f_225'),
  ('11155111:log_0x9bae7f0d0671542a558423e38d61e193ac0c3b58b1ee7266a1e7ac8ca8e8c94a_153'),
  ('11155111:log_0x9bae7f0d0671542a558423e38d61e193ac0c3b58b1ee7266a1e7ac8ca8e8c94a_164'),
  ('11155111:log_0x9e4edd3c27e3282a4af61d1079a18aa8d21cf3ced6169a190ba75288db15d07e_179'),
  ('11155111:log_0x9e4edd3c27e3282a4af61d1079a18aa8d21cf3ced6169a190ba75288db15d07e_190'),
  ('11155111:log_0xa3f5b5aea968a33867b9481bf093dc95de446a336756ec246efad75a4cabbe18_98'),
  ('11155111:log_0xa881039931fbee539129482bd24bb1a412fe49ee4278e55c7f774a3ce190a2cf_209'),
  ('11155111:log_0xa881039931fbee539129482bd24bb1a412fe49ee4278e55c7f774a3ce190a2cf_225'),
  ('11155111:log_0xc26ae8dbd36388afc2d94ce972f56c7fd17ebd8fcab2295b648069658fcbdb11_148'),
  ('11155111:log_0xc26ae8dbd36388afc2d94ce972f56c7fd17ebd8fcab2295b648069658fcbdb11_164'),
  ('5042002:log_0x33a7728c44f0c3dafa1cea0bb9eb02bcb246f21d7502c29ce64d9aa93ce1ec9f_14'),
  ('5042002:log_0x33a7728c44f0c3dafa1cea0bb9eb02bcb246f21d7502c29ce64d9aa93ce1ec9f_23'),
  ('5042002:log_0x90a8539ed22a9e47e184f06313c74f8309f4ba97a306e70d0fa610a336511f35_37'),
  ('5042002:log_0x9ec8ed0651c579dcb6164845557b2f5a0ed6546bc5fc9b49e6fa82f7421e7f22_15'),
  ('5042002:log_0x9ec8ed0651c579dcb6164845557b2f5a0ed6546bc5fc9b49e6fa82f7421e7f22_6'),
  ('5042002:log_0xbeee0274fdecf782b96c3318064556b4f6e0af6bfc1298372f854d26f14662a9_35'),
  ('5042002:log_0xbeee0274fdecf782b96c3318064556b4f6e0af6bfc1298372f854d26f14662a9_44'),
  ('5042002:log_0xe56cd4b487c7d75e34817fb45e32cb90355fda6e92a256ead116348a82743fa4_17'),
  ('5042002:log_0xe56cd4b487c7d75e34817fb45e32cb90355fda6e92a256ead116348a82743fa4_26'),
  ('5042002:log_0xe603c16bdbd39aeabfa39e5f92359fb318ecf6b95eb3cae203895bc3f662e547_0'),
  ('5042002:log_0xe603c16bdbd39aeabfa39e5f92359fb318ecf6b95eb3cae203895bc3f662e547_9'),
  ('5042002:log_0xedd5fe3e18a95daa92a0e99b942ec3aef5438eabf8ffef8ec4b6f17105bd0036_14'),
  ('5042002:log_0xedd5fe3e18a95daa92a0e99b942ec3aef5438eabf8ffef8ec4b6f17105bd0036_23'),
  ('5042002:log_0xefcf2de2b42d1a33fc0d6e1507d5466f7c894cc47dead26c7ee16fa3dc30ca7c_30'),
  ('5042002:log_0xefcf2de2b42d1a33fc0d6e1507d5466f7c894cc47dead26c7ee16fa3dc30ca7c_39'),
  ('5042002:native:enriched_transaction_v2_0x08b2fd831cc237b3ad8f5b7ddba411c35ab8ffb1e70cc50eb0a965c77e1e1203_5'),
  ('5042002:native:enriched_transaction_v2_0x17829f7b587143ea1bcc378dc3b469dc876761b9c0671e1d4918c177eb4ba667_1'),
  ('5042002:native:enriched_transaction_v2_0x8ca5e672f67efcfbe1f6ba9cbc2fdbbd74f281f4bc18694c9a4d51be4581b4b7_10'),
  ('5042002:native:enriched_transaction_v2_0x8e0f2358a4c76ad317a15a1f2682b400e3aba0b6daab254eb4c1832c8a6cf077_5'),
  ('5042002:native:enriched_transaction_v2_0xc238edafd74b121327a907cc6377cbdaf37d90dcd2114af4d48d7d7cf6890594_2'),
  ('5042002:native:enriched_transaction_v2_0xfac77455b4b1f72626d835c69ed6330e835eaff3ba75f7b7a1fad48ff45d1aa4_7');
CREATE TEMP TABLE reset_old_deposits (event_id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO reset_old_deposits VALUES
  ('5042002:native:enriched_transaction_v2_0xfac77455b4b1f72626d835c69ed6330e835eaff3ba75f7b7a1fad48ff45d1aa4_7'),
  ('5042002:native:enriched_transaction_v2_0x17829f7b587143ea1bcc378dc3b469dc876761b9c0671e1d4918c177eb4ba667_1'),
  ('5042002:native:enriched_transaction_v2_0xc238edafd74b121327a907cc6377cbdaf37d90dcd2114af4d48d7d7cf6890594_2'),
  ('5042002:native:enriched_transaction_v2_0x8e0f2358a4c76ad317a15a1f2682b400e3aba0b6daab254eb4c1832c8a6cf077_5'),
  ('5042002:native:enriched_transaction_v2_0x8ca5e672f67efcfbe1f6ba9cbc2fdbbd74f281f4bc18694c9a4d51be4581b4b7_10'),
  ('11155111:log_0xa3f5b5aea968a33867b9481bf093dc95de446a336756ec246efad75a4cabbe18_98'),
  ('5042002:native:enriched_transaction_v2_0x08b2fd831cc237b3ad8f5b7ddba411c35ab8ffb1e70cc50eb0a965c77e1e1203_5');
CREATE TEMP TABLE reset_old_expiries (id uuid PRIMARY KEY, expiry timestamptz, observed_at timestamptz) ON COMMIT DROP;
INSERT INTO reset_old_expiries VALUES
  ('d33a0e7f-3f07-4614-9a70-db739620c8f2'::uuid, '2033-02-19T22:45:39.000Z'::timestamptz, '2026-10-05T14:46:27.320Z'::timestamptz),
  ('975f3c03-725b-424f-ba4c-57d2e2f92507'::uuid, '2032-03-07T21:32:37.000Z'::timestamptz, '2026-10-06T18:51:28.042Z'::timestamptz),
  ('d440a810-bbf1-4c4b-919c-6275b9a4a898'::uuid, '2028-03-22T01:02:21.000Z'::timestamptz, '2026-10-06T15:57:26.953Z'::timestamptz),
  ('87921a4f-7739-4cec-9a23-be72335b7e02'::uuid, '2026-12-30T05:30:33.000Z'::timestamptz, '2026-10-06T17:08:38.410Z'::timestamptz),
  ('bb26e686-7815-4f35-b460-d328960104d7'::uuid, '2028-02-02T03:05:30.000Z'::timestamptz, '2026-10-03T10:14:59.719Z'::timestamptz),
  ('eb6622dc-02ed-4701-b6f0-65a847e976f4'::uuid, NULL::timestamptz, '2026-09-28T11:29:11.685Z'::timestamptz),
  ('9e0e695c-255c-4759-af82-2763225d61c6'::uuid, '2028-06-23T06:53:34.000Z'::timestamptz, '2026-10-06T11:29:51.942Z'::timestamptz),
  ('988a8b2d-8f5e-4513-ba1e-33beb70a4dc0'::uuid, '2029-09-22T10:16:06.000Z'::timestamptz, '2026-10-06T11:30:17.676Z'::timestamptz),
  ('89c139d4-256d-4955-88c6-a920e73e0bdd'::uuid, NULL::timestamptz, '2026-10-02T23:40:25.292Z'::timestamptz),
  ('5190729a-f079-47fc-83b2-2dd19ad14a72'::uuid, NULL::timestamptz, '2026-09-28T11:29:09.583Z'::timestamptz),
  ('5d0f2e10-cea9-4e99-975f-b2d31ecd323e'::uuid, '2069-11-13T15:13:35.000Z'::timestamptz, '2026-10-06T12:13:19.701Z'::timestamptz);
CREATE TEMP TABLE reset_preserved_flow ON COMMIT DROP AS
  SELECT * FROM flows WHERE id='98fc7f5f-9147-41fb-8a79-8aa8ded20fa3';
CREATE TEMP TABLE reset_preserved_deposit ON COMMIT DROP AS
  SELECT * FROM deposits WHERE tx_hash='0xd725d3431622bfc574524ca092564a319efe49e0be2b4798348b582718441533' AND log_index=110 AND chain_id=11155111;
CREATE TEMP TABLE reset_preserved_event ON COMMIT DROP AS
  SELECT e.* FROM chain_events e JOIN reset_preserved_deposit d USING (event_id);
CREATE TEMP TABLE reset_preserved_watches ON COMMIT DROP AS SELECT * FROM goldsky.watched_addresses;
CREATE TEMP TABLE reset_preserved_nonces ON COMMIT DROP AS SELECT * FROM relayer_nonces;
CREATE TEMP TABLE reset_preserved_balances ON COMMIT DROP AS SELECT * FROM balance_snapshots;
DO $$
BEGIN
  IF (SELECT count(*) FROM reset_preserved_flow) <> 1 OR (SELECT count(*) FROM reset_preserved_deposit) <> 1
    OR (SELECT count(*) FROM reset_preserved_event WHERE canonical) <> 1
    OR NOT EXISTS (SELECT 1 FROM reset_preserved_deposit WHERE amount=500000 AND source='goldsky')
  THEN RAISE EXCEPTION 'Funded canary is missing or changed'; END IF;
  IF (SELECT count(*) FROM flows f JOIN reset_old_flows r USING (id)) <> 12
    OR EXISTS (SELECT 1 FROM flows f JOIN reset_old_flows r USING (id) WHERE status NOT IN ('settled','cancelled'))
  THEN RAISE EXCEPTION 'Old flow inventory changed'; END IF;
  IF (SELECT count(*) FROM transaction_intents t JOIN reset_old_flows r ON r.id=t.flow_id) <> 13
    OR EXISTS (SELECT 1 FROM transaction_intents t JOIN reset_old_flows r ON r.id=t.flow_id WHERE status <> 'confirmed')
  THEN RAISE EXCEPTION 'Old intent inventory changed or a transaction is unresolved'; END IF;
  IF (SELECT count(*) FROM flow_transitions t JOIN reset_old_flows r ON r.id=t.flow_id) <> 65
    OR (SELECT count(*) FROM deposits d JOIN reset_old_deposits r USING (event_id)) <> 7
    OR (SELECT count(*) FROM chain_events e JOIN reset_old_events r USING (event_id)) <> 43
  THEN RAISE EXCEPTION 'Old event inventory changed'; END IF;
  IF EXISTS (SELECT 1 FROM reset_old_events r JOIN reset_preserved_event p USING (event_id))
    OR EXISTS (SELECT 1 FROM reset_old_flows r JOIN reset_preserved_flow p USING (id))
  THEN RAISE EXCEPTION 'Cleanup intersects preserved canary'; END IF;
END $$;
DELETE FROM flow_transitions WHERE flow_id IN (SELECT id FROM reset_old_flows);
DELETE FROM transaction_intents WHERE flow_id IN (SELECT id FROM reset_old_flows);
DELETE FROM flows WHERE id IN (SELECT id FROM reset_old_flows);
DELETE FROM deposits WHERE event_id IN (SELECT event_id FROM reset_old_deposits);
DELETE FROM chain_events WHERE event_id IN (SELECT event_id FROM reset_old_events);
UPDATE names n SET current_expiry=NULL, renewable_by=NULL
  FROM reset_old_expiries r WHERE n.id=r.id
  AND n.current_expiry IS NOT DISTINCT FROM r.expiry AND n.ens_synced_at=r.observed_at;
-- Match the existing event-backed aggregate definition, retaining any new renewal.
UPDATE names n SET
  lifetime_received=coalesce((SELECT sum((facts->>'amount_received')::numeric) FROM chain_events WHERE canonical AND event_family='namepass' AND event_type='Renewed' AND lower(facts->>'label_hash')=lower(n.label_hash)),0),
  lifetime_applied=coalesce((SELECT sum((facts->>'amount_applied')::numeric) FROM chain_events WHERE canonical AND event_family='namepass' AND event_type='Renewed' AND lower(facts->>'label_hash')=lower(n.label_hash)),0),
  time_delivered_seconds=coalesce((SELECT sum((facts->>'duration')::numeric) FROM chain_events WHERE canonical AND event_family='namepass' AND event_type='Renewed' AND lower(facts->>'label_hash')=lower(n.label_hash)),0),
  renewal_count=(SELECT count(*) FROM chain_events WHERE canonical AND event_family='namepass' AND event_type='Renewed' AND lower(facts->>'label_hash')=lower(n.label_hash))
  WHERE n.id IN (SELECT id FROM reset_old_expiries);
DO $$
BEGIN
  IF EXISTS (SELECT * FROM reset_preserved_flow EXCEPT SELECT * FROM flows)
    OR EXISTS (SELECT * FROM reset_preserved_deposit EXCEPT SELECT * FROM deposits)
    OR EXISTS (SELECT * FROM reset_preserved_event EXCEPT SELECT * FROM chain_events)
  THEN RAISE EXCEPTION 'Preserved canary changed'; END IF;
END $$;
-- Independently check each operational table and each canary table without mixing row shapes.
DO $$
BEGIN
  IF EXISTS (SELECT * FROM reset_preserved_watches EXCEPT SELECT * FROM goldsky.watched_addresses)
    OR EXISTS (SELECT * FROM goldsky.watched_addresses EXCEPT SELECT * FROM reset_preserved_watches)
    OR EXISTS (SELECT * FROM reset_preserved_nonces EXCEPT SELECT * FROM relayer_nonces)
    OR EXISTS (SELECT * FROM relayer_nonces EXCEPT SELECT * FROM reset_preserved_nonces)
    OR EXISTS (SELECT * FROM reset_preserved_balances EXCEPT SELECT * FROM balance_snapshots)
    OR EXISTS (SELECT * FROM balance_snapshots EXCEPT SELECT * FROM reset_preserved_balances)
  THEN RAISE EXCEPTION 'Operational state changed'; END IF;
END $$;
COMMIT;
