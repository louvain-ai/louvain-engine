/**
 * How a cell looks, from `styles.xml`, for the grid a person reads; the text a model reads never sees it. A cell's
 * `s` names a `cellXfs` entry, which names a font, a fill and a border and may carry an alignment. What the file's
 * own defaults draw anyway is left out (the default font's colour, no fill, an absent edge), so a sheet nobody
 * styled yields no look at all. Colours are resolved in `looks-colors.ts`.
 */
import { colorOf, themeColors } from "./looks-colors.js";
import { attrValue as attr } from "./tag-attrs.js";
import { firstElement, xmlElements, xmlTagAttrs } from "./tag-elements.js";

export type CellEdge = {
  style: "thin" | "medium" | "thick" | "double" | "dashed" | "dotted";
  /** Absent: the automatic (black) line. */
  color?: string;
};

export type CellLook = {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  /** The font's colour, when it is not the workbook's default text colour. */
  color?: string;
  /** A patterned fill's foreground colour. */
  fill?: string;
  /** `<alignment horizontal>`; absent is `general` (a number right, a boolean centred, text left). */
  align?: "left" | "center" | "right" | "justify";
  /** `<alignment vertical>` when the file sets top or centre; the renderer's own default is used otherwise. */
  valign?: "top" | "middle" | "bottom";
  edges?: { top?: CellEdge; right?: CellEdge; bottom?: CellEdge; left?: CellEdge };
};

const on = (attrs: string | undefined): boolean =>
  attrs !== undefined && attr(attrs, "val") !== "0" && attr(attrs, "val") !== "false";

type Font = Pick<CellLook, "bold" | "italic" | "underline" | "strike" | "color">;

function fontsOf(styles: string, theme: readonly string[]): Font[] {
  const fonts: Font[] = [];
  let automatic: string | undefined;
  for (const [i, font] of [
    ...xmlElements(firstElement(styles, "fonts")?.inner ?? "", "font"),
  ].entries()) {
    const inner = font.inner;
    const look: Font = {};
    if (on(xmlTagAttrs(inner, "b").next().value)) look.bold = true;
    if (on(xmlTagAttrs(inner, "i").next().value)) look.italic = true;
    const u = xmlTagAttrs(inner, "u").next().value;
    if (u !== undefined && attr(u, "val") !== "none") look.underline = true;
    if (on(xmlTagAttrs(inner, "strike").next().value)) look.strike = true;
    const color = colorOf(xmlTagAttrs(inner, "color").next().value, theme);
    // The default font's colour is the automatic colour: every cell has it, so no cell is "coloured" by it.
    if (i === 0) automatic = color;
    else if (color && color !== automatic) look.color = color;
    fonts.push(look);
  }
  return fonts;
}

function fillsOf(styles: string, theme: readonly string[]): (string | undefined)[] {
  return [...xmlElements(firstElement(styles, "fills")?.inner ?? "", "fill")].map((fill) => {
    const pattern = firstElement(fill.inner, "patternFill");
    if (!pattern) return undefined;
    const type = attr(pattern.attrs, "patternType");
    if (type === undefined || type === "none" || type === "gray125") return undefined;
    return colorOf(xmlTagAttrs(pattern.inner, "fgColor").next().value, theme);
  });
}

const EDGE_STYLE: Record<string, CellEdge["style"]> = {
  hair: "thin",
  thin: "thin",
  medium: "medium",
  thick: "thick",
  double: "double",
  dashed: "dashed",
  mediumDashed: "dashed",
  dashDot: "dashed",
  mediumDashDot: "dashed",
  dashDotDot: "dashed",
  mediumDashDotDot: "dashed",
  slantDashDot: "dashed",
  dotted: "dotted",
};

function bordersOf(styles: string, theme: readonly string[]): CellLook["edges"][] {
  return [...xmlElements(firstElement(styles, "borders")?.inner ?? "", "border")].map((border) => {
    const edges: NonNullable<CellLook["edges"]> = {};
    for (const side of ["top", "right", "bottom", "left"] as const) {
      // `start`/`end` are the same edges in a right-to-left-aware file.
      const element =
        firstElement(border.inner, side) ??
        (side === "left" ? firstElement(border.inner, "start") : null) ??
        (side === "right" ? firstElement(border.inner, "end") : null);
      const style = element ? EDGE_STYLE[attr(element.attrs, "style") ?? ""] : undefined;
      if (!element || !style) continue;
      const color = colorOf(xmlTagAttrs(element.inner, "color").next().value, theme);
      edges[side] = color ? { style, color } : { style };
    }
    return Object.keys(edges).length > 0 ? edges : undefined;
  });
}

const ALIGN: Record<string, CellLook["align"]> = {
  left: "left",
  fill: "left",
  center: "center",
  centerContinuous: "center",
  right: "right",
  justify: "justify",
  distributed: "justify",
};

/**
 * Per `cellXfs` entry, its look, or null when it draws as an unstyled cell. Index-aligned with the cell formats
 * `zip-sheet-base.ts` reads from the same entries.
 */
export function cellLooks(styles: string, theme: string): (CellLook | null)[] {
  if (!styles) return [];
  const colors = themeColors(theme);
  const fonts = fontsOf(styles, colors);
  const fills = fillsOf(styles, colors);
  const borders = bordersOf(styles, colors);
  const index = (attrs: string, name: string): number => {
    const n = Number(attr(attrs, name) ?? 0);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  };
  return [...xmlElements(firstElement(styles, "cellXfs")?.inner ?? "", "xf")].map((xf) => {
    const look: CellLook = { ...fonts[index(xf.attrs, "fontId")] };
    const fill = fills[index(xf.attrs, "fillId")];
    if (fill) look.fill = fill;
    const edges = borders[index(xf.attrs, "borderId")];
    if (edges) look.edges = edges;
    const alignment = xf.selfClosing ? undefined : xmlTagAttrs(xf.inner, "alignment").next().value;
    const align = alignment === undefined ? undefined : ALIGN[attr(alignment, "horizontal") ?? ""];
    if (align) look.align = align;
    const vertical = alignment === undefined ? undefined : attr(alignment, "vertical");
    if (vertical === "center" || vertical === "distributed") look.valign = "middle";
    else if (vertical === "top") look.valign = "top";
    else if (vertical === "bottom") look.valign = "bottom";
    return Object.keys(look).length > 0 ? look : null;
  });
}
