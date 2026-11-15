/**
 * A workbook's colours as `#rrggbb`: an `rgb`, an entry of the legacy `indexed` palette, or a theme slot with its
 * `tint`. The renderer decides how to draw them in each theme; a file's colours are chosen for black on white paper.
 */
import { attrValue as attr } from "./tag-attrs.js";
import { firstElement, xmlTagAttrs } from "./tag-elements.js";

/** The legacy 64-colour palette `indexed` names (ECMA-376 §18.8.27); 64 and 65 are the system's text and window. */
const INDEXED = [
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "800000",
  "008000",
  "000080",
  "808000",
  "800080",
  "008080",
  "C0C0C0",
  "808080",
  "9999FF",
  "993366",
  "FFFFCC",
  "CCFFFF",
  "660066",
  "FF8080",
  "0066CC",
  "CCCCFF",
  "000080",
  "FF00FF",
  "FFFF00",
  "00FFFF",
  "800080",
  "800000",
  "008080",
  "0000FF",
  "00CCFF",
  "CCFFFF",
  "CCFFCC",
  "FFFF99",
  "99CCFF",
  "FF99CC",
  "CC99FF",
  "FFCC99",
  "3366FF",
  "33CCCC",
  "99CC00",
  "FFCC00",
  "FF9900",
  "FF6600",
  "666699",
  "969696",
  "003366",
  "339966",
  "003300",
  "333300",
  "993300",
  "993366",
  "333399",
  "333333",
];

/**
 * The theme's colour slots in the order a `theme="n"` attribute counts them. The file lists dk1, lt1, dk2, lt2;
 * a cell's index swaps each pair (0 is lt1, 1 is dk1), which every reader of the format has to know.
 */
const THEME_SLOTS = [
  "lt1",
  "dk1",
  "lt2",
  "dk2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
];

/** Office's own default theme, for a workbook that ships none (openpyxl writes one; a hand-built file may not). */
const OFFICE_THEME = [
  "FFFFFF",
  "000000",
  "E7E6E6",
  "44546A",
  "4472C4",
  "ED7D31",
  "A5A5A5",
  "FFC000",
  "5B9BD5",
  "70AD47",
  "0563C1",
  "954F72",
];

/** The twelve theme colours, by a cell's `theme` index. */
export function themeColors(theme: string): string[] {
  const scheme = firstElement(theme, "clrScheme")?.inner;
  if (!scheme) return OFFICE_THEME;
  return THEME_SLOTS.map((slot, i) => {
    const inner = firstElement(scheme, slot)?.inner ?? "";
    const srgb = xmlTagAttrs(inner, "srgbClr").next().value;
    const sys = xmlTagAttrs(inner, "sysClr").next().value;
    const value = (srgb && attr(srgb, "val")) || (sys && attr(sys, "lastClr"));
    return value && /^[0-9a-f]{6}$/i.test(value)
      ? value.toUpperCase()
      : (OFFICE_THEME[i] ?? "000000");
  });
}

/** A `tint` (−1…1) moves a colour's HSL lightness toward black or white, as the application draws it. */
function tinted(hex: string, tint: number): string {
  if (!Number.isFinite(tint) || tint === 0) return hex;
  const { h, s, l: before } = hslOf(hex);
  const l = tint < 0 ? before * (1 + tint) : before * (1 - tint) + tint;
  return hexOf(h, s, l);
}

/** `rrggbb` as hue (in sixths of a turn), saturation and lightness. */
function hslOf(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h, s, l };
}

/** Hue, saturation and lightness back to `RRGGBB`. */
function hexOf(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [r1, g1, b1]
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v + m)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
}

/** A `<color>`'s attributes as `#rrggbb`, or undefined for `auto` and anything unreadable. */
export function colorOf(attrs: string | undefined, theme: readonly string[]): string | undefined {
  if (attrs === undefined) return undefined;
  if (attr(attrs, "auto") === "1" || attr(attrs, "auto") === "true") return undefined;
  let hex: string | undefined;
  const rgb = attr(attrs, "rgb");
  const indexed = attr(attrs, "indexed");
  const slot = attr(attrs, "theme");
  // ARGB: the alpha byte is ignored, as the application ignores it for a cell.
  if (rgb && /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(rgb)) hex = rgb.slice(-6).toUpperCase();
  else if (indexed !== undefined) hex = INDEXED[Number(indexed)];
  else if (slot !== undefined) hex = theme[Number(slot)];
  if (!hex) return undefined;
  return `#${tinted(hex, Number(attr(attrs, "tint") ?? 0))}`;
}
