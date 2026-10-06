import { decodeEventLog, getAddress, parseAbi, keccak256, stringToHex, createPublicClient, http, type Address, type Hex } from "viem";

import { HUB_CHAIN } from "../src/lib/chains";

const NAME_RENEWED = parseAbi([
	"event NameRenewed(uint256 indexed tokenId, string label, uint64 duration, uint64 newExpiry, address paymentToken, bytes32 indexed referrer, uint256 amount)",
]);
const V1_NAME_RENEWED = parseAbi(["event NameRenewed(uint256 indexed id, uint256 expires)"]);
const V1_METADATA = parseAbi(["function BASE_REGISTRAR() view returns (address)"]);

type ReceiptLog = { address: Address; data: Hex; topics: readonly Hex[] };

/** Read the authoritative ENS expiry from the same receipt as a Namepass renewal. */
export function parseEnsRenewalExpiry(
	logs: readonly ReceiptLog[],
	expected: { label: string; registrar: string; renewerV1: string; referrer: string; baseRegistrarV1?: string; paymentToken?: string },
): Date {
	const renewers = [expected.registrar, expected.renewerV1]
		.filter((address): address is string => Boolean(address))
		.map((address) => getAddress(address));
	const events = logs.flatMap((log) => {
		if (!renewers.includes(getAddress(log.address))) return [];
		try {
			const event = decodeEventLog({
				abi: NAME_RENEWED,
				data: log.data,
				topics: log.topics as [Hex, ...Hex[]],
				strict: true,
			});
			return event.eventName === "NameRenewed" ? [{ event, log }] : [];
		} catch {
			return [];
		}
	});
	if (events.length !== 1) {
		throw new Error("The receipt does not contain exactly one expected ENS renewal event.");
	}
	const args = events[0].event.args as {
		tokenId: bigint;
		label: string;
		newExpiry: bigint;
		paymentToken: Address;
		referrer: Hex;
	};
	if (
		args.label !== expected.label
		|| getAddress(args.paymentToken) !== getAddress(expected.paymentToken ?? HUB_CHAIN.usdcAddress)
		|| args.referrer.toLowerCase() !== expected.referrer.toLowerCase()
	) {
		throw new Error("The ENS renewal event does not match the expected Namepass renewal.");
	}
	let expiry = args.newExpiry;
	if (getAddress(events[0].log.address) === getAddress(expected.renewerV1)) {
		if (!expected.baseRegistrarV1 || /^0x0+$/.test(expected.baseRegistrarV1)) {
			throw new Error("The ENS V1 registrar is not configured for receipt verification.");
		}
		const id = BigInt(keccak256(stringToHex(expected.label)));
		const renewedAt = logs.indexOf(events[0].log);
		const renewals = logs.flatMap((log, index) => {
			// syncWrapper can emit a later zero-duration V1 renewal. The
			// registration extension occurs before the V2 renewer event.
			if (index >= renewedAt) return [];
			if (getAddress(log.address) !== getAddress(expected.baseRegistrarV1!)) return [];
			try {
				const event = decodeEventLog({ abi: V1_NAME_RENEWED, ...log, topics: log.topics as [Hex, ...Hex[]], strict: true });
				return event.args.id === id ? [{ expiry: event.args.expires, index }] : [];
			} catch { return []; }
		});
		if (renewals.length !== 1) {
			throw new Error("The receipt does not contain exactly one preceding ENS V1 registration renewal.");
		}
		expiry = renewals[0].expiry;
	}
	const milliseconds = expiry * 1_000n;
	if (milliseconds > 8_640_000_000_000_000n) throw new Error("The ENS expiry is outside the date range.");
	return new Date(Number(milliseconds));
}

const HELPER_USED = parseAbi(["event HelperUsed(address indexed helper, bytes32 indexed labelHash, address indexed wallet)"]);
const METADATA = parseAbi([
	"function ethRegistrar() view returns (address)",
	"function ethRenewerV1() view returns (address)",
	"function referrer() view returns (bytes32)",
]);

/** Bind expiry to the helper actually used, even if the pointer changed later in this block. */
export function receiptHelper(logs: readonly ReceiptLog[], label: string): Address {
	const matching = logs.flatMap((log) => {
		if (getAddress(log.address) !== getAddress(HUB_CHAIN.gatewayAddress!)) return [];
		try {
			const event = decodeEventLog({ abi: HELPER_USED, ...log, topics: log.topics as [Hex, ...Hex[]], strict: true });
			return event.args.labelHash === keccak256(stringToHex(label)) ? [event.args.helper] : [];
		} catch { return []; }
	});
	if (matching.length !== 1) throw new Error("The receipt has no unique gateway helper selection.");
	return matching[0];
}

export async function readReceiptEnsExpiry(logs: readonly ReceiptLog[], label: string, blockNumber: bigint): Promise<Date> {
	const helper = receiptHelper(logs, label);
	const rpcUrl = process.env[HUB_CHAIN.rpcEnv];
	if (!rpcUrl) throw new Error(`${HUB_CHAIN.rpcEnv} is not configured.`);
	const client = createPublicClient({ transport: http(rpcUrl) });
	if (await client.getChainId() !== HUB_CHAIN.chainId) throw new Error("The receipt RPC serves the wrong chain.");
	const [registrar, renewerV1, referrer] = await Promise.all([
		client.readContract({ address: helper, abi: METADATA, functionName: "ethRegistrar", blockNumber }),
		client.readContract({ address: helper, abi: METADATA, functionName: "ethRenewerV1", blockNumber }),
		client.readContract({ address: helper, abi: METADATA, functionName: "referrer", blockNumber }),
	]);
	const baseRegistrarV1 = logs.some(log => getAddress(log.address) === getAddress(renewerV1))
		? await client.readContract({ address: renewerV1, abi: V1_METADATA, functionName: "BASE_REGISTRAR", blockNumber })
		: undefined;
	return parseEnsRenewalExpiry(logs, { label, registrar, renewerV1, referrer, baseRegistrarV1 });
}
