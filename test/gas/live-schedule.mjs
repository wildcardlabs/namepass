// Measures both designs on the live Sepolia gas schedule without deploying anything.
//
// It asks an archive node to trace a `renew` call with state overrides: the merged factory and
// adapter code and storage, read from an Anvil fork where the deployment dry run has completed
// the Sepolia steps, are placed at their deterministic addresses, and the deposit wallet is given
// a USDC balance. The node executes with its own gas schedule, so the root `gasUsed` is what a
// transaction would pay today. The current release is measured the same way with only the
// balance override. Nothing is broadcast.
//
//   anvil --fork-url <sepolia rpc> --auto-impersonate --port 8545 &
//   DRY_RUN_RPC_11155111=http://127.0.0.1:8545 node --import tsx tools/protocol-deployment/dry-run.ts
//   LIVE_RPC=https://sepolia.drpc.org ANVIL_RPC=http://127.0.0.1:8545 node test/gas/live-schedule.mjs

import { createPublicClient, http, encodeFunctionData, encodePacked, keccak256, pad, toHex, parseAbi, getAddress } from "viem";

const RPC = process.env.LIVE_RPC ?? "https://sepolia.drpc.org";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const OLD_FACTORY = "0x2dCB5CA6b21372b43e37C35Da8D5D15160423150";
const NEW_FACTORY = "0x0b95a96ffB2740fB954FBc415c160D8418d23976";
const NEW_ADAPTER = "0x44C20C78378B22E9BBa4c2553b8D446329809878";
const OWNER = "0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6";
const AMOUNT = 27_110_000n;
const abi = parseAbi(["function renew(string label)", "function predictWallet(string label) view returns (address)"]);

const client = createPublicClient({ transport: http(RPC, { timeout: 120_000 }) });
const anvil = createPublicClient({ transport: http(process.env.ANVIL_RPC ?? "http://127.0.0.1:8545") });
const factoryCode = await anvil.getCode({ address: NEW_FACTORY });
const adapterCode = await anvil.getCode({ address: NEW_ADAPTER });
if (!factoryCode || !adapterCode) throw new Error("Run the deployment dry run on the Anvil fork first.");
const slots = {};
for (let i = 0n; i < 9n; i++) {
	const value = await anvil.getStorageAt({ address: NEW_FACTORY, slot: pad(toHex(i), { size: 32 }) });
	if (value && BigInt(value) !== 0n) slots[pad(toHex(i), { size: 32 })] = value;
}
const newContracts = { [NEW_FACTORY]: { code: factoryCode, state: slots }, [NEW_ADAPTER]: { code: adapterCode } };
const proxy = (factory) => `0x363d3d373d3d3d363d73${factory.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
const balanceSlot = (holder) => keccak256(encodePacked(["bytes32", "uint256"], [pad(holder, { size: 32 }), 9n]));

async function wallet(factory, label, overrides) {
	const data = encodeFunctionData({ abi, functionName: "predictWallet", args: [label] });
	const result = await client.request({ method: "eth_call", params: [{ to: factory, data }, "latest", overrides] });
	return getAddress(`0x${result.slice(-40)}`);
}

async function measure(tag, factory, label, base, deployed) {
	const w = await wallet(factory, label, base);
	const overrides = { ...base, [USDC]: { stateDiff: { [balanceSlot(w)]: pad(toHex(AMOUNT), { size: 32 }) } } };
	if (deployed) {
		const code = await client.getCode({ address: w });
		if (!code || code === "0x") overrides[w] = { code: proxy(factory) };
	}
	const data = encodeFunctionData({ abi, functionName: "renew", args: [label] });
	const trace = await client.request({
		method: "debug_traceCall",
		params: [{ from: OWNER, to: factory, data }, "latest", { tracer: "callTracer", stateOverrides: overrides }],
	});
	const status = trace.error ? `error: ${trace.error} ${trace.revertReason ?? ""}` : "ok";
	const children = (trace.calls ?? []).map((c) => `${parseInt(c.gasUsed, 16)}@${c.to?.slice(0, 10)}`).join(" ");
	console.log(`| ${tag} | ${parseInt(trace.gasUsed, 16).toLocaleString("en-US")} | ${status} |`);
	if (process.env.VERBOSE) console.log("   ", children);
}

console.log(`| Transaction, live Sepolia schedule at block ${await client.getBlockNumber()} | gasUsed | status |`);
console.log("| --- | --- | --- |");
for (const [route, label] of [["V1", "vitalik"], ["V2", "skellat"]]) {
	await measure(`current direct ${route}, first use`, OLD_FACTORY, label, {}, false);
	await measure(`current direct ${route}, steady state`, OLD_FACTORY, label, {}, true);
	await measure(`merged direct ${route}, first use`, NEW_FACTORY, label, newContracts, false);
	await measure(`merged direct ${route}, steady state`, NEW_FACTORY, label, newContracts, true);
}
