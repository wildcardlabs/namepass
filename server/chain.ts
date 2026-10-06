import { keccak_256 } from "@noble/hashes/sha3";

import { discoverHelper, readEnsV2Metadata } from "../src/lib/helperDiscovery";
import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";

const text = new TextEncoder();

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function selector(signature: string): string {
	return hex(keccak_256(text.encode(signature))).slice(0, 8);
}

function encodeString(value: string): string {
	const bytes = text.encode(value);
	const padding = (32 - (bytes.length % 32)) % 32;
	return (
		"20".padStart(64, "0") +
		bytes.length.toString(16).padStart(64, "0") +
		hex(bytes) +
		"00".repeat(padding)
	);
}

function word(value: string): bigint {
	if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("The RPC response is not one ABI word.");
	return BigInt(`0x${value}`);
}

function addressWord(value: string): string {
	const valueAsNumber = word(value);
	if (valueAsNumber >= 1n << 160n) throw new Error("The RPC address word has non-zero padding.");
	return `0x${valueAsNumber.toString(16).padStart(40, "0")}`;
}

async function calls(
	rpcUrl: string,
	requests: Array<{ to: string; signature: string; args?: string }>,
	blockTag = "latest",
	signal?: AbortSignal,
): Promise<string[]> {
	const response = await fetch(rpcUrl, {
		signal,
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(
			requests.map((request, id) => ({
				jsonrpc: "2.0",
				id,
				method: "eth_call",
				params: [{ to: request.to, data: `0x${selector(request.signature)}${request.args ?? ""}` }, blockTag],
			})),
		),
	});
	if (!response.ok) throw new Error(`The RPC returned HTTP ${response.status}.`);
	const payload = (await response.json()) as Array<{
		id: number;
		result?: string;
		error?: { message?: string };
	}>;
	if (!Array.isArray(payload)) throw new Error("The RPC response is not a batch.");

	const results = new Array<string>(requests.length);
	const seen = new Set<number>();
	for (const row of payload) {
		if (!Number.isInteger(row.id) || row.id < 0 || row.id >= requests.length || seen.has(row.id)) {
			throw new Error("The RPC response has an invalid ID.");
		}
		seen.add(row.id);
		if (row.error || typeof row.result !== "string") {
			throw new Error(row.error?.message ?? "The RPC response has no result.");
		}
		results[row.id] = row.result.replace(/^0x/, "");
	}
	if (seen.size !== requests.length) throw new Error("The RPC response is incomplete.");
	return results;
}

const verifiedReadRpcs = new Map<string, Promise<void>>();

async function verifyRpcChainId(rpcUrl: string, expected: number, signal?: AbortSignal): Promise<void> {
	const response = await fetch(rpcUrl, {
		signal,
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "eth_chainId", params: [] }),
	});
	if (!response.ok) throw new Error(`The RPC returned HTTP ${response.status}.`);
	const payload = (await response.json()) as { id?: unknown; result?: unknown; error?: { message?: string } };
	if (payload.id !== 0 || payload.error || typeof payload.result !== "string" || !/^0x[0-9a-f]+$/i.test(payload.result)) {
		throw new Error(payload.error?.message ?? "The RPC chain ID response is invalid.");
	}
	if (BigInt(payload.result) !== BigInt(expected)) {
		throw new Error(`The RPC reports chain ${BigInt(payload.result)}, expected ${expected}.`);
	}
}

/** A warm function verifies each read endpoint once. Transaction writers verify every gas-spending step. */
async function assertRpcChainId(rpcUrl: string, expected: number, signal?: AbortSignal): Promise<void> {
	// Request-scoped cancellation must not enter the shared verification cache.
	if (signal) return verifyRpcChainId(rpcUrl, expected, signal);
	const key = `${expected}:${rpcUrl}`;
	let verification = verifiedReadRpcs.get(key);
	if (!verification) {
		verification = verifyRpcChainId(rpcUrl, expected);
		verifiedReadRpcs.set(key, verification);
	}
	try {
		await verification;
	} catch (error) {
		verifiedReadRpcs.delete(key);
		throw error;
	}
}

async function readBlockNumber(rpcUrl: string, signal?: AbortSignal): Promise<string> {
	const response = await fetch(rpcUrl, {
		signal,
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "eth_blockNumber", params: [] }),
	});
	if (!response.ok) throw new Error(`The RPC returned HTTP ${response.status}.`);
	const payload = (await response.json()) as { id?: unknown; result?: unknown; error?: { message?: string } };
	if (payload.id !== 0 || payload.error || typeof payload.result !== "string" || !/^0x[0-9a-f]+$/i.test(payload.result)) {
		throw new Error(payload.error?.message ?? "The RPC block number response is invalid.");
	}
	return BigInt(payload.result).toString(10);
}

function hubRpcUrl(): string {
	const value = process.env[HUB_CHAIN.rpcEnv];
	if (!value) throw new Error(`${HUB_CHAIN.rpcEnv} is not configured.`);
	return value;
}

export interface EnsState {
	expiry: Date | null;
	renewableBy: "registrar" | "v1" | null;
}

