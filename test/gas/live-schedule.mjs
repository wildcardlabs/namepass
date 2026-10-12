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

import { readFileSync } from "node:fs";
import { createPublicClient, http, encodeFunctionData, encodeDeployData, encodePacked, getContractAddress, keccak256, pad, stringToHex, toHex, parseAbi, getAddress } from "viem";

const RPC = process.env.LIVE_RPC ?? "https://sepolia.drpc.org";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const OLD_FACTORY = "0x2dCB5CA6b21372b43e37C35Da8D5D15160423150";
const OWNER = "0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6";
// Deterministic addresses for the current build, derived exactly as tools/protocol-deployment does.
const artifacts = JSON.parse(readFileSync(new URL("../../tools/protocol-deployment/artifacts.json", import.meta.url), "utf8"));
const SINGLETON = "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7";
const SALT_LABEL = process.env.SALT_LABEL ?? "namepass-two-contract-2026-10-12";
const salt = (name) => keccak256(stringToHex(`${SALT_LABEL}/${name}`));
const factoryInit = encodeDeployData({ abi: artifacts.NamepassFactory.abi, bytecode: artifacts.NamepassFactory.bytecode, args: [OWNER, 11155111n] });
const NEW_FACTORY = getContractAddress({ opcode: "CREATE2", from: SINGLETON, salt: salt("NamepassFactory"), bytecode: factoryInit });
const adapterInit = encodeDeployData({ abi: artifacts.ENSV2RenewalAdapter.abi, bytecode: artifacts.ENSV2RenewalAdapter.bytecode, args: [NEW_FACTORY, USDC, "0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3", "0xf2ece44980778966b8a0FccB3A9E339440f6e045", pad("0x1208a26faa0f4ac65b42098419eb4daa5e580ac6", { size: 32 })] });
const NEW_ADAPTER = getContractAddress({ opcode: "CREATE2", from: SINGLETON, salt: salt("ENSV2RenewalAdapter"), bytecode: adapterInit });
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
