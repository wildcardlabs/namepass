// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import DepositTransactions from "./DepositTransactions";
import FundingSources from "./FundingSources";

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
      expect(item.textContent).toContain(`Deposit ${index + 1}`);
      expect(item.textContent).not.toContain("Log ");
      expect(item.querySelector("a")?.getAttribute("href")).toBe(`https://sepolia.etherscan.io/tx/${hash}`);
    }
    await act(async () => root.render(<DepositTransactions deposits={[{ ...deposits[0], logIndex: null }]} />));
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Deposit 1");
    await act(async () => root.render(<DepositTransactions deposits={null} />));
    expect(container.textContent).toContain("Exact deposit breakdown unavailable.");
    expect(container.querySelector("a")).toBeNull();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

test("funding sources show each wallet's exact contribution and preserve unknown senders", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  const first = `0x${"Aa".repeat(20)}`, second = `0x${"bb".repeat(20)}`;
  const hash = `0x${"ab".repeat(32)}`;
  const deposits = [
    { senderAddress: first, amount: "500000" },
    { senderAddress: first.toLowerCase(), amount: "250000" },
    { senderAddress: second, amount: "250000" },
  ].map((source, logIndex) => ({ ...source, eventId: `credit-${logIndex}`, chainId: "11155111", transactionHash: hash, logIndex }));
  try {
    await act(async () => root.render(<FundingSources deposits={deposits} fallback="Sender unavailable" />));
    const list = container.querySelector('[aria-label="Funding sources"]')!;
    expect(list.children).toHaveLength(2);
    expect(list.children[0].textContent).toContain(first);
    expect(list.children[0].textContent).toContain("$0.75 USDC");
    expect(list.children[1].textContent).toContain(second);
    expect(list.children[1].textContent).toContain("$0.25 USDC");
    expect(container.querySelectorAll("button")).toHaveLength(2);
    await act(async () => root.render(<FundingSources deposits={[deposits[0], { ...deposits[2], senderAddress: null }]} fallback="Sender unavailable" />));
    expect(container.textContent).toContain("Sender unavailable");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    await act(async () => root.render(<FundingSources deposits={[deposits[0]]} fallback="Sender unavailable" />));
    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent).toContain(first);
    const many = ["11", "22", "33", "44"].map((byte, logIndex) => ({ ...deposits[0], eventId: `many-${logIndex}`, logIndex,
      senderAddress: `0x${byte.repeat(20)}` }));
    await act(async () => root.render(<FundingSources deposits={many} fallback="Sender unavailable" />));
    const toggle = container.querySelector("button")!;
    expect(toggle.textContent).toContain("4 wallets");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("ol")).toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const expanded = container.querySelector("ol")!;
    expect(expanded.id).toBe(toggle.getAttribute("aria-controls"));
    expect(expanded.children).toHaveLength(4);
    expect(expanded.tabIndex).toBe(0);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
