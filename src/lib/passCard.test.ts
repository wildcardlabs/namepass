// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import PassCard from "../components/PassCard";
import { encodeQR } from "./qr";

const address = "0x5B7516768eD0b04E212041265BB1f11af71841d7";
let container: HTMLDivElement;
let root: Root;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
	else Reflect.deleteProperty(navigator, "clipboard");
	vi.unstubAllGlobals();
});

test("the normalized deposit details disclose every QR module and restore focus on close", async () => {
	await act(async () => root.render(createElement(PassCard, { name: "Vitalik.eth", address, onSupportedTokens: () => {} })));
	expect(container.textContent).toContain(address);
	expect(container.textContent).toContain("vitalik.namepass.eth");
	expect(document.querySelector('[role="dialog"]')).toBeNull();
	const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Show deposit address QR code"]')!;
	await act(async () => trigger.click());
	const dialog = document.querySelector('[role="dialog"]')!;
	expect(dialog.textContent).toContain(address);
	expect(dialog.querySelector('svg[role="img"]')?.getAttribute("aria-label")).toBe(`QR code for ${address}`);
	const qr = dialog.querySelector('svg[role="img"]')!;
	const modules = [...qr.querySelector("path")!.getAttribute("d")!.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(match => `${match[1]},${match[2]}`);
	const expected = encodeQR(address).flatMap((row, y) => row.flatMap((on, x) => on ? [`${x},${y}`] : []));
	expect(modules).toEqual(expected);
	expect(qr.querySelectorAll("rect")).toHaveLength(0);
	const close = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Close")!;
	await act(async () => close.click());
	await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
	expect(document.querySelector('[role="dialog"]')).toBeNull();
	expect(document.activeElement).toBe(trigger);
});

test("flat deposit details retain distinct copy targets and the supported-contract action", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
	const supported = vi.fn();
	await act(async () => root.render(createElement(PassCard, { name: "steve.eth", address, onSupportedTokens: supported })));
	await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Copy steve.namepass.eth"]')!.click());
	expect(writeText).toHaveBeenLastCalledWith("steve.namepass.eth");
	await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Copy deposit address ${address}"]`)!.click());
	expect(writeText).toHaveBeenLastCalledWith(address);
	const contracts = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Check contract addresses"))!;
	await act(async () => contracts.click());
	expect(supported).toHaveBeenCalledOnce();
});
