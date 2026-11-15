/**
 * One profile's run, from this repository: `npx tsx profiles/<profile>/run.ts <step> [options]`, the steps
 * in order `prepare`, `up`, `load`, `check`, `ask`, `judge` (`../README.md` says what each does and costs).
 * Options: `--guidance` prec-v4b (default) or prec-v3; `--sample` all (default) or every-fifth; `--out` (`run/` in the
 * profile's state); `--engine` (http://127.0.0.1:8080); `--budget-usd`, `--price-in` and `--price-out` (US$ a million
 * tokens, required by `ask`); `--dry-run`; `--keep-held-out`; `--rejudge-failed`; `--python`. Keys come from the
 * environment, never a file.
 */
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { GUIDANCES, type Guidance } from "../text/index.js";
import { judge } from "./judge.js";
import { JUDGE_MODEL } from "./scored.js";
import { ask, check } from "./start.js";
import { load, type Place, prepare, up } from "./steps.js";
import type { Variant } from "./variants.js";

type Values = ReturnType<typeof parsed>["values"];

const parsed = (out: string) =>
  parseArgs({
    allowPositionals: true,
    options: {
      guidance: { type: "string", default: "prec-v4b" },
      sample: { type: "string", default: "all" },
      out: { type: "string", default: out },
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

/** Run one step as the profile in `profileUrl`'s folder (its run.ts's `import.meta.url`), with that profile's variant. */
export function runProfile(profileUrl: string, variant: Variant): void {
  const profile = resolve(new URL(".", profileUrl).pathname);
  const engineRoot = resolve(profile, "../..");
  // The profile's own state, where ./engine keeps its secrets and stack's state while it runs (`./engine profile set`).
  const place: Place = {
    engineRoot,
    profile,
    data: resolve(new URL("..", import.meta.url).pathname),
    state: join(engineRoot, ".engine", "profiles", basename(profile)),
  };
  const { positionals, values } = parsed(join(place.state, "run"));
  // `process.exit`, not a return: the database connection the citation mapping opened would hold the process open.
  main(positionals[0], { place, v: values, variant }).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`run.ts: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    },
  );
}

type Run = { place: Place; v: Values; variant: Variant };

async function main(step: string | undefined, run: Run): Promise<number> {
  const { place, v, variant } = run;
  if (step === "prepare") await prepare(place, v["keep-held-out"]);
  else if (step === "up") up(place);
  else if (step === "load") await load(place);
  else if (step === "check") await check(place, v.engine, variant);
  else if (step === "judge") {
    const benchmark = join(place.state, "benchmark");
    judge({
      benchmark,
      out: v.out,
      python: v.python,
      model: JUDGE_MODEL,
      rejudgeFailed: v["rejudge-failed"],
    });
  } else if (step === "ask") return askStep(run);
  else throw new Error("usage: run.ts prepare | up | load | check | ask | judge [options]");
  return 0;
}

function askStep({ place, v, variant }: Run): Promise<number> {
  if (!GUIDANCES.includes(v.guidance as Guidance))
    throw new Error(`--guidance is one of ${GUIDANCES.join(", ")}`);
  if (v.sample !== "all" && v.sample !== "every-fifth")
    throw new Error("--sample is all or every-fifth");
  const input = number(v, "price-in");
  const prices = {
    input,
    output: number(v, "price-out"),
    cacheRead: input * 0.1,
    cacheWrite: input * 1.25,
  };
  const options = {
    guidance: v.guidance as Guidance,
    sample: v.sample as "all" | "every-fifth",
    engine: v.engine,
    out: v.out,
    dry: v["dry-run"],
    variant,
  };
  return ask(place, options, { usd: number(v, "budget-usd"), prices });
}

/** A required number, or the run stops naming the option; a dry run needs none. */
function number(v: Values, name: "budget-usd" | "price-in" | "price-out"): number {
  const n = Number(v[name] ?? (v["dry-run"] ? 0 : Number.NaN));
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} is required: a number`);
  return name === "budget-usd" && v["dry-run"] ? Math.max(n, 1) : n;
}
