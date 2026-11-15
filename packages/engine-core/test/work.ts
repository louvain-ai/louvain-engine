/**
 * The work a scan did, counted — not timed. Every character `String.prototype.indexOf`, `includes` or
 * `lastIndexOf` walked past, every
 * character a regular expression's `exec` consumed from where it started (its `lastIndex` for a global or sticky one),
 * and one for every character a loop read itself (`charCodeAt`, `charAt`, `codePointAt`), summed while `run` executes.
 * `test`, `replace`, `split` and `match` go through `exec` once it is not the built-in, so they are counted too.
 * Deterministic: the same input is the same count on any machine under any load, so a growth ratio of it cannot flake
 * the way a ratio of CPU time did (×10.6 against ×4 on a loaded runner). What it cannot see is a regular expression
 * backtracking INSIDE one call — which is why the scans it guards use bounded slices and `indexOf`, and a pattern over
 * a whole page has its own test — or work on bytes (a decompressor, a `Uint8Array` loop).
 *
 * One implementation for every package's tests, which import it by path. Under `node:test` one file's tests run in turn, so the async form may hold the counters across
 * its awaits.
 */
export function workOf(run: () => unknown): number {
  const counter = count();
  try {
    run();
  } finally {
    counter.restore();
  }
  return counter.work();
}

/** `workOf` for a scan that awaits: everything `run` does until its promise settles is counted. */
export async function workOfAsync(run: () => Promise<unknown>): Promise<number> {
  const counter = count();
  try {
    await run();
  } finally {
    counter.restore();
  }
  return counter.work();
}

function count(): { work: () => number; restore: () => void } {
  let work = 0;
  const proto = String.prototype;
  const { indexOf, includes, lastIndexOf, charCodeAt, charAt, codePointAt } = proto;
  const exec = RegExp.prototype.exec;
  proto.indexOf = function (this: string, search: string, position?: number): number {
    const from = Math.min(Math.max(0, Math.trunc(position ?? 0)), this.length);
    const at = indexOf.call(this, search, from);
    work += (at < 0 ? this.length : at + String(search).length) - from;
    return at;
  };
  proto.includes = function (this: string, search: string, position?: number): boolean {
    const from = Math.min(Math.max(0, Math.trunc(position ?? 0)), this.length);
    const at = indexOf.call(this, search, from);
    work += (at < 0 ? this.length : at + String(search).length) - from;
    return at >= 0;
  };
  proto.lastIndexOf = function (this: string, search: string, position?: number): number {
    const from = Math.min(Math.max(0, Math.trunc(position ?? this.length)), this.length);
    const at = lastIndexOf.call(this, search, from);
    work += at < 0 ? from + 1 : from - at + 1;
    return at;
  };
  proto.charCodeAt = function (this: string, at: number): number {
    work++;
    return charCodeAt.call(this, at);
  };
  proto.charAt = function (this: string, at: number): string {
    work++;
    return charAt.call(this, at);
  };
  proto.codePointAt = function (this: string, at: number): number | undefined {
    work++;
    return codePointAt.call(this, at);
  };
  RegExp.prototype.exec = function (this: RegExp, input: string): RegExpExecArray | null {
    const text = String(input);
    const from = this.global || this.sticky ? this.lastIndex : 0;
    const found = exec.call(this, text);
    // A sticky pattern only tries where it stands (how `split` walks a text, one position at a time); a global or
    // plain one searches on to the end when nothing matches.
    work += found
      ? found.index + found[0].length - from + 1
      : this.sticky
        ? 1
        : text.length - from + 1;
    return found;
  };
  return {
    work: () => work,
    restore: () => {
      Object.assign(proto, { indexOf, includes, lastIndexOf, charCodeAt, charAt, codePointAt });
      RegExp.prototype.exec = exec;
    },
  };
}

const judge = (what: string, one: number, four: number, slack: number): void => {
  if (!(one > 0 && four <= 4 * slack * one))
    throw new Error(
      `${what}: ${one} → ${four} characters scanned at four times the input (×${(four / Math.max(one, 1)).toFixed(2)}; linear is ×4, quadratic ×16)`,
    );
};

/**
 * Linear by COUNT: the work at 4n is at most `slack` × 4 the work at n (default 1.15: ×4.6), where a quadratic scan
 * would show ×16. `input(n)` builds each input before counting, so building it is not the scan's work.
 */
export function assertLinearWork<T = string>(
  what: string,
  input: (n: number) => T,
  scan: (input: T) => unknown,
  n: number,
  slack = 1.15,
): { one: number; four: number } {
  const small = input(n);
  const large = input(4 * n);
  const one = workOf(() => scan(small));
  const four = workOf(() => scan(large));
  judge(what, one, four, slack);
  return { one, four };
}

/** `assertLinearWork` for a scan that awaits (`workOfAsync`). */
export async function assertLinearWorkAsync<T = string>(
  what: string,
  input: (n: number) => T,
  scan: (input: T) => Promise<unknown>,
  n: number,
  slack = 1.15,
): Promise<{ one: number; four: number }> {
  const small = input(n);
  const large = input(4 * n);
  const one = await workOfAsync(() => scan(small));
  const four = await workOfAsync(() => scan(large));
  judge(what, one, four, slack);
  return { one, four };
}
