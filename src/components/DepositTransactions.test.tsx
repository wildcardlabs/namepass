// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import DepositTransactions from "./DepositTransactions";

test("pooled deposits expand individually without deduplicating shared transaction hashes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("ol"), root = createRoot(container);
  const hash = `0x${"ab".repeat(32)}`;
  const deposits = [257, 258].map(logIndex => ({ eventId: `11155111:log:${logIndex}`, chainId: "11155111",
    amount: "500000", senderAddress: "0x1111111111111111111111111111111111111111", transactionHash: hash, logIndex }));
  try {
    await act(async () => root.render(<DepositTransactions deposits={deposits} />));
    const toggle = container.querySelector("button")!;
    expect(toggle.textContent).toContain("2 deposits · 1 transaction");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const list = container.querySelector('[aria-label="Source deposits"]')!;
    expect(list.id).toBe(toggle.getAttribute("aria-controls"));
    expect(list.children).toHaveLength(2);
    for (const [index, item] of [...list.children].entries()) {
      expect(item.textContent).toContain("$0.50 USDC");
      expect(item.textContent).toContain(`Log ${257 + index}`);
      expect(item.querySelector("a")?.getAttribute("href")).toBe(`https://sepolia.etherscan.io/tx/${hash}`);
    }
    await act(async () => root.render(<DepositTransactions deposits={[{ ...deposits[0], logIndex: null }]} />));
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Native transfer");
    await act(async () => root.render(<DepositTransactions deposits={null} />));
    expect(container.textContent).toContain("Exact deposit breakdown unavailable.");
    expect(container.querySelector("a")).toBeNull();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
