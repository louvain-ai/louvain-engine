/**
 * The ribbon: art on the violet field, flat violet bands with one amber, drawn as paths from one curve. Built once,
 * cloned wherever a field appears. Decorative, so hidden from assistive technology.
 */

const W = 2400;
const H = 1400;
const BANDS = 9;

function y(x: number, i: number): number {
  const t = x / W;
  const base = H * (1.02 - 0.78 * t) + 260 * Math.sin(t * Math.PI * 1.25 + 0.4);
  const spread = 46 + 150 * Math.sin(t * Math.PI * 1.1 + 0.2) ** 2;
  return base + (i - BANDS / 2) * spread * 0.55;
}

/** One band, between curve i and curve i + 1, as a closed path rounded to the pixel. */
function band(i: number): string {
  const xs = Array.from({ length: 103 }, (_, k) => -20 + k * 24);
  const top = xs.map((x) => `${x},${Math.round(y(x, i))}`);
  const bottom = xs.reverse().map((x) => `${x},${Math.round(y(x, i + 1))}`);
  return `M${top.join("L")}L${bottom.join("L")}Z`;
}

const SVG = "http://www.w3.org/2000/svg";
let drawn: SVGSVGElement | undefined;

export function ribbon(): SVGSVGElement {
  if (!drawn) {
    drawn = document.createElementNS(SVG, "svg");
    drawn.setAttribute("viewBox", `0 0 ${W} ${H}`);
    drawn.setAttribute("preserveAspectRatio", "xMaxYMid slice");
    drawn.setAttribute("aria-hidden", "true");
    drawn.classList.add("ribbon");
    for (let i = 0; i < BANDS; i++) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", band(i));
      path.classList.add("band", `band-${i}`);
      drawn.append(path);
    }
  }
  return drawn.cloneNode(true) as SVGSVGElement;
}
