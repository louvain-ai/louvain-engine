/**
 * The scored configuration, run from this repository: `npx tsx profiles/<this folder>/run.ts <step> [options]`, the steps in order
 * `prepare`, `up`, `load`, `check`, `ask`, `judge` (README.md says what each does and costs). Options: `--guidance`
 * prec-v4b (default) or prec-v3; `--sample` all (default) or every-fifth; `--out` (`run/` in the profile's state); `--engine`
 * (http://127.0.0.1:8080); `--budget-usd`, `--price-in` and `--price-out` (US$ a million tokens, required by `ask`);
 * `--dry-run`; `--keep-held-out`; `--rejudge-failed`; `--python`. Keys come from the environment, never a file.
 */
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { judge } from "./run/judge.js";
import { JUDGE_MODEL } from "./run/scored.js";
import { ask, check } from "./run/start.js";
import { load, type Place, prepare, up } from "./run/steps.js";
import { GUIDANCES, type Guidance } from "./text/index.js";

const profile = resolve(new URL(".", import.meta.url).pathname);
const engineRoot = resolve(profile, "../..");
// The profile's own state, where ./engine keeps its secrets and stack's state while it runs (`./engine profile set`).
const place: Place = {
  engineRoot,
  profile,
  state: join(engineRoot, ".engine", "profiles", basename(profile)),
};

const { positionals, values: v } = parseArgs({
  allowPositionals: true,
  options: {
    guidance: { type: "string", default: "prec-v4b" },
    sample: { type: "string", default: "all" },
    out: { type: "string", default: join(place.state, "run") },
    engine: { type: "string", default: "http://127.0.0.1:8080" },
    python: { type: "string", default: "python3" },
    "budget-usd": { type: "string" },
    "price-in": { type: "string" },
    "price-out": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "keep-held-out": { type: "boolean", default: false },
    "rejudge-failed": { type: "boolean", default: false },
  },
});

/** A required number, or the run stops naming the option; a dry run needs none. */
function number(name: "budget-usd" | "price-in" | "price-out"): number {
  const n = Number(v[name] ?? (v["dry-run"] ? 0 : Number.NaN));
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} is required: a number`);
  return name === "budget-usd" && v["dry-run"] ? Math.max(n, 1) : n;
}

async function main(step: string | undefined): Promise<number> {
  if (step === "prepare") await prepare(place, v["keep-held-out"]);
  else if (step === "up") up(place);
  else if (step === "load") load(place);
  else if (step === "check") await check(place, v.engine);
  else if (step === "judge") {
    const benchmark = join(place.state, "benchmark");
    judge({
      benchmark,
      out: v.out,
      python: v.python,
      model: JUDGE_MODEL,
      rejudgeFailed: v["rejudge-failed"],
    });
  } else if (step === "ask") {
    if (!GUIDANCES.includes(v.guidance as Guidance))
      throw new Error(`--guidance is one of ${GUIDANCES.join(", ")}`);
    if (v.sample !== "all" && v.sample !== "every-fifth")
      throw new Error("--sample is all or every-fifth");
    const input = number("price-in");
    const prices = {
      input,
      output: number("price-out"),
      cacheRead: input * 0.1,
      cacheWrite: input * 1.25,
    };
    const options = {
      guidance: v.guidance as Guidance,
      sample: v.sample as "all" | "every-fifth",
      engine: v.engine,
      out: v.out,
      dry: v["dry-run"],
    };
    return ask(place, options, { usd: number("budget-usd"), prices });
  } else throw new Error("usage: run.ts prepare | up | load | check | ask | judge [options]");
  return 0;
}

// `process.exit`, not a return: the database connection the citation mapping opened would hold the process open.
main(positionals[0]).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`run.ts: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);
