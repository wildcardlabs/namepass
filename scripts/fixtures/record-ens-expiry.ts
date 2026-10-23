/**
 * Records `test/fixtures/ens-expiry/sepolia.json`: read-only ENS state for a set of labels at one
 * block through the active adapter, plus one V1 renewal receipt from the hub factory.
 *
 *   ETHEREUM_SEPOLIA_RPC_URL=… node --import tsx scripts/fixtures/record-ens-expiry.ts <out.json> <renewalTx> <label> …
 */
import { writeFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, http, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { HUB_CHAIN } from "../../src/lib/chains";

const [out, renewalTx, ...labels] = process.argv.slice(2);
if (!out || !renewalTx || !labels.length) throw new Error("usage: <out.json> <renewalTx> <label> …");
const rpc = process.env[HUB_CHAIN.rpcEnv];
if (!rpc) throw new Error(`missing ${HUB_CHAIN.rpcEnv}`);
const client = createPublicClient({ transport: http(rpc, { timeout: 30_000 }) });
const abi = parseAbi([
	"function currentHelper() view returns (address)",
	"function ethRegistrar() view returns (address)",
	"function ethRenewerV1() view returns (address)",
	"function renewableBy(string) view returns (address)",
	"function nameState(string) view returns (uint64,address)",
	"function ETH_REGISTRY() view returns (address)",
	"function BASE_REGISTRAR() view returns (address)",
	"function GRACE_PERIOD() view returns (uint256)",
	"function nameExpires(uint256) view returns (uint256)",
	"function getState(uint256) view returns ((uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource))",
	"event NameRenewed(uint256 indexed id,uint256 expires)",
	"event NameRenewed(uint256 indexed tokenId,string label,uint64 duration,uint64 newExpiry,address paymentToken,bytes32 indexed referrer,uint256 amount)",
]);
const blockNumber = await client.getBlockNumber();
const read = <T,>(address: Address, functionName: any, args: readonly unknown[] = []) =>
	client.readContract({ address, abi, functionName, args: args as never, blockNumber }) as Promise<T>;
const factory = HUB_CHAIN.factoryAddress as Address;
const helper = await read<Address>(factory, "currentHelper");
const registrar = await read<Address>(helper, "ethRegistrar");
const renewerV1 = await read<Address>(helper, "ethRenewerV1");
const registry = await read<Address>(registrar, "ETH_REGISTRY");
const baseRegistrar = await read<Address>(renewerV1, "BASE_REGISTRAR");
const v1GraceSeconds = (await read<bigint>(baseRegistrar, "GRACE_PERIOD")).toString();
const v2GraceSeconds = await read<bigint>(registrar, "GRACE_PERIOD").then((v) => v.toString()).catch(() => null);
const names = [];
for (const label of labels) {
	const id = keccak256(stringToHex(label));
	const selected = await read<Address>(helper, "renewableBy", [label]);
	const [helperExpiry] = await read<[bigint, Address]>(helper, "nameState", [label]);
	const v1Expiry = await read<bigint>(baseRegistrar, "nameExpires", [BigInt(id)]);
	const state = await read<{ status: number; expiry: bigint; latestOwner: Address; tokenId: bigint; resource: bigint }>(registry, "getState", [BigInt(id)]);
	names.push({ label, selected, helperExpiry: helperExpiry.toString(), v1Expiry: v1Expiry.toString(), state: { status: state.status, expiry: state.expiry.toString(), latestOwner: state.latestOwner, tokenId: state.tokenId.toString(), resource: state.resource.toString() } });
	console.log(label, selected === renewerV1 ? "v1" : selected === registrar ? "registrar" : "none", "helperExpiry", helperExpiry.toString(), "v1Expiry", v1Expiry.toString());
}
// Raw receipt and block, as the node returns them, for the canonical-enrichment replay.
const raw = async (method: string, params: unknown[]) => {
	const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
	const body = await r.json(); if (body.error) throw new Error(JSON.stringify(body.error)); return body.result;
};
const canonicalReceipt = await raw("eth_getTransactionReceipt", [renewalTx]);
const canonicalBlock = await raw("eth_getBlockByNumber", [canonicalReceipt.blockNumber, false]);
const ensLogs = canonicalReceipt.logs.filter((l: any) => [baseRegistrar, renewerV1].map((a) => a.toLowerCase()).includes(l.address.toLowerCase()));
const renewalLogs = ensLogs.flatMap((l: any) => {
	try {
		const decoded = decodeEventLog({ abi, data: l.data, topics: l.topics });
		if (decoded.eventName !== "NameRenewed") return [];
		const args = Object.fromEntries(Object.entries(decoded.args as Record<string, unknown>).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
		return [{ address: l.address, logIndex: Number(BigInt(l.logIndex)), eventName: decoded.eventName, args }];
	} catch { return []; }
});
const record = {
	observedAt: new Date().toISOString(), readOnly: true, chainId: HUB_CHAIN.chainId, blockNumber: blockNumber.toString(),
	helper, renewerV1, registrar, baseRegistrar, registry, v1GraceSeconds, v2GraceSeconds, names,
	receipt: { transactionHash: canonicalReceipt.transactionHash, blockNumber: Number(BigInt(canonicalReceipt.blockNumber)), renewalLogs, logs: ensLogs.map((l: any) => ({ address: l.address, data: l.data, topics: l.topics, logIndex: Number(BigInt(l.logIndex)) })) },
	canonicalReceipt, canonicalBlock,
};
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(`wrote ${out} at block ${blockNumber}; renewal logs ${JSON.stringify(renewalLogs.map((l: any) => [l.logIndex, l.args.expires ?? l.args.newExpiry]))}`);
