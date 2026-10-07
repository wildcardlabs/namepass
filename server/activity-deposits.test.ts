import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import test from "node:test";
import { Pool } from "pg";

test("real activity query preserves pooled deposit identities and withholds incomplete or ambiguous breakdowns", { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  const fixture = `namepass_activity_${crypto.randomUUID().replace(/-/g, "")}`;
  const admin = new Pool({ connectionString: url.toString() });
  await admin.query(`CREATE DATABASE "${fixture}"`);
  url.pathname = `/${fixture}`;
  const db = new Pool({ connectionString: url.toString() });
  t.after(async () => { await db.end(); await admin.query(`DROP DATABASE "${fixture}"`); await admin.end(); });
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(file => /^000[0-8]_.*\.sql$/.test(file)).sort())
    await db.query(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  // Exercise the actual query and renewal mapper in a fresh process/database.
  const script = String.raw`
    import assert from 'node:assert/strict';import {Pool} from 'pg';
    import {activityDeposits} from './server/activity-deposits.ts';import {renewalActivity} from './server/reads.ts';
    import {depositAddress} from './src/lib/namepass.ts';import {keccak256,stringToHex,namehash} from 'viem';const labelHash=label=>keccak256(stringToHex(label)),ensNamehash=label=>namehash(label+'.eth');
    const pools=new Set(),connect=Pool.prototype.connect;Pool.prototype.connect=function(...args){pools.add(this);return connect.apply(this,args);};
    const db=new Pool({connectionString:process.env.DATABASE_URL});pools.add(db);
    const wallet=depositAddress('farcaster'), token='0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',sender='0x1111111111111111111111111111111111111111';
    const hash='0x'+'ab'.repeat(32), name=(await db.query("INSERT INTO names(normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at) VALUES('farcaster','farcaster.eth',$1,$2,$3,now()) RETURNING id",[labelHash('farcaster'),ensNamehash('farcaster'),wallet])).rows[0].id;
    async function event(id,type,block,index,facts,chain='11155111') {await db.query('INSERT INTO chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,facts) VALUES($1,$2,$3,$4,$5,$6,$7,now(),\'c\',$8)',[id,type==='Transfer'?'deposit':'namepass',type,chain,hash,index,block,facts]);}
    try {
      await event('previous','DepositProcessed',10,50,{wallet_address:wallet,amount:'500000',remaining_amount:'0'});
      await event('process','DepositProcessed',20,300,{wallet_address:wallet,amount:'1000000',remaining_amount:'0'});
      await event('renewal','Renewed',20,299,{label_hash:labelHash('farcaster'),executor_address:sender,amount_received:'1000000',gas_allowance:'100000',amount_applied:'900000',duration:'3547790',from_cctp:'false'});
      for(const [id,index] of [['credit-a',257],['credit-b',258]]) {
        await event(id,'Transfer',15,index,{amount:'500000'});
        await db.query("INSERT INTO deposits(event_id,name_id,chain_id,token_address,sender_address,amount,tx_hash,log_index,block_number,block_time,source,status) VALUES($1,$2,'11155111',$3,$4,500000,$5,$6,15,now(),'goldsky','finalized')",[id,name,token,sender,hash,index]);
      }
      const flow=(await db.query("INSERT INTO flows(name_id,deposit_event_id,renewal_event_id,origin_event_id,origin_chain_id,trigger,status,amount_detected,amount_processed) VALUES($1,'credit-a','renewal','process','11155111','automatic','settled',500000,1000000) RETURNING id",[name])).rows[0].id;
      const read=async()=> (await activityDeposits([flow])).get(flow);
      const initial=await read();assert.equal(initial.length,2);assert.deepEqual(initial.map(d=>d.logIndex),[257,258]);assert.equal(new Set(initial.map(d=>d.transactionHash)).size,1);
      const page=await renewalActivity(10,undefined,name);assert.equal(page.items.length,1);assert.deepEqual(page.items[0].renewal.sourceDeposits,initial);assert.equal(page.totalItems,1);
      await db.query("UPDATE chain_events SET canonical=false WHERE event_id='credit-b'");assert.equal(await read(),null);
      await db.query("UPDATE chain_events SET canonical=true WHERE event_id='credit-b'");
      await db.query("UPDATE chain_events SET facts=jsonb_set(facts,'{remaining_amount}','\"1\"') WHERE event_id='previous'");assert.equal(await read(),null);
      await db.query("UPDATE chain_events SET facts=jsonb_set(facts,'{remaining_amount}','\"0\"') WHERE event_id='previous'");
      await db.query("UPDATE chain_events SET facts=jsonb_set(facts,'{remaining_amount}','\"1\"') WHERE event_id='process'");assert.equal(await read(),null);
      await db.query("UPDATE chain_events SET facts=jsonb_set(facts,'{remaining_amount}','\"0\"') WHERE event_id='process'");
      await db.query("UPDATE deposits SET token_address=$1 WHERE event_id='credit-b'",[sender]);assert.equal(await read(),null);
      await db.query("UPDATE deposits SET token_address=$1 WHERE event_id='credit-b'",[token]);
      // Native Arc and ERC-20 Arc can pool, but a native index is not an ERC-20 log position.
      await db.query("UPDATE flows SET origin_chain_id=5042002 WHERE id=$1",[flow]);
      await db.query('UPDATE chain_events SET chain_id=5042002');
      await db.query("UPDATE deposits SET chain_id=5042002,token_address='0x3600000000000000000000000000000000000000'");
      await db.query("UPDATE flows SET deposit_event_id=null WHERE id=$1",[flow]);
      await db.query("DELETE FROM deposits WHERE event_id='credit-a'");await db.query("DELETE FROM chain_events WHERE event_id='credit-a'");
      await event('5042002:native:credit-a','Transfer',15,1,{amount:'500000'},'5042002');
      await db.query("INSERT INTO deposits(event_id,name_id,chain_id,token_address,sender_address,amount,tx_hash,log_index,block_number,block_time,source,status) VALUES('5042002:native:credit-a',$1,5042002,'0x3600000000000000000000000000000000000000',$2,500000,$3,1,15,now(),'goldsky','finalized')",[name,sender,hash]);
      assert.deepEqual((await read()).map(d=>d.logIndex),[null,258]);
      await db.query("UPDATE deposits SET block_number=20 WHERE event_id='5042002:native:credit-a'");assert.equal(await read(),null);
      console.log(JSON.stringify({sameHashDistinctDeposits:2,renewalRows:1,incompleteWithheld:true,partialWithheld:true,nativeAmbiguityWithheld:true}));
    } finally {await Promise.all([...pools].map(pool=>pool.end()));}
  `;
  const child = spawn(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), "--input-type=module", "-e", script], {
    cwd: new URL("../", import.meta.url), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => output += chunk); child.stderr.on("data", chunk => output += chunk);
  const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  assert.equal(code, 0, output);
});
