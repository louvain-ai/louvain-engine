import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * THE SCORED TEXTS, EXACTLY AS THE MODEL WAS SHOWN THEM. Each file is pinned by its sha256: a text that changed is a
 * different configuration, so it refuses to load rather than run under this profile's name. The harness's own lines
 * (base, question line, last call, nudge, floor) were taken from its source by evaluating the strings, not retyped.
 * `tools.json` is pinned by what it parses to (`JSON.stringify` of it), which is what the model is sent: its layout is
 * the formatter's, and a reformat changes no character the model sees.
 */
const PINS = {
  "base.txt": "f2b5f38a12da762b8dbc01d7f6d5497f6e02b65b254a2481356cf10e9b2dc475",
  "question-line.txt": "bfe0882c43af23d5f278c2273a5971ab154023eb2a6dd52abdd2ae9b2f88d0c3",
  "last-call.txt": "76a812f8c35fb7260d511e03bdf96227dd03bbda457f146baffd0cbfd2bbdd04",
  "nudge.txt": "462f85f52c69bf99f0a03d30a3a144fe421eab83fbb182416eece78573d370dd",
  "floor.txt": "3d4b2179810787834deec42c88253421c195412da38333d56318c4e25f61bdd7",
  "guidance/prec-v4b.txt": "d1d062cfc661f33cc1bbdeb76b1afd810a7f45dce0adc2f8c0dac409d9781d1e",
  "guidance/prec-v3.txt": "5902ecacc9add4be59803a18c6d1f52bf128a79de94b8e527fa22cd53244413d",
  "tools.json": "a533a019a534c39e416d1d81360d9a4a5e8ebe80990470a33bb887366e85dd62",
} as const;

export type Guidance = "prec-v4b" | "prec-v3";
export const GUIDANCES: readonly Guidance[] = ["prec-v4b", "prec-v3"];

/** A tool as the scored build served it: its name, its description and the input schema the model saw. */
export type ScoredTool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export type Texts = {
  base: string;
  questionLine: string;
  lastCall: string;
  nudge: string;
  /** The floor's sentence, filled: `searches` and `reads` already worded ("1 search", "3 documents"). */
  floor: (o: {
    searches: number;
    reads: number;
    floorSearches: number;
    floorReads: number;
  }) => string;
  guidance: string;
  tools: readonly ScoredTool[];
};

/** A pinned text, or a refusal naming the file whose bytes are not the scored ones. */
function pinned(name: keyof typeof PINS, dir: URL = new URL("./", import.meta.url)): string {
  const bytes = readFileSync(new URL(name, dir));
  const pinnedForm = name.endsWith(".json")
    ? JSON.stringify(JSON.parse(bytes.toString("utf8")))
    : bytes;
  const sha = createHash("sha256").update(pinnedForm).digest("hex");
  if (sha !== PINS[name])
    throw new Error(`text/${name} is not the scored text (sha256 ${sha}, pinned ${PINS[name]})`);
  return bytes.toString("utf8");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function loadTexts(guidance: Guidance = "prec-v4b"): Texts {
  const floor = pinned("floor.txt");
  return {
    base: pinned("base.txt"),
    questionLine: pinned("question-line.txt"),
    lastCall: pinned("last-call.txt"),
    nudge: pinned("nudge.txt"),
    floor: (o) =>
      floor
        .replace("{searches}", plural(o.searches, "search", "searches"))
        .replace("{reads}", plural(o.reads, "document", "documents"))
        .replace("{floorSearches}", String(o.floorSearches))
        .replace("{floorReads}", String(o.floorReads)),
    // The file ends in a newline; the launch scripts passed it as `--system-extra "$(cat …)"`, and the shell's
    // command substitution drops every trailing newline, so the system text did not end in one.
    guidance: pinned(`guidance/${guidance}.txt`).replace(/\n+$/, ""),
    tools: JSON.parse(pinned("tools.json")) as ScoredTool[],
  };
}
