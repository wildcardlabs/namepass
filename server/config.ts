import type { ChainKey } from "../src/lib/chains";
import { SERVER_CHAINS } from "../src/lib/chains";
import { checksumAddress } from "../src/lib/namepass";

const MINIMUM_TRIGGER_BY_CHAIN: Record<ChainKey, bigint> = {
	ethereum: 500_000n,
	base: 500_000n,
	arbitrum: 500_000n,
	arc: 500_000n,
};

export const CHAIN_TRIGGER_CONFIG = SERVER_CHAINS.map((chain) => ({
	chainId: chain.chainId,
	minimumTriggerAmount: MINIMUM_TRIGGER_BY_CHAIN[chain.key],
}));

export function minimumTriggerAmount(chainId: number): bigint {
	const config = CHAIN_TRIGGER_CONFIG.find((entry) => entry.chainId === chainId);
	if (!config) throw new Error(`Chain ${chainId} has no trigger configuration.`);
	return config.minimumTriggerAmount;
}

/** Public address only. */
export function configuredRelayerAddress(): string | null {
	const configured = process.env.RELAYER_ADDRESS;
	if (configured && !/^0x[0-9a-f]{40}$/i.test(configured)) {
		throw new Error("RELAYER_ADDRESS is not a valid address.");
	}
	return configured ? checksumAddress(configured) : null;
}
