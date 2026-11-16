import { type Grants, grantsOf } from "../grants.js";
import type { Host } from "../host.js";
import { KINDS } from "./kinds.js";
import { type Contracts, type Plugin, refuse } from "./plugin.js";

/**
 * What a deployment runs, said once, in code: `engine.config.ts` exports `defineEngine({ … })`. Each kind is a list,
 * run in the order written, so no import order decides it. The environment never names a plugin; it carries
 * addresses, keys and ports, which a plugin's factory reads. How who may read what is resolved, and how a call is
 * metered, are the host's, bound in code; `grants` is data the engine's own host reads, never a resolver.
 */
export type EngineConfig = {
  readonly readers?: readonly Plugin<"fileReader">[];
  /** One reranker, or `null` for none: the search is then ordered by its legs alone. */
  readonly reranker?: Plugin<"reranker"> | null;
  /** The ways items come in, each chosen by name for a run; the HTTP door is open only when one here names a token. */
  readonly sources?: readonly Plugin<"source">[];
  /** What the tool server serves (`surface.ts`): `mcp()` by default. */
  readonly surfaces?: readonly Plugin<"surface">[];
  /** One answerer, or `null` for none: the app's Ask then says it has none. */
  readonly answerer?: Plugin<"answerer"> | null;
  /** The engine's own settings, each left out at its default; the engine that runs declares and validates them. */
  readonly settings?: EngineSettings;
  /**
   * The collections each named reader may read (`./engine reader add <name>` makes a reader's token). The engine's own
   * token reads every collection; a reader no grant names reads nothing.
   */
  readonly grants?: Grants;
};

/** Empty here: the engine adds its settings to it (`declare module`), so a configuration is typed by what it runs. */
// biome-ignore lint/suspicious/noEmptyInterface: an interface, so the engine can merge its settings into it.
export interface EngineSettings {}

// Shared by every copy of this module, so a configuration that imports another copy (source or build) is still known.
const DEFINED = Symbol.for("defineEngine");

/** Each kind the configuration names, with its plugins in order. Only `defineEngine` makes one. */
export type Plugins = { readonly [K in keyof Contracts]?: readonly Plugin<K>[] } & {
  readonly settings?: EngineSettings;
  readonly grants?: Grants;
  readonly [DEFINED]: true;
};

export const isDefined = (value: unknown): value is Plugins =>
  typeof value === "object" && value !== null && DEFINED in value;

/**
 * A kind the configuration names replaces that kind's defaults; a kind it leaves out keeps them, and a list written
 * empty runs none. Keeping the defaults as well is one spread in the configuration.
 */
export const withDefaults = (configured: Plugins, defaults: Plugins): Plugins => ({
  ...defaults,
  ...configured,
});

const FIELDS = {
  readers: "fileReader",
  reranker: "reranker",
  sources: "source",
  surfaces: "surface",
  answerer: "answerer",
} as const satisfies {
  [F in Exclude<keyof EngineConfig, DataField>]-?: keyof Contracts;
};

/** The fields that hold data rather than plugins: the engine's settings, and who may read which collections. */
type DataField = "settings" | "grants";
const DATA_FIELDS: readonly string[] = ["settings", "grants"] satisfies DataField[];

export function defineEngine(config: EngineConfig): Plugins {
  const plugins: { [K in keyof Contracts]?: readonly Plugin<keyof Contracts>[] } = {};
  for (const [field, value] of Object.entries(config)) {
    if (value === undefined || DATA_FIELDS.includes(field)) continue;
    const kind = kindOf(field);
    plugins[kind] = checked(
      field,
      kind,
      Array.isArray(value) ? value : value === null ? [] : [value],
    );
  }
  // `checked` proved every plugin's kind is its key, which TypeScript cannot follow through `Object.entries`.
  const { settings, grants } = config;
  return {
    ...plugins,
    ...(settings && { settings }),
    ...(grants && { grants: grantsOf(grants) }),
    [DEFINED]: true,
  } as Plugins;
}

function kindOf(field: string): keyof Contracts {
  if (Object.hasOwn(FIELDS, field)) return FIELDS[field as keyof typeof FIELDS];
  if (HOST_BINDINGS.includes(field))
    refuse(
      `"${field}" is a host binding, not a plugin: it is bound in code, never in a configuration`,
    );
  return refuse(
    `a configuration has no "${field}"; it names ${[...Object.keys(FIELDS), ...DATA_FIELDS].join(", ")}`,
  );
}

function checked<K extends keyof Contracts>(field: string, kind: K, list: readonly Plugin<K>[]) {
  const names = new Set<string>();
  for (const plugin of list) {
    if (plugin?.kind !== kind)
      refuse(
        `the configuration's ${field} holds a ${plugin?.kind ?? "value"} where a ${kind} belongs`,
      );
    if (names.has(plugin.name)) refuse(`the configuration's ${field} names "${plugin.name}" twice`);
    names.add(plugin.name);
  }
  if (KINDS[kind] === "one" && list.length > 1)
    refuse(`the configuration names ${list.length} ${kind}s; it takes one`);
  return Object.freeze([...list]);
}

/** The host's members, so a file in plain JavaScript naming one is refused by name; kept equal to `Host` by type. */
const HOST_BINDINGS = Object.keys({
  readableSet: true,
  endpoints: true,
} satisfies Record<keyof Host, true>);
