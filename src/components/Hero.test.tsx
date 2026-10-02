// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Hero from "./Hero";
import NameAvatar from "./NameAvatar";
import { getActivity, type ActivityRead } from "../lib/publicApi";
import { fetchProfile, type EnsProfile } from "../lib/ens";

vi.mock("../lib/publicApi", () => ({ getActivity: vi.fn() }));
vi.mock("../lib/ens", () => ({ fetchProfile: vi.fn() }));
vi.mock("./CoverGrid", () => ({ default: () => null }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(fetchProfile).mockResolvedValue(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test("activity portraits use distinct completed renewals alongside the requested bottom-right identity", async () => {
  vi.mocked(fetchProfile).mockImplementation(async (name) => ({
    name,
    avatar: `https://example.test/${name}.png`,
    text: {},
  }));
  vi.mocked(getActivity).mockResolvedValue({
    items: [
      { name: { displayName: "first.eth" }, renewal: { durationSeconds: "1" } },
      {
        name: { displayName: "first.eth" },
        renewal: { durationSeconds: "20" },
      },
      { name: { displayName: "zero.eth" }, renewal: { durationSeconds: "0" } },
      {
        name: { displayName: "second.eth" },
        renewal: { durationSeconds: "10" },
      },
    ],
    flows: [{ name: { displayName: "pending.eth" } }],
  } as unknown as ActivityRead);
  await act(async () =>
    root.render(<Hero onExplore={() => {}} onDocs={() => {}} />),
  );
  expect(
    [...container.querySelectorAll(".hero-identity img")].map((node) =>
      node.getAttribute("src"),
    ),
  ).toEqual([
    "https://example.test/first.eth.png",
    "https://example.test/second.eth.png",
    "https://example.test/stevegachau.eth.png",
  ]);
  expect(
    container.querySelectorAll('.hero-community [data-slot="avatar"]').length,
  ).toBe(2);
  expect(fetchProfile).not.toHaveBeenCalledWith("pending.eth");
  expect(fetchProfile).not.toHaveBeenCalledWith("zero.eth");
});

test("unavailable activity leaves the cover usable without invented identities", async () => {
  vi.mocked(getActivity).mockRejectedValue(new Error("Unavailable"));
  await act(async () =>
    root.render(<Hero onExplore={() => {}} onDocs={() => {}} />),
  );
  expect(container.querySelectorAll(".hero-identity").length).toBe(1);
  expect(
    container.querySelector(".hero-identity img")?.getAttribute("src"),
  ).toContain("seed=stevegachau.eth");
  expect(container.querySelector(".hero-community")?.textContent).toBe(
    "Used by 685+ users",
  );
  expect(container.querySelectorAll(".home-hero-actions button").length).toBe(
    2,
  );
});

test("an old ENS profile cannot replace a new name's avatar, and a broken image uses the leaderboard fallback", async () => {
  let finishOld!: (profile: EnsProfile) => void;
  vi.mocked(fetchProfile).mockReturnValueOnce(
    new Promise((resolve) => {
      finishOld = resolve;
    }),
  );
  vi.mocked(fetchProfile).mockResolvedValueOnce({
    name: "new.eth",
    avatar: "https://example.test/new.png",
    text: {},
  });
  await act(async () => root.render(<NameAvatar name="old.eth" />));
  await act(async () => root.render(<NameAvatar name="new.eth" />));
  await act(async () =>
    finishOld({
      name: "old.eth",
      avatar: "https://example.test/old.png",
      text: {},
    }),
  );
  const image = container.querySelector("img")!;
  expect(image.getAttribute("src")).toBe("https://example.test/new.png");
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(image.getAttribute("src")).toBe(
    "https://api.dicebear.com/10.x/voxel-bot/svg?tags=animation&seed=new.eth",
  );
});
