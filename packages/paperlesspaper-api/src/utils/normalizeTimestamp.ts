/** Accept the ISO dates and Unix timestamps used by device status responses. */
export const normalizeTimestamp = (value: unknown): number | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric)
    ? numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
    : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(new Date(timestamp).getTime()) ? timestamp : null;
};
