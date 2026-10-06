import {
	decodeEventLog,
	decodeFunctionResult,
	encodeFunctionData,
	getAddress,
	keccak256,
	parseAbi,
	sliceHex,
	stringToHex,
	toEventSelector,
	type Hex,
} from "viem";
import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { assertEnsV2Adapter } from "../src/lib/helperAdapter";
import { depositAddress, normalizeLabel } from "../src/lib/namepass";
import {
	parseOriginBurnReceipt,
	parseClaimReceipt,
	validateCctpMessage,
} from "../workflows/cctp";
import { parseEnsRenewalExpiry, receiptHelper } from "./ens-renewal";
import type { SourceBlock, SourceReceipt } from "./source-deposit-evidence";

const PROCESSED = parseAbi([
	"event DepositProcessed(bytes32 indexed labelKey,address indexed wallet,uint256 amount,uint256 remaining)",
]);
const RENEWED = parseAbi([
	"event Renewed(bytes32 indexed labelHash,address indexed wallet,address indexed executor,string label,uint64 duration,uint256 amountReceived,uint256 gasAllowance,uint256 amountApplied,uint256 remainder,bool fromCCTP)",
]);
const HELPER = parseAbi([
	"event HelperUsed(address indexed helper,bytes32 indexed labelHash,address indexed wallet)",
	"function ethRegistrar() view returns (address)",
	"function ethRenewerV1() view returns (address)",
	"function referrer() view returns (bytes32)",
]);
const ENS = parseAbi([
	"event NameRenewed(uint256 indexed tokenId,string label,uint64 duration,uint64 newExpiry,address paymentToken,bytes32 indexed referrer,uint256 amount)",
]);
const V1_METADATA = parseAbi(["function BASE_REGISTRAR() view returns (address)"]);
const MESSAGE = toEventSelector("MessageSent(bytes)");
// Reviewed runtime hashes in docs/deployments/2026-09-22/verification.json.
const FACTORY_HASH =
	"0x3822dfc2cbf9fe25fbe5258eb13cf8be999c1b776c361fbd220f9412b96659e1";
const GATEWAY_HASH =
	"0x71d0809dabeb74cd5002beb8a6e8fc9357b1e5a84eb90347863b3d8536fcc26e";
const METHODS = [
	"eth_chainId",
	"eth_getBlockByNumber",
	"eth_getTransactionReceipt",
	"eth_getCode",
	"eth_call",
];
type Log = SourceReceipt["logs"][number];
export type ProcessingRenewalInput = {
	chainId: string;
	label: string;
	processingTransactionHash: string;
	processingLogIndex: string;
	renewalTransactionHash: string;
	renewalLogIndex: string;
};
export type ProcessingRenewalTransport = {
	rpc(
		chainId: number,
		method: string,
		params: unknown[],
		signal: AbortSignal,
	): Promise<unknown>;
	messages(
		sourceDomain: number,
		transactionHash: string,
		signal: AbortSignal,
	): Promise<unknown>;
};
function fail(code: string): never {
	throw new Error(code);
}
function hash(value: string) {
	if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value))
		fail("invalid_renewal_hash");
	return value.toLowerCase();
}
function quantity(value: string) {
	if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))
		fail("invalid_renewal_quantity");
	return BigInt(value);
}
function position(value: string) {
	const n = quantity(value);
	if (n > 2147483647n) fail("invalid_renewal_position");
	return Number(n);
}
const address = (s: string) => getAddress(s).toLowerCase();
function rawIndex(value: string) {
	if (
		typeof value !== "string" ||
		!/^(0|[1-9][0-9]{0,9})$/.test(value) ||
		BigInt(value) > 2147483647n
	)
		fail("invalid_renewal_position");
	return Number(value);
}
function typedLogs(logs: readonly Log[]) {
	return logs.map((l) => ({
		address: l.address as Hex,
		data: l.data as Hex,
		topics: l.topics as [Hex, ...Hex[]],
		logIndex: position(l.logIndex),
	}));
}

