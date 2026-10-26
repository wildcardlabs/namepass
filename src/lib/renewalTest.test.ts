import { expect, test } from "vitest";
import { creditLogIndex, parseUsdc, type ReceiptLog } from "./renewalTest";

/**
 * The Phase 6 canary that funded vitalik.eth on Sepolia: 1 USDC to the
 * factory-derived wallet. The status endpoint reports this deposit at log index
 * 200 (`docs/deployments/2026-10-23/canaries.json`), so the page must bind the
 * wallet's receipt to that same log.
 */
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const VITALIK_WALLET = "0x9D21DeE23f5Fe9df32b91AE559530f933Ee9c899";
const canaryLogs: ReceiptLog[] = [{
	address: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
	topics: [
		"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
		"0x0000000000000000000000001208a26faa0f4ac65b42098419eb4daa5e580ac6",
		"0x0000000000000000000000009d21dee23f5fe9df32b91ae559530f933ee9c899",
	],
	data: "0x00000000000000000000000000000000000000000000000000000000000f4240",
	logIndex: "0xc8",
}];

test("binds a wallet receipt to the credited deposit the status endpoint reports", () => {
	expect(creditLogIndex(canaryLogs, { token: SEPOLIA_USDC, to: VITALIK_WALLET, amount: 1_000_000n })).toBe(200);
	expect(creditLogIndex(canaryLogs, { token: SEPOLIA_USDC, to: VITALIK_WALLET, amount: 900_000n })).toBeNull();
	expect(creditLogIndex(canaryLogs, { token: SEPOLIA_USDC, to: "0xd78DF8F827881e34ff0B1B717dc876D880890D50", amount: 1_000_000n })).toBeNull();
	expect(creditLogIndex(canaryLogs, { token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", to: VITALIK_WALLET, amount: 1_000_000n })).toBeNull();
});

test("parses USDC amounts exactly into six-decimal units", () => {
	expect(parseUsdc("1")).toBe(1_000_000n);
	expect(parseUsdc("0.5")).toBe(500_000n);
	expect(parseUsdc("0.000001")).toBe(1n);
	expect(parseUsdc("12.345678")).toBe(12_345_678n);
	for (const bad of ["0", "0.0", "1.0000001", "-1", "1e3", "", ".5", "1,5"]) expect(parseUsdc(bad)).toBeNull();
});
