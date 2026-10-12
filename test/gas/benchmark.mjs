// Receipt-level gas benchmark on an Anvil fork of Sepolia.
//
// Usage:
//   anvil --fork-url $RPC --fork-block-number <block> --auto-impersonate --port 8545 &
//   forge build
//   node test/gas/benchmark.mjs
//
// It deploys the two-contract design from the local artifacts, exercises the direct V1 route and a
// CCTP claim (with Circle's transmitter replaced by BenchTransmitter), and runs the same flows
// against the deployed five-contract testnet release for comparison. Every figure is `gasUsed`
// from a mined transaction receipt, which is what a relayer pays: intrinsic gas, calldata, cold
// accesses and the EIP-3529 refund cap included. Nothing is broadcast outside the local Anvil.

import { readFileSync } from "node:fs";
import {
	createPublicClient,
	createWalletClient,
	createTestClient,
	http,
	encodeFunctionData,
	encodePacked,
	keccak256,
	pad,
	toHex,
	parseAbi,
	getAddress,
	concat,
} from "viem";

const RPC = process.env.ANVIL_RPC ?? "http://127.0.0.1:8545";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const REGISTRAR = "0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3";
const V1 = "0xf2ece44980778966b8a0FccB3A9E339440f6e045";
const TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const OLD_FACTORY = "0x2dCB5CA6b21372b43e37C35Da8D5D15160423150";
const OLD_GATEWAY = "0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f";
const USDC_BALANCE_SLOT = 9n;
const LABEL = "vitalik";
const AMOUNT = 27_110_000n;
const REFERRER = pad("0x1208", { size: 32 });

const chain = { id: 11155111, name: "anvil-sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const [deployer] = await pub.request({ method: "eth_accounts" });
const wallet = createWalletClient({ chain, transport: http(RPC), account: deployer });

const artifact = (path) => JSON.parse(readFileSync(new URL(`../../out/${path}`, import.meta.url), "utf8"));
const factoryArtifact = artifact("NamepassFactory.sol/NamepassFactory.json");
const adapterArtifact = artifact("ENSV2RenewalAdapter.sol/ENSV2RenewalAdapter.json");
const dummyArtifact = artifact("Mocks.sol/Dummy.json");
const transmitterArtifact = artifact("BenchTransmitter.sol/BenchTransmitter.json");
const oldFactoryAbi = parseAbi(["function renew(string label)", "function predictWallet(string label) view returns (address)"]);
const oldGatewayAbi = parseAbi(["function completeCCTP(bytes message, bytes attestation)"]);
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

async function mined(hash) {
	const receipt = await pub.waitForTransactionReceipt({ hash });
	if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
	return receipt;
}

async function deploy(art, args, account = deployer) {
	const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args, account });
	return getAddress((await mined(hash)).contractAddress);
}

async function setUsdcBalance(holder, amount) {
	const slot = keccak256(encodePacked(["bytes32", "uint256"], [pad(holder, { size: 32 }), USDC_BALANCE_SLOT]));
	await test.setStorageAt({ address: USDC, index: slot, value: pad(toHex(amount), { size: 32 }) });
}

async function send(to, data, account = deployer, label) {
	const hash = await wallet.sendTransaction({ to, data, account });
	const receipt = await mined(hash);
	return { label, gasUsed: receipt.gasUsed };
}

function cctpMessage(recipient, destination, sourceWallet, amount, nonce) {
	const header = encodePacked(
		["uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "uint32", "uint32"],
		[1, 6, 0, pad(toHex(nonce), { size: 32 }), pad("0x00", { size: 32 }), pad(MESSENGER, { size: 32 }), pad(destination, { size: 32 }), 2000, 2000],
	);
	const body = encodePacked(
		["uint32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256", "uint256", "bytes"],
		[1, pad("0x00", { size: 32 }), pad(destination, { size: 32 }), amount, pad(sourceWallet, { size: 32 }), 0n, 0n, 0n, toHex(LABEL)],
	);
	recipient;
	return concat([header, body]);
}

const rows = [];

// Two-contract design from local artifacts.
const factory = await deploy(factoryArtifact, [deployer, 11155111n]);
const governance = await deploy(dummyArtifact, []);
await mined(await wallet.writeContract({ address: factory, abi: factoryArtifact.abi, functionName: "initialize", args: [USDC, MESSENGER, TRANSMITTER, governance] }));
const adapter = await deploy(adapterArtifact, [factory, USDC, REGISTRAR, V1, REFERRER]);
await test.impersonateAccount({ address: governance });
await test.setBalance({ address: governance, value: 10n ** 18n });
await mined(await wallet.writeContract({ address: factory, abi: factoryArtifact.abi, functionName: "setHelper", args: [adapter], account: governance }));
const newWallet = await pub.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "predictWallet", args: [LABEL] });

const renewNew = encodeFunctionData({ abi: factoryArtifact.abi, functionName: "renew", args: [LABEL] });
for (const tag of ["first use", "steady state", "steady state"]) {
	await setUsdcBalance(newWallet, AMOUNT);
	rows.push(await send(factory, renewNew, deployer, `merged direct V1, ${tag}`));
}

// Five-contract release already deployed on Sepolia.
const oldWallet = await pub.readContract({ address: OLD_FACTORY, abi: oldFactoryAbi, functionName: "predictWallet", args: [LABEL] });
const renewOld = encodeFunctionData({ abi: oldFactoryAbi, functionName: "renew", args: [LABEL] });
for (const tag of ["first use", "steady state", "steady state"]) {
	await setUsdcBalance(oldWallet, AMOUNT);
	rows.push(await send(OLD_FACTORY, renewOld, deployer, `current direct V1, ${tag}`));
}

// CCTP claims with Circle's transmitter replaced by the benchmark stand-in, pre-funded.
await test.setCode({ address: TRANSMITTER, bytecode: transmitterArtifact.deployedBytecode.object });
await setUsdcBalance(TRANSMITTER, 10n * AMOUNT);
let nonce = 0xc0ffee;
for (const tag of ["first claim", "steady state", "steady state"]) {
	const message = cctpMessage(MESSENGER, factory, newWallet, AMOUNT, nonce++);
	const data = encodeFunctionData({ abi: factoryArtifact.abi, functionName: "completeCCTP", args: [message, "0x1234"] });
	rows.push(await send(factory, data, deployer, `merged CCTP claim, ${tag}`));
}
for (const tag of ["first claim", "steady state", "steady state"]) {
	const message = cctpMessage(MESSENGER, OLD_GATEWAY, oldWallet, AMOUNT, nonce++);
	const data = encodeFunctionData({ abi: oldGatewayAbi, functionName: "completeCCTP", args: [message, "0x1234"] });
	rows.push(await send(OLD_GATEWAY, data, deployer, `current CCTP claim, ${tag}`));
}

const block = await pub.getBlockNumber();
console.log(`fork head ${block}; executor ${deployer}; wallet balance after ${await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [newWallet] })}`);
console.log("| Transaction | gasUsed |");
console.log("| --- | --- |");
for (const row of rows) console.log(`| ${row.label} | ${row.gasUsed.toLocaleString("en-US")} |`);
