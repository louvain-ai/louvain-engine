/**
 * The seam between the read primitives' evidence objects and the reader's row shape. A passage becomes a `passage` row
 * (the verbatim tier) and an object of kind `statement` a `claim` row (one sentence a record said, as the text). The
 * public payload is built from the primitives' own objects, which carry the record and span a citation survives a
 * re-read by.
 */
import type { Evidence as KgEvidence } from "../read/context.js";
import type { Evidence as ReaderRow } from "./evidence-row.js";
export type AskRow = ReaderRow & { key: string };

/** The page, in one ranking, with each row's primitive object beside it. */
export type AskPage = {
  rows: AskRow[];
  /** `tier:id` → the evidence object the primitive returned. */
  origin: Map<string, KgEvidence>;
};

/** What the primitives hand back: an evidence object plus its passage id, or who holds a `statement` (which decides `relayed`). */
export type WithIds = KgEvidence & {
  passageId?: string;
  statement?: { holder: "author" | "quoted" | "reported" };
};

const rowIdOf = (e: WithIds): string =>
  e.kind === "statement" ? (e.statementId ?? e.recordId) : (e.passageId ?? e.recordId);

/** The one key a row is known by on a page: `pageOf` keeps the first hit of each. */
export function rowKeyOf(e: WithIds): string {
  return `${e.kind === "passage" ? "passage" : "claim"}:${rowIdOf(e)}`;
}

function readerRow(e: WithIds, score: number): AskRow {
  const id = rowIdOf(e);
  const tier = e.kind === "passage" ? "passage" : "claim";
  return {
    key: rowKeyOf(e),
    id,
    tier,
    text: e.text,
    container: e.container,
    author: e.speaker?.author ?? null,
    // Relayed: a `statement` says so itself (`holder`); a passage is the source's own words; a row an agent wrote restates.
    relayed: e.generated === true || (e.statement !== undefined && e.statement.holder !== "author"),
    ...(e.generated === true ? { generated: true } : {}),
    ...(e.reading === "reference" ? { reading: "reference" as const } : {}),
    ...(e.instructionLike ? { instructionLike: e.instructionLike } : {}),
    occurredAt: e.occurredAt,
    ...(e.occurredPrecision === undefined ? {} : { occurredPrecision: e.occurredPrecision }),
    score,
    eventId: e.recordId,
    ...(e.origin === undefined ? {} : { origin: e.origin }),
  };
}

export function pageOf(hits: readonly { evidence: WithIds; score: number }[]): AskPage {
  const rows: AskRow[] = [];
  const origin = new Map<string, KgEvidence>();
  for (const hit of hits) {
    const row = readerRow(hit.evidence, hit.score);
    if (origin.has(row.key)) continue;
    origin.set(row.key, hit.evidence);
    rows.push(row);
  }
  return { rows, origin };
}
