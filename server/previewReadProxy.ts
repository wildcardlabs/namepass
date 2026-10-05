import type { H3Event } from "nitro/h3";
import { isImplementedPublicApiPath } from "./public-api-boundary";

const UPSTREAM = "https://beta.namepass.com";
const PUBLIC_READS = new Set([
	"/api/activity",
	"/api/leaderboard",
	"/api/stats",
	"/api/config/public",
]);

function isPublicRead(path: string): boolean {
	if (PUBLIC_READS.has(path)) return true;
	const match = /^\/api\/(?:names\/([^/]+)(?:\/activity)?|flows\/([^/]+))$/.exec(path);
	if (!match) return false;
	try {
		const segment = decodeURIComponent(match[1] ?? match[2]);
		return !/[/%\\]/.test(segment) && segment !== "." && segment !== "..";
	} catch {
		return false;
	}
}

function unavailable(status: number, code: string, message: string): Response {
	return Response.json({ error: { code, message } }, {
		status,
		headers: { "cache-control": "no-store", ...(status === 405 ? { allow: "GET" } : {}) },
	});
}

/** UI previews reuse anonymous testnet reads before any database-backed route runs. */
export default async function previewReadProxy(event: H3Event): Promise<Response | undefined> {
	if (process.env.VERCEL_ENV !== "preview") return;
	const { req, url } = event;
	if (!url.pathname.startsWith("/api/")) return;
	// These routes use their own deployment and independent switches, off by default.
	// Address activation requires an isolated preview database; never proxy it to beta.
	if (isImplementedPublicApiPath(url.pathname)) return;
	if (req.method !== "GET") {
		return unavailable(405, "preview_read_only", "This preview supports public reads only.");
	}
	if (!isPublicRead(url.pathname)) {
		return unavailable(403, "preview_read_only", "This API is not available in the read-only preview.");
	}

	try {
		const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
			method: "GET",
			headers: { accept: "application/json" },
			cache: "no-store",
			redirect: "error",
			signal: AbortSignal.timeout(10_000),
		});
		const headers = new Headers({ "cache-control": "no-store" });
		for (const name of ["content-type", "retry-after"]) {
			const value = upstream.headers.get(name);
			if (value) headers.set(name, value);
		}
		return new Response(upstream.body, { status: upstream.status, headers });
	} catch {
		return unavailable(502, "preview_upstream_unavailable", "Testnet data could not be loaded. Please try again.");
	}
}
