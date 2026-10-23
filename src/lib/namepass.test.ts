import { expect, it } from "vitest";
import { depositAddress } from "./namepass";
// Expected values: NamepassFactory.predictWallet on Sepolia and Base Sepolia at the 2026-10-23 deployment.
it("derives the independently verified deposit wallets for the two-contract factory", () => {
 expect(depositAddress("steve")).toBe("0xd78DF8F827881e34ff0B1B717dc876D880890D50");
 expect(depositAddress("vitalik")).toBe("0x9D21DeE23f5Fe9df32b91AE559530f933Ee9c899");
});
