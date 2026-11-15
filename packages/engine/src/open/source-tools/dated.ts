/**
 * A date as precisely as its source knew it. A source with no date of its own still arrives with an instant the
 * loader chose, and an agent reads that instant as a fact it compares and filters on. So `unknown` sends no
 * date (`dateUnknown: true`), `year` only the year (`dateYear`), `month` only the month (`dateMonth`), never an
 * invented day; `day` the day; an instant under its own field.
 */
export type DatePrecision = "day" | "month" | "year" | "unknown";

export function datedAs(
  field: "modifiedAt" | "occurredAt",
  at: string | null | undefined,
  precision?: DatePrecision | null,
): Record<string, string | number | boolean | null> {
  if (!at) return { [field]: null };
  switch (precision) {
    case "unknown":
      return { dateUnknown: true };
    case "year":
      return { dateYear: Number(at.slice(0, 4)) };
    case "month":
      return { dateMonth: at.slice(0, 7) };
    case "day":
      return { [field]: at.slice(0, 10) };
    default:
      return { [field]: at };
  }
}
