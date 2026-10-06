import type { H3Event } from "nitro/h3";

const IMPLEMENTED_PATHS = new Set(["/api/v1/address", "/api/v1/quote"]);

export function isImplementedPublicApiPath(path: string): boolean {
	return IMPLEMENTED_PATHS.has(path) || /^\/api\/v1\/names\/[^/]+\/renewals$/.test(path) || /^\/api\/v1\/status\/[^/]+$/.test(path);
}

/** Keep unavailable API URLs out of the SPA fallback, without changing UI routes. */
export default function publicApiBoundary(event: H3Event): Response | undefined {
	const path = event.url.pathname;
	if (path !== "/api/v1" && !path.startsWith("/api/v1/")) return;
	if (isImplementedPublicApiPath(path)) return;
	return Response.json(
		{ error: { code: "api_not_found", message: "This API endpoint is not available." } },
		{
			status: 404,
			headers: {
				"cache-control": "no-store",
				"access-control-allow-origin": "*",
				"x-content-type-options": "nosniff",
			},
		},
	);
}
