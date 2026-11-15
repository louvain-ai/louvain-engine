/** A deck's slide parts in their own order, and the one element of a slide that holds what a person typed. */

// ————— PowerPoint —————

export const SLIDE_NUMBER = /(\d+)\.xml$/;

/**
 * What a person typed is in a text run, `a:t`, and nowhere else. A slide's other elements that hold character data
 * are properties: a styled table writes its style's id as the text of `<a:tableStyleId>`, and reading every
 * character in the part would put that id in front of the first cell of every styled table. Notes use the same runs.
 */
export const RUNS = new Set(["t"]);

export const byNumber = (a: string, b: string): number =>
  Number(SLIDE_NUMBER.exec(a)?.[1] ?? 0) - Number(SLIDE_NUMBER.exec(b)?.[1] ?? 0);
