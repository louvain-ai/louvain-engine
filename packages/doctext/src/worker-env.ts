/** What a reader process is started with: an allowlisted environment and only the parent's loader flags. */

/**
 * The only environment a reader sees: nothing from the parent but what loading a module needs. Everything else — the
 * database URL, provider keys, tokens — stays out of a process that parses hostile bytes.
 */
export function readerEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: parent.NODE_ENV ?? "production" };
  // The TypeScript loader's own setting, under the tests (tsx): which tsconfig it compiles with.
  if (parent.TSX_TSCONFIG_PATH) env.TSX_TSCONFIG_PATH = parent.TSX_TSCONFIG_PATH;
  return env;
}

/**
 * The parent's node flags a child needs to load the same module (a loader: `--import tsx` under the tests), and no
 * others — never a `--test…`, an `--inspect`, or the parent's own heap size.
 */
export function loaderFlags(argv: readonly string[]): string[] {
  const keep = ["--import", "--require", "--loader", "--experimental-loader", "--conditions", "-r"];
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const flag = arg.split("=")[0] ?? "";
    if (!keep.includes(flag)) continue;
    out.push(arg);
    if (!arg.includes("=") && i + 1 < argv.length) out.push(argv[++i] ?? "");
  }
  return out;
}
