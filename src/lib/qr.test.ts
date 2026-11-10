import jsQR from "jsqr";
import { describe, expect, test } from "vitest";
import { encodeQR } from "./qr";

/* Render with a four-module quiet zone and decode with an independent reader. */
function scan(text: string): string | null {
	const matrix = encodeQR(text);
	const scale = 4;
	const quiet = 4;
	const size = (matrix.length + 2 * quiet) * scale;
	const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
	matrix.forEach((row, r) => row.forEach((dark, c) => {
		if (!dark) return;
		for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
			const p = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
			pixels[p] = pixels[p + 1] = pixels[p + 2] = 0;
		}
	}));
	return jsQR(pixels, size, size, { inversionAttempts: "dontInvert" })?.data ?? null;
}

describe("QR encoder", () => {
	test("encodes a deposit address that a standard reader can scan", () => {
		const address = "0xC4Fb9AED5d7b812AA3689aA4B9400671dd665E79";
		expect(scan(address)).toBe(address);
	});

	/* Versions 7 to 10 also need version information blocks. */
	test.each([1, 50, 120, 213])("encodes %i bytes that a standard reader can scan", (length) => {
		const text = "namepass.eth/".repeat(17).slice(0, length);
		expect(scan(text)).toBe(text);
	});
});
