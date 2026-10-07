import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { include: ["src/lib/*.test.ts", "src/App.test.tsx", "src/components/Hero.test.tsx", "src/components/DepositTransactions.test.tsx"] },
});
