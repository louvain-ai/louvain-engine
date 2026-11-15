/**
 * A workbook's parts: which members the text and the grid inflate, and the two tables every sheet reads through
 * (the shared strings and the relationship targets). Relationships are read by attribute name, never by order,
 * because writers disagree on the order.
 */
import { text } from "./plain.js";
import { xmlTagAttrs } from "./tag-elements.js";
import { xmlText } from "./xml.js";
import { attr } from "./zip-sheet-cells.js";

export const WORKBOOK_PARTS = (name: string): boolean =>
  name === "xl/workbook.xml" ||
  name === "xl/_rels/workbook.xml.rels" ||
  name === "xl/sharedStrings.xml" ||
  name === "xl/styles.xml" ||
  name.startsWith("xl/worksheets/");
/** The shared string table: every repeated string in the workbook, by index. */
export function sharedStrings(files: Map<string, Uint8Array>): string[] {
  const shared: string[] = [];
  const stringsXml = text(files.get("xl/sharedStrings.xml"));
  if (stringsXml)
    for (const item of stringsXml.split(/<(?:\w+:)?si>/).slice(1))
      shared.push(xmlText(item.split(/<\/(?:\w+:)?si>/)[0] ?? "", { skip: new Set(["rph"]) }));
  return shared;
}

/** Relationship id → part name under `xl/`, as the workbook's rels state it. */
export function sheetTargets(files: Map<string, Uint8Array>): Map<string, string> {
  const targets = new Map<string, string>();
  for (const rel of xmlTagAttrs(text(files.get("xl/_rels/workbook.xml.rels")), "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }
  return targets;
}

/** The most sheets a workbook read lists: thousands of tiny sheets would inflate hundreds of megabytes. */
export const MAX_SHEETS = 256;
