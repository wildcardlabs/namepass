import { BaseError, ContractFunctionRevertedError, createPublicClient, http, parseAbi, zeroAddress, type Address } from "viem";
import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { assertEnsV2Adapter } from "../src/lib/helperAdapter";
import { normalizeLabel, InvalidLabelError } from "../src/lib/namepass";
import { minimumTriggerAmount } from "./config";
import { ApiError, json, requiredString } from "./http";
import { logOperation } from "./log";
import { readPublicObject } from "./public-json";

const ABI = parseAbi([
	"function currentHelper() view returns (address)", "function gateway() view returns (address)",
	"function pointer() view returns (address)", "function factory() view returns (address)",
	"function paymentToken() view returns (address)", "function interfaceVersion() view returns (uint256)",
	"function GAS_ALLOWANCE() view returns (uint256)",
	"function quote(string label,uint256 budget) view returns (uint64 duration,uint256 needed)",
	"function usdc() view returns (address)", "function tokenMessenger() view returns (address)",
	"function l1Helper() view returns (address)", "function finality() view returns (uint32)",
	"function localMinter() view returns (address)",
	"function burnLimitsPerMessage(address token) view returns (uint256)",
	"error NameNotRenewable()", "error DurationOverflow()", "error InsufficientAmount()",
]);
const HEADERS = {
	"cache-control": "no-store", "access-control-allow-origin": "*",
	"access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "Content-Type",
	"access-control-expose-headers": "Retry-After", "x-content-type-options": "nosniff",
};
const UINT256_MAX = (1n << 256n) - 1n;
let activeRequests = 0;

function unavailable(code = "pricing_unavailable"): never {
	throw new ApiError(503, code, "A verified renewal quote is not available. Try again later.");
}
function same(actual: string, expected: string) {
	if (actual.toLowerCase() !== expected.toLowerCase()) unavailable();
}