/** One exact processing call joined to one renewal. Does not prove a source deposit or API completion. */
export async function inspectProcessingRenewal(
	input: ProcessingRenewalInput,
	transport: ProcessingRenewalTransport,
	cancellation?: AbortSignal,
) {
	const chain = SERVER_CHAINS.find((c) => String(c.chainId) === input.chainId);
	if (!chain?.factoryAddress || normalizeLabel(input.label) !== input.label)
		fail("invalid_processing_renewal_arguments");
	const processingHash = hash(input.processingTransactionHash),
		renewalHash = hash(input.renewalTransactionHash);
	const processingIndex = rawIndex(input.processingLogIndex),
		renewalIndex = rawIndex(input.renewalLogIndex);
	const wallet = address(depositAddress(input.label)),
		labelHash = keccak256(stringToHex(input.label));
	const signal = cancellation
		? AbortSignal.any([AbortSignal.timeout(15000), cancellation])
		: AbortSignal.timeout(15000);
	let rpcCalls = 0,
		irisReads = 0;
	async function bounded<T>(operation: () => Promise<unknown>): Promise<T> {
		signal.throwIfAborted();
		let abort = () => {};
		try {
			const stopped = new Promise<never>((_, reject) => {
				abort = () => reject(new Error("processing_renewal_deadline"));
				signal.addEventListener("abort", abort, { once: true });
			});
			return (await Promise.race([operation(), stopped])) as T;
		} finally {
			signal.removeEventListener("abort", abort);
		}
	}
	async function read<T>(
		id: number,
		method: string,
		params: unknown[],
	): Promise<T> {
		if (!METHODS.includes(method) || ++rpcCalls > 24)
			fail("processing_renewal_rpc_budget");
		return bounded<T>(() => transport.rpc(id, method, params, signal));
	}
	const blocks = new Map<string, SourceBlock>();
	async function block(id: number, number: string) {
		const key = `${id}:${quantity(number)}`;
		if (!blocks.has(key)) {
			const b = await read<SourceBlock>(id, "eth_getBlockByNumber", [
				number,
				false,
			]);
			if (!b || quantity(b.number) !== quantity(number))
				fail("inconsistent_renewal_block");
			hash(b.hash);
			quantity(b.timestamp);
			blocks.set(key, b);
		}
		return blocks.get(key)!;
	}
	const anchors = new Map<number, SourceBlock>();
	for (const id of new Set([chain.chainId, HUB_CHAIN.chainId])) {
		if (quantity(await read<string>(id, "eth_chainId", [])) !== BigInt(id))
			fail("wrong_processing_renewal_chain");
		const a = await read<SourceBlock>(id, "eth_getBlockByNumber", [
			"finalized",
			false,
		]);
		if (!a) fail("renewal_finality_unavailable");
		hash(a.hash);
		quantity(a.number);
		quantity(a.timestamp);
		anchors.set(id, a);
	}
	const receipts = new Map<string, SourceReceipt>();
	async function receipt(id: number, tx: string) {
		const key = `${id}:${tx}`;
		if (!receipts.has(key)) {
			const r = await read<SourceReceipt>(id, "eth_getTransactionReceipt", [
				tx,
			]);
			if (
				!r ||
				hash(r.transactionHash) !== tx ||
				quantity(r.status) !== 1n ||
				!Array.isArray(r.logs) ||
				r.logs.length > 10000
			)
				fail("invalid_processing_renewal_receipt");
			const b = await block(id, r.blockNumber);
			if (hash(b.hash) !== hash(r.blockHash))
				fail("noncanonical_processing_renewal");
			let previous = -1;
			for (const l of r.logs) {
				const at = position(l.logIndex);
				if (
					l.removed ||
					at <= previous ||
					hash(l.transactionHash) !== tx ||
					hash(l.blockHash) !== hash(r.blockHash) ||
					quantity(l.blockNumber) !== quantity(r.blockNumber) ||
					position(l.transactionIndex) !== position(r.transactionIndex)
				)
					fail("inconsistent_processing_renewal_log");
				previous = at;
			}
			receipts.set(key, r);
		}
		return receipts.get(key)!;
	}
	const origin = await receipt(chain.chainId, processingHash),
		hub = await receipt(HUB_CHAIN.chainId, renewalHash);
	const marker = origin.logs.find(
		(l) =>
			position(l.logIndex) === processingIndex &&
			address(l.address) === address(chain.factoryAddress!),
	);
	if (!marker) fail("processing_event_not_found");
	const processing = decodeEventLog({
		abi: PROCESSED,
		...typedLogs([marker])[0],
		strict: true,
	}).args;
	if (
		address(processing.wallet) !== wallet ||
		processing.labelKey.toLowerCase() !== labelHash ||
		processing.amount === 0n
	)
		fail("processing_identity_mismatch");
	const factory = await read<string>(chain.chainId, "eth_getCode", [
		chain.factoryAddress,
		origin.blockNumber,
	]);
	if (keccak256(factory as Hex) !== FACTORY_HASH)
		fail("unsupported_processing_factory");
	const proxy = await read<string>(chain.chainId, "eth_getCode", [
		wallet,
		origin.blockNumber,
	]);
	if (
		proxy.toLowerCase() !==
		`0x363d3d373d3d3d363d73${address(chain.factoryAddress).slice(2)}5af43d82803e903d91602b57fd5bf3`
	)
		fail("unsupported_processing_wallet");
	const gatewayCode = await read<string>(HUB_CHAIN.chainId, "eth_getCode", [
		HUB_CHAIN.gatewayAddress,
		hub.blockNumber,
	]);
	if (keccak256(gatewayCode as Hex) !== GATEWAY_HASH)
		fail("unsupported_renewal_gateway");
	const gatewayLogs = hub.logs.filter(
		(l) =>
			address(l.address) === address(HUB_CHAIN.gatewayAddress!) &&
			l.topics[0]?.toLowerCase() === toEventSelector(RENEWED[0]),
	);
	const selected = gatewayLogs.findIndex(
		(l) => position(l.logIndex) === renewalIndex,
	);
	if (selected < 0) fail("renewal_event_not_found");
	const renewalLog = gatewayLogs[selected],
		renewal = decodeEventLog({
			abi: RENEWED,
			...typedLogs([renewalLog])[0],
			strict: true,
		}).args;
	const previous = selected ? position(gatewayLogs[selected - 1].logIndex) : -1;
	const segment = hub.logs.filter(
		(l) =>
			position(l.logIndex) > previous && position(l.logIndex) <= renewalIndex,
	);
	if (
		renewal.label !== input.label ||
		renewal.labelHash.toLowerCase() !== labelHash ||
		address(renewal.wallet) !== wallet ||
		renewal.duration === 0n ||
		renewal.gasAllowance > renewal.amountReceived ||
		renewal.amountApplied + renewal.remainder !==
			renewal.amountReceived - renewal.gasAllowance
	)
		fail("renewal_identity_mismatch");
	let cctp: {
		messageIndex: number;
		nonce: string;
		claimLogIndex: number;
		feeExecuted: string;
	} | null = null;
	if (chain.chainId === HUB_CHAIN.chainId) {
		const earlier = origin.logs.filter(
			(l) =>
				address(l.address) === address(chain.factoryAddress!) &&
				l.topics[0]?.toLowerCase() === toEventSelector(PROCESSED[0]) &&
				position(l.logIndex) < processingIndex,
		);
		const prior = earlier[earlier.length - 1];
		const start = prior ? position(prior.logIndex) : -1;
		if (
			processingHash !== renewalHash ||
			renewal.fromCCTP ||
			renewal.amountReceived !== processing.amount ||
			renewalIndex <= start ||
			renewalIndex >= processingIndex ||
			origin.logs.filter(
				(l) =>
					address(l.address) === address(HUB_CHAIN.gatewayAddress!) &&
					l.topics[0]?.toLowerCase() === toEventSelector(RENEWED[0]) &&
					position(l.logIndex) > start &&
					position(l.logIndex) < processingIndex,
			).length !== 1
		)
			fail("direct_processing_renewal_mismatch");
	} else {
		if (!renewal.fromCCTP) fail("cross_chain_renewal_route_mismatch");
		const expected = {
			originChainId: chain.chainId,
			wallet: wallet as Hex,
			label: input.label,
			labelHash,
			amount: processing.amount,
		};
		const burn = parseOriginBurnReceipt(typedLogs(origin.logs), {
			...expected,
			depositLogIndex: processingIndex,
		});
		if (++irisReads > 1) fail("processing_renewal_iris_budget");
		const iris = await bounded<{
			sourceTxHash: string;
			messages: {
				status: string;
				cctpVersion: number;
				message: Hex;
				eventNonce: string;
			}[];
		}>(() => transport.messages(chain.circleDomain, processingHash, signal));
		const messageCount = origin.logs.filter(
			(l) =>
				address(l.address) === address(chain.messageTransmitterAddress) &&
				l.topics[0]?.toLowerCase() === MESSAGE,
		).length;
		if (
			!iris ||
			hash(iris.sourceTxHash) !== processingHash ||
			!Array.isArray(iris.messages) ||
			iris.messages.length !== messageCount ||
			messageCount > 256
		)
			fail("circle_message_coverage_mismatch");
		const entry = iris.messages[burn.messageIndex];
		if (!entry || entry.status !== "complete" || entry.cctpVersion !== 2)
			fail("circle_message_not_ready");
		const final = validateCctpMessage(entry.message, expected);
		if (
			!/^(?:0|[1-9][0-9]{0,77}|0x[0-9a-f]{64})$/i.test(entry.eventNonce) ||
			BigInt(entry.eventNonce) !== BigInt(final.nonce)
		)
			fail("circle_nonce_mismatch");
		// Circle assigns the nonce/finality/fee/expiration offchain. Every other source byte must agree.
		if (burn.message.raw.length !== entry.message.length)
			fail("circle_source_message_mismatch");
		for (const [from, to] of [
			[0, 12],
			[44, 144],
			[148, 312],
			[376, (burn.message.raw.length - 2) / 2],
		])
			if (
				sliceHex(burn.message.raw, from, to).toLowerCase() !==
				sliceHex(entry.message, from, to).toLowerCase()
			)
				fail("circle_source_message_mismatch");
		const settlement = parseClaimReceipt(typedLogs(segment), {
			...expected,
			nonce: final.nonce,
		});
		const claim = segment.find(
			(l) =>
				address(l.address) === address(HUB_CHAIN.gatewayAddress!) &&
				l.topics[0]?.toLowerCase() ===
					toEventSelector(
						"CCTPClaimed(bytes32,address,uint32,uint256,uint256,uint256)",
					),
		)!;
		const claimArgs = decodeEventLog({
			abi: parseAbi([
				"event CCTPClaimed(bytes32 indexed nonce,address indexed wallet,uint32 sourceDomain,uint256 burnAmount,uint256 feeExecuted,uint256 mintedAmount)",
			]),
			...typedLogs([claim])[0],
			strict: true,
		}).args;
		if (
			claimArgs.feeExecuted !== final.feeExecuted ||
			settlement.amountApplied !== renewal.amountApplied ||
			settlement.gasAllowance !== renewal.gasAllowance ||
			settlement.remaining !== renewal.remainder
		)
			fail("circle_claim_message_mismatch");
		cctp = {
			messageIndex: burn.messageIndex,
			nonce: final.nonce,
			claimLogIndex: position(claim.logIndex),
			feeExecuted: final.feeExecuted.toString(),
		};
	}
	const logs = typedLogs(segment),
		helper = receiptHelper(logs, input.label);
	const selections = segment.filter(
		(l) =>
			address(l.address) === address(HUB_CHAIN.gatewayAddress!) &&
			l.topics[0]?.toLowerCase() === toEventSelector(HELPER[0]),
	);
	if (
		selections.length !== 1 ||
		address(
			decodeEventLog({ abi: HELPER, ...typedLogs(selections)[0], strict: true })
				.args.wallet!,
		) !== wallet
	)
		fail("renewal_helper_wallet_mismatch");
	assertEnsV2Adapter(
		await read<string>(HUB_CHAIN.chainId, "eth_getCode", [
			helper,
			hub.blockNumber,
		]),
	);
	async function metadata(name: "ethRegistrar" | "ethRenewerV1" | "referrer") {
		const data = encodeFunctionData({ abi: HELPER, functionName: name });
		return decodeFunctionResult({
			abi: HELPER,
			functionName: name,
			data: await read<Hex>(HUB_CHAIN.chainId, "eth_call", [
				{ to: helper, data },
				hub.blockNumber,
			]),
		});
	}
	const registrar = await metadata("ethRegistrar"),
		renewerV1 = await metadata("ethRenewerV1"),
		referrer = await metadata("referrer");
	if (
		address(registrar) !== address(HUB_CHAIN.ensRegistrarAddress!) ||
		address(renewerV1) !== address(HUB_CHAIN.ensRenewerV1Address!) ||
		referrer.toLowerCase() !== HUB_CHAIN.ensReferrer!.toLowerCase()
	)
		fail("unsupported_renewal_ens_metadata");
	const baseRegistrarV1 = logs.some(log => address(log.address) === address(renewerV1))
		? decodeFunctionResult({
			abi: V1_METADATA, functionName: "BASE_REGISTRAR",
			data: await read<Hex>(HUB_CHAIN.chainId, "eth_call", [
				{ to: renewerV1, data: encodeFunctionData({ abi: V1_METADATA, functionName: "BASE_REGISTRAR" }) },
				hub.blockNumber,
			]),
		})
		: undefined;
	const expiry = parseEnsRenewalExpiry(logs, {
		label: input.label,
		registrar,
		renewerV1,
		referrer,
		baseRegistrarV1,
	});
	const ensLogs = segment.filter(
		(l) =>
			[address(registrar), address(renewerV1)].includes(address(l.address)) &&
			l.topics[0]?.toLowerCase() === toEventSelector(ENS[0]),
	);
	if (ensLogs.length !== 1) fail("ambiguous_processing_ens_renewal");
	const ens = decodeEventLog({
		abi: ENS,
		...typedLogs(ensLogs)[0],
		strict: true,
	}).args;
	if (ens.duration !== renewal.duration || ens.amount !== renewal.amountApplied)
		fail("processing_ens_renewal_mismatch");
	let providerFinalized = true;
	for (const [id, r] of [
		[chain.chainId, origin],
		[HUB_CHAIN.chainId, hub],
	] as const) {
		const b = await block(id, r.blockNumber),
			a = anchors.get(id)!;
		if (quantity(r.blockNumber) > quantity(a.number)) providerFinalized = false;
		else if (
			quantity(b.timestamp) > quantity(a.timestamp) ||
			(quantity(r.blockNumber) === quantity(a.number) &&
				hash(r.blockHash) !== hash(a.hash))
		)
			fail("inconsistent_processing_renewal_finality");
	}
	// Recheck receipt blocks and the numbered finality anchors after the whole inspection.
	for (const [key, b] of blocks) {
		const id = Number(key.split(":")[0]);
		const fresh = await read<SourceBlock>(id, "eth_getBlockByNumber", [
			b.number,
			false,
		]);
		if (
			!fresh ||
			hash(fresh.hash) !== hash(b.hash) ||
			quantity(fresh.number) !== quantity(b.number)
		)
			fail("processing_renewal_block_changed");
	}
	for (const [id, a] of anchors) {
		const fresh = await read<SourceBlock>(id, "eth_getBlockByNumber", [
			a.number,
			false,
		]);
		if (
			!fresh ||
			hash(fresh.hash) !== hash(a.hash) ||
			quantity(fresh.number) !== quantity(a.number)
		)
			fail("processing_renewal_anchor_changed");
	}
	return {
		scope: "one processing call to one ENS renewal" as const,
		processingId: `${input.chainId}:${processingHash}:${processingIndex}`,
		processingBlockNumber: quantity(origin.blockNumber).toString(),
		processingBlockHash: hash(origin.blockHash),
		renewalId: `${HUB_CHAIN.chainId}:${renewalHash}:${renewalIndex}`,
		renewalBlockNumber: quantity(hub.blockNumber).toString(),
		renewalBlockHash: hash(hub.blockHash),
		name: `${input.label}.eth`,
		depositAddress: wallet,
		sourceChainId: input.chainId,
		chainId: String(HUB_CHAIN.chainId),
		transactionHash: renewalHash,
		secondsAdded: renewal.duration.toString(),
		amountApplied: renewal.amountApplied.toString(),
		renewalFee: renewal.gasAllowance.toString(),
		expiry: expiry.toISOString(),
		ensLogIndex: position(ensLogs[0].logIndex),
		cctp,
		providerFinalized,
		anchors: [...anchors].map(([chainId, b]) => ({
			chainId: String(chainId),
			number: quantity(b.number).toString(),
			hash: hash(b.hash),
		})),
		rpcCalls,
		irisReads,
		limitations:
			"Not API completion: source-deposit membership, allocation windows, watch coverage and route finality policy remain separate gates. Finality relies on the configured providers' finalized anchors; this is not a light-client proof.",
	};
}
