/** Read-only operator CLI. Candidates are hints; receipts must prove their exact relationship. */
import { HUB_CHAIN, SERVER_CHAINS } from "../../src/lib/chains";
import { inspectProcessingRenewal } from "../../server/processing-renewal-evidence";

const [
	chainId,
	label,
	processingTransactionHash,
	processingLogIndex,
	renewalTransactionHash,
	renewalLogIndex,
	...extra
] = process.argv.slice(2);
async function inspect() {
	const origin = SERVER_CHAINS.find((c) => String(c.chainId) === chainId);
	if (
		!origin ||
		extra.length ||
		!label ||
		!processingTransactionHash ||
		!processingLogIndex ||
		!renewalTransactionHash ||
		!renewalLogIndex
	)
		throw new Error("invalid_arguments");
	const urls = new Map(
		[origin, HUB_CHAIN].map((c) => [c.chainId, process.env[c.rpcEnv]]),
	);
	if ([...urls.values()].some((url) => !url))
		throw new Error("missing_configuration");
	let requestId = 0;
	async function json(url: string, init: RequestInit) {
		const response = await fetch(url, { ...init, redirect: "error" });
		if (!response.ok) throw new Error("provider_unavailable");
		const reader = response.body?.getReader();
		if (!reader) throw new Error("provider_unavailable");
		let size = 0;
		const parts: Uint8Array[] = [];
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > 1024 * 1024) throw new Error("provider_response_limit");
				parts.push(value);
			}
		} finally {
			await reader.cancel();
		}
		return JSON.parse(Buffer.concat(parts).toString("utf8"));
	}
	const evidence = await inspectProcessingRenewal(
		{
			chainId,
			label,
			processingTransactionHash,
			processingLogIndex,
			renewalTransactionHash,
			renewalLogIndex,
		},
		{
			async rpc(id, method, params, signal) {
				const url = urls.get(id);
				if (!url) throw new Error("unknown_provider");
				const idValue = ++requestId;
				const payload = await json(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: idValue, method, params }),
					signal,
				});
				if (
					payload.jsonrpc !== "2.0" ||
					payload.id !== idValue ||
					payload.error ||
					payload.result === null ||
					payload.result === undefined
				)
					throw new Error("provider_unavailable");
				return payload.result;
			},
			messages(domain, hash, signal) {
				return json(
					`https://iris-api-sandbox.circle.com/v2/messages/${domain}?transactionHash=${hash}`,
					{ method: "GET", signal },
				);
			},
		},
	);
	console.log(
		JSON.stringify(
			{ observedAt: new Date().toISOString(), readOnly: true, evidence },
			null,
			2,
		),
	);
}
inspect().catch(() => {
	console.error(
		JSON.stringify({
			error: "processing_renewal_inspection_unavailable",
			message:
				"Check arguments, configuration and evidence. Provider details are suppressed.",
		}),
	);
	process.exitCode = 1;
});
