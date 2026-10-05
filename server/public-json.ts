import { ApiError } from "./http";

export async function readPublicObject(
	request: Request,
	allowedKeys: readonly string[],
	signal: AbortSignal,
): Promise<Record<string, unknown>> {
	if (Number(request.headers.get("content-length")) > 8192)
		throw new ApiError(413, "body_too_large", "The request body is too large.");
	const reader = request.body?.getReader();
	if (!reader) throw new ApiError(400, "invalid_json", "A JSON object is required.");
	const chunks: Uint8Array[] = [];
	let size = 0;
	const cancel = () => {
		void reader.cancel().catch(() => {});
	};
	signal.addEventListener("abort", cancel, { once: true });
	try {
		for (;;) {
			signal.throwIfAborted();
			const chunk = await reader.read();
			signal.throwIfAborted();
			if (chunk.done) break;
			size += chunk.value.length;
			if (size > 8192) throw new ApiError(413, "body_too_large", "The request body is too large.");
			chunks.push(chunk.value);
		}
	} finally {
		signal.removeEventListener("abort", cancel);
		void reader.cancel().catch(() => {});
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new ApiError(400, "invalid_json", "A valid JSON object is required.");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ApiError(400, "invalid_request", "A JSON object is required.");
	if (Object.keys(value).some((key) => !allowedKeys.includes(key)))
		throw new ApiError(400, "invalid_request", "The request contains unknown fields.");
	return value as Record<string, unknown>;
}