async function quote(request: Request, signal: AbortSignal) {
	const input = await readPublicObject(request, ["name", "chainId", "amount"], signal);
	let label: string;
	try { label = normalizeLabel(requiredString(input, "name", 255)); }
	catch (error) {
		if (error instanceof InvalidLabelError) throw new ApiError(400, "invalid_name", error.message);
		throw error;
	}
	const chainId = requiredString(input, "chainId", 16);
	const source = SERVER_CHAINS.find(chain => String(chain.chainId) === chainId);
	if (!source) throw new ApiError(400, "unsupported_chain", "Use a supported funding chain ID.");
	const rawAmount = requiredString(input, "amount", 78);
	if (!/^(0|[1-9][0-9]*)$/.test(rawAmount) || BigInt(rawAmount) > UINT256_MAX) {
		throw new ApiError(400, "invalid_amount", "amount must be an unsigned uint256 decimal string.");
	}
	const amount = BigInt(rawAmount);
	if (amount < minimumTriggerAmount(source.chainId)) {
		throw new ApiError(422, "amount_below_minimum", "The amount is below the processing minimum.");
	}

	// One request owns its clients, deadline and RPC budget. No cross-request configuration cache.
	let operations = 0;
	const clients = new Map<number, ReturnType<typeof createPublicClient>>();
	const clientFor = (chain: typeof source) => {
		const existing = clients.get(chain.chainId);
		if (existing) return existing;
		const url = process.env[chain.rpcEnv];
		if (!url) unavailable();
		const client = createPublicClient({ cacheTime: 0, transport: http(url, {
			batch: { wait: 0 }, retryCount: 0, timeout: 10_000,
			fetchFn: async (url, init) => {
				const payload = JSON.parse(String(init?.body));
				const calls = Array.isArray(payload) ? payload : [payload];
				operations += calls.length;
				if (operations > 24 || calls.some(call => !["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(call.method))) unavailable();
				return fetch(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
			},
		}) });
		clients.set(chain.chainId, client);
		return client;
	};
	const hubDefinition = SERVER_CHAINS.find(chain => chain.chainId === HUB_CHAIN.chainId)!;
	const hub = clientFor(hubDefinition);
	if (await hub.getChainId() !== HUB_CHAIN.chainId) unavailable();
	const hubBlock = await hub.getBlock({ blockTag: "latest" });
	const read = <F extends Extract<(typeof ABI)[number], { type: "function" }>["name"]>(address: string, functionName: F, args?: readonly unknown[]) =>
		hub.readContract({ address: address as Address, abi: ABI, functionName, args: args as never, blockNumber: hubBlock.number });
	const [helper, pointerGateway, gatewayPointer, allowance] = await Promise.all([
		read(HUB_CHAIN.pointerAddress!, "currentHelper"), read(HUB_CHAIN.pointerAddress!, "gateway"),
		read(HUB_CHAIN.gatewayAddress!, "pointer"), read(HUB_CHAIN.gatewayAddress!, "GAS_ALLOWANCE"),
	]);
	same(pointerGateway as string, HUB_CHAIN.gatewayAddress!);
	same(gatewayPointer as string, HUB_CHAIN.pointerAddress!);
	const selected = helper as Address;
	assertEnsV2Adapter(await hub.getCode({ address: selected, blockNumber: hubBlock.number }));
	const [version, boundGateway, boundFactory, token] = await Promise.all([
		read(selected, "interfaceVersion"), read(selected, "gateway"), read(selected, "factory"),
		read(selected, "paymentToken"),
	]);
	if (version !== 1n) unavailable();
	same(boundGateway as string, HUB_CHAIN.gatewayAddress!);
	same(boundFactory as string, HUB_CHAIN.factoryAddress!);
	same(token as string, HUB_CHAIN.usdcAddress);
	const fee = allowance as bigint;
	if (amount <= fee) throw new ApiError(422, "amount_below_minimum", "The amount cannot cover the processing allowance.");

	let sourceBlock = hubBlock;
	let sourceClient = hub;
	if (source.chainId !== HUB_CHAIN.chainId) {
		sourceClient = clientFor(source);
		if (await sourceClient.getChainId() !== source.chainId) unavailable();
		sourceBlock = await sourceClient.getBlock({ blockTag: "latest" });
		const sourceRead = (address: string, functionName: Extract<(typeof ABI)[number], { type: "function" }>["name"], args?: readonly unknown[]) =>
			sourceClient.readContract({ address: address as Address, abi: ABI, functionName, args: args as never, blockNumber: sourceBlock.number });
		const [sourceToken, messenger, recipient, finality] = await Promise.all([
			sourceRead(source.factoryAddress!, "usdc"), sourceRead(source.factoryAddress!, "tokenMessenger"),
			sourceRead(source.factoryAddress!, "l1Helper"), sourceRead(source.factoryAddress!, "finality"),
		]);
		same(sourceToken as string, source.usdcAddress);
		same(messenger as string, source.tokenMessengerAddress!);
		same(recipient as string, HUB_CHAIN.gatewayAddress!);
		if (finality !== 2000) unavailable("unsupported_bridge_configuration");
		const minter = await sourceRead(source.tokenMessengerAddress!, "localMinter") as Address;
		if (minter === zeroAddress) unavailable();
		const limit = await sourceRead(minter, "burnLimitsPerMessage", [source.usdcAddress]) as bigint;
		if (limit === 0n) unavailable("burns_disabled");
		if (amount > limit) throw new ApiError(422, "amount_above_quote_limit", "The amount exceeds the single-flow quote limit.", { maximumAmount: limit.toString() });
	}
	// Namepass currently executes Standard transfers with a zero bridge-fee allowance.
	// Future fee-bearing routes need explicit support, not a fee service in this adapter.
	const budget = amount - fee;
	let result: readonly [bigint, bigint];
	try {
		result = await read(HUB_CHAIN.gatewayAddress!, "quote", [label, budget]) as readonly [bigint, bigint];
	} catch (cause) {
		const revert = cause instanceof BaseError ? cause.walk(error => error instanceof ContractFunctionRevertedError) : undefined;
		if (revert instanceof ContractFunctionRevertedError) {
			if (revert.data?.errorName === "NameNotRenewable") throw new ApiError(422, "name_not_renewable", "This name cannot currently be renewed.");
			if (revert.data?.errorName === "DurationOverflow") throw new ApiError(422, "unsupported_duration", "The amount exceeds the supported renewal duration.");
			if (revert.data?.errorName === "InsufficientAmount") throw new ApiError(422, "amount_below_minimum", "The amount cannot buy a supported renewal duration.");
		}
		throw cause;
	}
	const [seconds, applied] = result;
	if (seconds === 0n) throw new ApiError(422, "amount_below_minimum", "The amount cannot buy a supported renewal duration.");
	if (applied > budget || applied === 0n) unavailable();
	const blocks = await Promise.all([
		hub.getBlock({ blockNumber: hubBlock.number }),
		...(sourceClient !== hub ? [sourceClient.getBlock({ blockNumber: sourceBlock.number })] : []),
	]);
	if (blocks[0].hash !== hubBlock.hash || (blocks[1] && blocks[1].hash !== sourceBlock.hash)) unavailable();
	return {
		name: `${label}.eth`, chainId, amount: rawAmount, secondsAdded: seconds.toString(),
		amountApplied: applied.toString(), renewalFee: fee.toString(), bridgeFee: "0",
		roundingRemainder: (budget - applied).toString(), pricingBlock: hubBlock.number.toString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(), estimate: true,
	};
}

export const publicQuote = {
	async fetch(request: Request): Promise<Response> {
		const requestId = crypto.randomUUID();
		const error = (status: number, code: string, message: string, details?: Record<string, unknown>) => json(
			{ error: { code, message, ...(details ? { details } : {}) }, requestId }, status,
			{ ...HEADERS, ...(status === 429 || status === 503 ? { "retry-after": "5" } : {}) },
		);
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
		if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST." }, requestId }, 405, { ...HEADERS, allow: "POST, OPTIONS" });
		if (process.env.NAMEPASS_PUBLIC_QUOTE_ENABLED !== "1") return error(503, "api_unavailable", "The quote API is not enabled.");
		if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return error(415, "unsupported_media_type", "Use application/json.");
		if (activeRequests >= 2) return error(429, "quote_capacity", "Quote capacity is busy. Retry after the indicated delay.");
		activeRequests++;
		const controller = new AbortController();
		try {
			const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(10_000)]);
			const result = await quote(request, signal);
			logOperation("public_quote.response", { requestId, step: "quote" });
			return json(result, 200, HEADERS);
		} catch (cause) {
			logOperation("public_quote.error", { requestId, step: "quote", errorCode: cause instanceof ApiError ? cause.code : "pricing_unavailable" });
			if (cause instanceof ApiError) return error(cause.status, cause.code, cause.message, cause.details);
			return error(503, "pricing_unavailable", "A verified renewal quote is not available. Try again later.");
		} finally { controller.abort(); activeRequests--; }
	},
};