export async function readEnsState(label: string, signal?: AbortSignal): Promise<EnsState> {
	const rpcUrl = hubRpcUrl();
	await assertRpcChainId(rpcUrl, HUB_CHAIN.chainId, signal);
	const blockTag = `0x${BigInt(await readBlockNumber(rpcUrl, signal)).toString(16)}`;
	const read = (requests: import("../src/lib/helperDiscovery").HelperCall[]) => calls(
		rpcUrl, requests.map((request) => ({ ...request, args: request.args?.join("") })), blockTag, signal,
	);
	const helper = await discoverHelper(read);
	const metadata = await readEnsV2Metadata(read, helper);
	const [state] = await read([{ to: helper, signature: "nameState(string)", args: [encodeString(label)] }]);
	if (!/^[0-9a-f]{128}$/i.test(state)) throw new Error("Invalid helper name state.");
	let rawExpiry = state.slice(0, 64);
	const renewer = addressWord(state.slice(64));
	if (!/^0x0+$/.test(renewer) && renewer !== metadata.registrar && renewer !== metadata.renewerV1) {
		throw new Error("The helper returned an unknown ENS renewer.");
	}
	let isV1 = renewer === metadata.renewerV1;
	if (/^0x0+$/.test(renewer) && word(rawExpiry) !== 0n) {
		// Beyond grace neither renewer accepts the name. A reservation has no
		// latest V2 owner; a migrated registration retains its latest owner.
		const [registryWord] = await read([{ to: metadata.registrar, signature: "ETH_REGISTRY()" }]);
		const registry = addressWord(registryWord);
		const [registryState] = await read([{ to: registry, signature: "getState(uint256)", args: [labelHash(label).slice(2)] }]);
		if (!/^[0-9a-f]{320}$/i.test(registryState)) throw new Error("Invalid ENS registry state.");
		isV1 = /^0x0+$/.test(addressWord(registryState.slice(128, 192)));
	}
	if (isV1) {
		// The helper's expiry is the V2 reservation (V1 expiry plus the
		// premigration bonus). Read the registration itself, without offsets.
		const [baseWord] = await read([{ to: metadata.renewerV1, signature: "BASE_REGISTRAR()" }]);
		const base = addressWord(baseWord);
		if (/^0x0+$/.test(base)) throw new Error("The ENS V1 registrar is not configured.");
		[rawExpiry] = await read([{ to: base, signature: "nameExpires(uint256)", args: [labelHash(label).slice(2)] }]);
	}
	const seconds = word(rawExpiry);
	if (seconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) {
		throw new Error("The ENS expiry is outside the supported date range.");
	}
	const expiry = seconds === 0n ? null : new Date(Number(seconds) * 1000);
	if (expiry && !Number.isFinite(expiry.getTime())) {
		throw new Error("The ENS expiry is outside the supported date range.");
	}

	return {
		expiry,
		renewableBy: renewer === metadata.registrar ? "registrar" : renewer === metadata.renewerV1 ? "v1" : null,
	};
}

export interface BalanceRead {
	chainId: number;
	amount?: string;
	blockNumber?: string;
}

export async function readNativeUsdcBalances(
	address: string,
	chainIds = SERVER_CHAINS.map((chain) => chain.chainId),
): Promise<BalanceRead[]> {
	const wanted = new Set(chainIds);
	return Promise.all(
		SERVER_CHAINS.filter((chain) => wanted.has(chain.chainId)).map(async (chain) => {
			const rpcUrl = process.env[chain.rpcEnv];
			if (!rpcUrl) return { chainId: chain.chainId };
			try {
				await assertRpcChainId(rpcUrl, chain.chainId);
				const [raw] = await calls(rpcUrl, [
					{
						to: chain.usdcAddress,
						signature: "balanceOf(address)",
						args: address.replace(/^0x/, "").toLowerCase().padStart(64, "0"),
					},
				]);
				return { chainId: chain.chainId, amount: word(raw).toString(10) };
			} catch {
				return { chainId: chain.chainId };
			}
		}),
	);
}

/** Read a balance at one exact block so indexed events can advance the public read model. */
export async function readNativeUsdcBalanceSnapshots(
	address: string,
	chainIds = SERVER_CHAINS.map((chain) => chain.chainId),
	signal?: AbortSignal,
): Promise<BalanceRead[]> {
	const wanted = new Set(chainIds);
	return Promise.all(
		SERVER_CHAINS.filter((chain) => wanted.has(chain.chainId)).map(async (chain) => {
			const rpcUrl = process.env[chain.rpcEnv];
			if (!rpcUrl) return { chainId: chain.chainId };
			try {
				await assertRpcChainId(rpcUrl, chain.chainId, signal);
				const blockNumber = await readBlockNumber(rpcUrl, signal);
				const [raw] = await calls(rpcUrl, [
					{
						to: chain.usdcAddress,
						signature: "balanceOf(address)",
						args: address.replace(/^0x/, "").toLowerCase().padStart(64, "0"),
					},
				], `0x${BigInt(blockNumber).toString(16)}`, signal);
				return { chainId: chain.chainId, amount: word(raw).toString(10), blockNumber };
			} catch {
				return { chainId: chain.chainId };
			}
		}),
	);
}

export function labelHash(label: string): string {
	return `0x${hex(keccak_256(text.encode(label)))}`;
}

export function ensNamehash(label: string): string {
	let node: Uint8Array<ArrayBufferLike> = new Uint8Array(32);
	for (const part of `${label}.eth`.split(".").reverse()) {
		const partHash = keccak_256(text.encode(part));
		const input = new Uint8Array(64);
		input.set(node);
		input.set(partHash, 32);
		node = keccak_256(input);
	}
	return `0x${hex(node)}`;
}
