import { checkRateLimit } from "@vercel/firewall";
import { isIP } from "node:net";
import { ApiError } from "./http";

type Endpoint = "address" | "quote" | "status" | "history";

/** Hosted public routes require configured counters before database or chain work. */
export async function admitPublicRequest(endpoint: Endpoint, request: Request): Promise<void> {
	if (process.env.VERCEL !== "1" && process.env.NAMEPASS_PUBLIC_LIMITS_ENABLED !== "1") return;
	const unavailable = () => new ApiError(503, "rate_limit_unavailable", "API admission is temporarily unavailable. Try again later.");
	const host = process.env.VERCEL_URL;
	const ip = request.headers.get("x-real-ip");
	if (process.env.NAMEPASS_PUBLIC_LIMITS_ENABLED !== "1" || process.env.NODE_ENV !== "production"
		|| !host || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(host)
		|| !ip || isIP(ip) === 0) throw unavailable();

	// Pin the SDK destination to deployment configuration. Do not forward caller Host,
	// authorization, cookies or rate-limit headers into its internal request.
	const headers = new Headers({ host });
	for (const [suffix, key] of [["ip", ip], ["budget", "all-callers"]] as const) {
		request.signal.throwIfAborted();
		let result;
		try {
			result = await checkRateLimit(`namepass-v1-${endpoint}-${suffix}`, {
				headers, rateLimitKey: key, timeout: 2_000,
			});
		} catch {
			throw unavailable();
		}
		request.signal.throwIfAborted();
		// The SDK returns false with error=not-found for an absent rule. Fail closed.
		if (result.error || typeof result.rateLimited !== "boolean") throw unavailable();
		if (result.rateLimited) throw new ApiError(429, "rate_limited", "API request limit reached. Retry after the indicated delay.");
	}
}
