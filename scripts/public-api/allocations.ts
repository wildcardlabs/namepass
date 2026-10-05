/** Read-only operator CLI; no database, activation, Workflow or transaction submission. */
import { SERVER_CHAINS } from "../../src/lib/chains";
import { inspectAllocation } from "../../server/allocation-evidence";
const [chainId, label, transactionHash, throughBlock, ...extra] =
	process.argv.slice(2);
async function inspect() {
	const chain = SERVER_CHAINS.find((c) => String(c.chainId) === chainId);
	if (!chain || extra.length || !label || !transactionHash || !throughBlock)
		throw new Error("invalid_arguments");
	const url = process.env[chain.rpcEnv];
	if (!url) throw new Error("missing_configuration");
	let id = 0;
	const evidence = await inspectAllocation(
		{ chainId, label, transactionHash, throughBlock },
		async (method, params, signal) => {
			const requestId = ++id;
			const response = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
				signal,
			});
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
			const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
			if (
				payload.jsonrpc !== "2.0" ||
				payload.id !== requestId ||
				payload.error ||
				payload.result === null ||
				payload.result === undefined
			)
				throw new Error("provider_unavailable");
			return payload.result;
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
			error: "allocation_inspection_unavailable",
			message:
				"Check arguments, configuration and evidence. Provider details are suppressed.",
		}),
	);
	process.exitCode = 1;
});
