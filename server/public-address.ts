import { PUBLIC_CHAINS } from "../src/lib/chains";
import { InvalidLabelError, normalizeLabel } from "../src/lib/namepass";
import { minimumTriggerAmount } from "./config";
import { ApiError, json, requiredString } from "./http";
import { logOperation } from "./log";
import { activateName } from "./names";
import { readPublicObject } from "./public-json";

const HEADERS = {
	"cache-control": "no-store",
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "POST, OPTIONS",
	"access-control-allow-headers": "Content-Type",
	"access-control-expose-headers": "Retry-After",
	"x-content-type-options": "nosniff",
};
let activeRequests = 0;

export const publicAddress = {
	async fetch(request: Request): Promise<Response> {
		const requestId = crypto.randomUUID();
		const error = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
			json({ error: { code, message, ...(details ? { details } : {}) }, requestId }, status, {
				...HEADERS,
				...(status === 429 || status === 503 ? { "retry-after": "5" } : {}),
			});
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
		if (request.method !== "POST")
			return json({ error: { code: "method_not_allowed", message: "Use POST." }, requestId }, 405, {
				...HEADERS,
				allow: "POST, OPTIONS",
			});
		if (process.env.NAMEPASS_PUBLIC_ADDRESS_ENABLED !== "1")
			return error(503, "api_unavailable", "The address API is not enabled.");
		if (process.env.NAMEPASS_MAINTENANCE === "1")
			return error(503, "maintenance", "Namepass is being upgraded. Try again later.");
		if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
			return error(415, "unsupported_media_type", "Use application/json.");
		if (activeRequests >= 2)
			return error(429, "address_capacity", "Address capacity is busy. Retry after the indicated delay.");
		activeRequests++;
		try {
			const input = await readPublicObject(
				request,
				["name"],
				AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
			);
			let label: string;
			try {
				label = normalizeLabel(requiredString(input, "name", 512));
			} catch (cause) {
				if (cause instanceof InvalidLabelError) throw new ApiError(400, "invalid_name", cause.message);
				throw cause;
			}
			const activation = await activateName(label, {
				requireRenewable: true,
				readSignal: AbortSignal.timeout(15_000),
			});
			logOperation("public_address.response", { requestId, step: "activation" });
			return json(
				{
					name: activation.name.displayName,
					depositAddress: activation.name.depositAddress,
					subname: `${label}.namepass.eth`,
					// No resolver-to-address verification receipt exists for this deployment yet.
					// A formatted subname or deterministic address alone cannot prove resolution.
					subnameVerified: false,
					chains: PUBLIC_CHAINS.map((chain) => ({
						chainId: String(chain.chainId),
						name: chain.network,
						tokenAddress: chain.usdcAddress,
						minimumAmount: minimumTriggerAmount(chain.chainId).toString(),
					})),
				},
				200,
				HEADERS,
			);
		} catch (cause) {
			logOperation("public_address.error", {
				requestId,
				step: "activation",
				errorCode: cause instanceof ApiError ? cause.code : "activation_unavailable",
			});
			if (cause instanceof ApiError) return error(cause.status, cause.code, cause.message, cause.details);
			return error(
				503,
				"activation_unavailable",
				"Deposit monitoring could not be confirmed. Retry the address request before funding.",
			);
		} finally {
			activeRequests--;
		}
	},
};
