/**
 * Public API client and payment checks for the `/test` renewal page.
 *
 * The page renews a name the way an integrator does: the four `/api/v1`
 * endpoints, plus one USDC transfer signed by the visitor's browser wallet.
 * Testnet only. Amounts stay as six-decimal integers from input to request.
 */

import { decodeEventLog, getAddress, parseAbi, type Address, type Hex } from "viem";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export interface AddressChain {
	chainId: string;
	name: string;
	tokenAddress: string;
	minimumAmount: string;
}

export interface AddressResponse {
	name: string;
	depositAddress: string;
	subname: string;
	subnameVerified: boolean;
	chains: AddressChain[];
}

export interface QuoteResponse {
	name: string;
	chainId: string;
	amount: string;
	secondsAdded: string;
	amountApplied: string;
	renewalFee: string;
	bridgeFee: string;
	roundingRemainder: string;
	pricingBlock: string;
	expiresAt: string;
	estimate: boolean;
}

export interface StatusRenewal {
	renewalId: string;
	chainId: string;
	transactionHash: string;
	secondsAdded: string;
	expiry: string;
}

export interface StatusDeposit {
	name: string;
	depositAddress: string;
	logIndex: number | null;
	amount: string;
	status: StatusValue;
	reason: string | null;
	renewals?: StatusRenewal[];
}

export type StatusValue = "pending" | "processing" | "complete" | "failed";

export interface StatusResponse {
	chainId: string;
	transactionHash: string;
	status: StatusValue;
	deposits: StatusDeposit[];
}

export interface HistoryItem {
	renewalId: string;
	sourceChainId: string;
	chainId: string;
	transactionHash: string;
	secondsAdded: string;
	amountApplied: string | null;
	renewalFee: string | null;
	expiry: string | null;
	status: "complete" | "processing";
	renewedAt: string | null;
}

export interface HistoryResponse {
	name: string;
	currentExpiry: string | null;
	expiryUpdatedAt: string | null;
	items: HistoryItem[];
	nextCursor: string | null;
}

/** An API error with its HTTP status, error code and `Retry-After` delay in seconds. */
export class V1Error extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly retryAfter: number | null,
	) {
		super(message);
		this.name = "V1Error";
	}
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, init);
	const text = await response.text();
	let body: unknown = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = null;
	}
	if (!response.ok) {
		const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
		const retry = Number(response.headers.get("retry-after"));
		throw new V1Error(
			response.status,
			error?.code ?? `http_${response.status}`,
			error?.message ?? `The API returned ${response.status}.`,
			Number.isFinite(retry) && retry > 0 ? retry : null,
		);
	}
	if (body === null) throw new V1Error(response.status, "invalid_response", "The API returned no JSON body.", null);
	return body as T;
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
	signal,
});

export const v1 = {
	address: (name: string, signal?: AbortSignal) => call<AddressResponse>("/api/v1/address", post({ name }, signal)),
	quote: (name: string, chainId: string, amount: string, signal?: AbortSignal) =>
		call<QuoteResponse>("/api/v1/quote", post({ name, chainId, amount }, signal)),
	status: (chainId: string, transactionHash: string, signal?: AbortSignal) =>
		call<StatusResponse>(`/api/v1/status/${encodeURIComponent(chainId)}?transactionHash=${encodeURIComponent(transactionHash)}`, { signal }),
	renewals: (name: string, signal?: AbortSignal) =>
		call<HistoryResponse>(`/api/v1/names/${encodeURIComponent(name)}/renewals?limit=20`, { signal }),
};

/**
 * Polls the status endpoint as the quickstart describes: every five seconds or
 * after `Retry-After`, retrying `404`, `429` and `503`, until `complete` or
 * `failed`. Each response or retryable error is reported through `onUpdate`.
 */
export async function pollStatus(
	chainId: string,
	transactionHash: string,
	onUpdate: (update: { status: StatusResponse } | { waiting: string }) => void,
	signal: AbortSignal,
	sleep: (ms: number, signal: AbortSignal) => Promise<void> = abortableSleep,
): Promise<StatusResponse> {
	for (;;) {
		signal.throwIfAborted();
		let delay = 5;
		try {
			const status = await v1.status(chainId, transactionHash, signal);
			onUpdate({ status });
			if (status.status === "complete" || status.status === "failed") return status;
		} catch (cause) {
			if (!(cause instanceof V1Error) || ![404, 429, 503].includes(cause.status)) throw cause;
			onUpdate({ waiting: cause.status === 404 ? "Not indexed yet." : `${cause.message} (${cause.status})` });
			delay = Math.max(5, cause.retryAfter ?? 5);
		}
		await sleep(delay * 1000, signal);
	}
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(signal.reason);
		}, { once: true });
	});
}

/** Exact decimal USDC to six-decimal units, or `null` for anything but a plain positive amount. */
export function parseUsdc(input: string): bigint | null {
	const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(input.trim());
	if (!match) return null;
	const units = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
	return units > 0n ? units : null;
}

const TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

export interface ReceiptLog {
	address: string;
	topics: readonly Hex[];
	data: Hex;
	logIndex: number | bigint | Hex | null;
}

/**
 * The log index of the one USDC `Transfer` in a receipt that credits exactly
 * `amount` to `to` from token contract `token`; `null` when there is none or
 * more than one. This binds the wallet's receipt to the deposit the status
 * endpoint will report.
 */
export function creditLogIndex(logs: readonly ReceiptLog[], expected: { token: Address; to: Address; amount: bigint }): number | null {
	const matches: number[] = [];
	for (const log of logs) {
		if (getAddress(log.address) !== getAddress(expected.token)) continue;
		try {
			const event = decodeEventLog({ abi: TRANSFER, topics: log.topics as [Hex, ...Hex[]], data: log.data });
			if (getAddress(event.args.to) === getAddress(expected.to) && event.args.value === expected.amount && log.logIndex !== null) {
				matches.push(Number(log.logIndex));
			}
		} catch {
			// Not a Transfer event.
		}
	}
	return matches.length === 1 ? matches[0] : null;
}
