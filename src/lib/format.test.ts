import { describe, expect, test } from "vitest";

import { YEAR_SECONDS } from "./pricing";
import { fmtDelivered, fmtDuration, fmtDurationPrecise } from "./format";

describe("delivered renewal time", () => {
	test("keeps recent renewals in days", () => {
		expect(fmtDelivered(18n * 86_400n)).toBe("18 days");
	});

	test("uses months below a year and years plus months above it", () => {
		expect(fmtDelivered(8n * (YEAR_SECONDS / 12n))).toBe("8 months");
		expect(fmtDelivered(YEAR_SECONDS + 2n * (YEAR_SECONDS / 12n))).toBe("1 year 2 months");
	});
});

describe("compact renewal duration", () => {
	test("shows the live three-character renewal in hours instead of zero days", () => {
		expect(fmtDuration(44_347n)).toBe("+12h");
	});

	test("uses the smallest useful unit at sub-day boundaries", () => {
		expect(fmtDuration(1n)).toBe("+1m");
		expect(fmtDuration(3_599n)).toBe("+60m");
		expect(fmtDuration(3_600n)).toBe("+1h");
		expect(fmtDuration(86_399n)).toBe("+23h");
		expect(fmtDuration(86_400n)).toBe("+1d");
	});

	test("keeps year formatting for long renewals", () => {
		expect(fmtDuration(YEAR_SECONDS)).toBe("+1.0y");
	});
});

describe("precise renewal duration", () => {
	test("does not round a short renewal to one month", () => {
		expect(fmtDurationPrecise(26n * 86_400n)).toBe("26 days");
	});

	test("uses the calculator's year, month, and day breakdown", () => {
		expect(fmtDurationPrecise(YEAR_SECONDS + 2n * (YEAR_SECONDS / 12n) + 3n * 86_400n)).toBe("1 year, 2 months, 3 days");
	});
});
