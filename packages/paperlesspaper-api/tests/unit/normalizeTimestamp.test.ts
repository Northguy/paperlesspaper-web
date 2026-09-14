import { expect, it } from "vitest";
import { normalizeTimestamp } from "../../src/utils/normalizeTimestamp";
it.each([1786097100, "1786097100", 1786097100000, "1786097100000", "2026-08-07T10:05:00Z", new Date("2026-08-07T10:05:00Z")])("normalizes %s", value => {
  expect(normalizeTimestamp(value)).toBe(Date.parse("2026-08-07T10:05:00Z"));
});
it.each([null, undefined, "", "  ", false, true, {}, [], Infinity, NaN, "invalid", "99999999999999999999"])('rejects invalid timestamp %s', value => {
  expect(normalizeTimestamp(value)).toBeNull();
});
