import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchProfile, profileRecordHref } from "./ens";

describe("ENS profile record links", () => {
	test("opens website records as HTTP links", () => {
		expect(profileRecordHref("url", "namepass.eth")).toBe("https://namepass.eth/");
	});

	test("maps social usernames to their profile pages", () => {
		expect(profileRecordHref("com.twitter", "@namepass_eth")).toBe("https://x.com/namepass_eth");
		expect(profileRecordHref("com.github", "namepass-labs")).toBe("https://github.com/namepass-labs");
		expect(profileRecordHref("org.telegram", "namepass")).toBe("https://t.me/namepass");
	});

	test("accepts full social profile URLs only on the matching service", () => {
		expect(profileRecordHref("com.twitter", "twitter.com/namepass_eth")).toBe("https://twitter.com/namepass_eth");
		expect(profileRecordHref("com.github", "https://github.com/namepass-labs")).toBe("https://github.com/namepass-labs");
		expect(profileRecordHref("org.telegram", "https://t.me/namepass")).toBe("https://t.me/namepass");
		expect(profileRecordHref("com.twitter", "https://evil.example/namepass_eth")).toBeUndefined();
		expect(profileRecordHref("com.twitter", "https://user:password@x.com/namepass_eth")).toBeUndefined();
	});

	test("leaves non-link records and unsupported usernames as text", () => {
		expect(profileRecordHref("location", "London")).toBeUndefined();
		expect(profileRecordHref("email", "hello@example.com")).toBeUndefined();
		expect(profileRecordHref("com.discord", "namepass#1234")).toBeUndefined();
	});

	test("does not allow non-HTTP website records", () => {
		expect(profileRecordHref("url", "javascript:alert(1)")).toBeUndefined();
		expect(profileRecordHref("url", "mailto:hello@example.com")).toBeUndefined();
	});
});

describe("ENS profile source", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("reads a bigname name record into the displayed profile", async () => {
		// Trimmed from https://api.bigname.sh/v1/names/vitalik.eth on 2026-10-28.
		const body = {
			data: {
				name: "vitalik.eth",
				resolver: { chain_id: 1, address: "0x231b0ee14048e9dccd1d247744d114a4eb5e8e63" },
				records: {
					addresses: { "60": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
					texts: {
						avatar: "https://euc.li/vitalik.eth",
						"com.github": "vbuterin",
						"com.twitter": "VitalikButerin",
						description: "mi pinxe lo crino tcati",
						pgp: "527E406252E06A11416D7487698FEAC70F922A21",
						url: "https://vitalik.ca",
					},
					contenthash: "0xe3010170122092663d1900cb692170e5411a7a321b2fd2338194033af55a6dd88bfeaee8b87d",
				},
			},
		};
		const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		expect(await fetchProfile("Vitalik.eth")).toEqual({
			name: "vitalik.eth",
			addr: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
			avatar: "https://euc.li/vitalik.eth",
			text: {
				description: "mi pinxe lo crino tcati",
				url: "https://vitalik.ca",
				"com.twitter": "VitalikButerin",
				"com.github": "vbuterin",
			},
			contenthash: "0xe3010170122092663d1900cb692170e5411a7a321b2fd2338194033af55a6dd88bfeaee8b87d",
			resolver: "0x231b0ee14048e9dccd1d247744d114a4eb5e8e63",
		});
		expect(fetchMock).toHaveBeenCalledWith("https://api.bigname.sh/v1/names/vitalik.eth");
	});

	test("treats an unknown name as having no profile", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 })));
		expect(await fetchProfile("unregistered-namepass-test.eth")).toBeNull();
	});
});
