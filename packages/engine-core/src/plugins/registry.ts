import type { Plugins } from "./config.js";
import { isNotReady } from "./kinds.js";
import { type Contracts, type Plugin, refuse } from "./plugin.js";

/**
 * The plugin registry: the started plugins of one engine, made whole from a configuration at start-up and never
 * changed after. Each plugin starts in the configuration's order; one that fails stops the start, by name, and those
 * already started are closed, latest first. It is a value passed from the entry to what reads it, never module state:
 * the host's bindings are the only thing a process binds once.
 */
export type PluginRegistry = {
  /** Every plugin of a kind that runs, in the configuration's order. */
  list<K extends keyof Contracts>(kind: K): readonly Started<K>[];
  /** Every plugin of a kind that started without what it needs to run (`notReady`). */
  waiting(kind: keyof Contracts): readonly Waiting[];
  /** A kind the configuration names one of: running, waiting with what it needs, or null for none. */
  one<K extends keyof Contracts>(kind: K): One<K> | null;
  /** Close every plugin that offers it, latest first. */
  close(): Promise<void>;
};

export type Started<K extends keyof Contracts> = {
  readonly name: string;
  readonly plugin: Contracts[K];
};

/** A plugin that started without what it needs, and the one setting that would make it run. */
export type Waiting = { readonly name: string; readonly needs: string };

export type One<K extends keyof Contracts> =
  | ({ readonly ready: true } & Started<K>)
  | ({ readonly ready: false } & Waiting);

type Running = { readonly what: string; close(): Promise<void> };

export async function createPluginRegistry(plugins: Plugins): Promise<PluginRegistry> {
  const started = new Map<keyof Contracts, readonly Started<keyof Contracts>[]>();
  const waiting = new Map<keyof Contracts, readonly Waiting[]>();
  const running: Running[] = [];
  // The configuration's settings and grants ride with its plugins; only the kinds start.
  const { settings: _settings, grants: _grants, ...kinds } = plugins;
  for (const kind of Object.keys(kinds) as (keyof Contracts)[]) {
    const ready: Started<keyof Contracts>[] = [];
    const held: Waiting[] = [];
    for (const plugin of kinds[kind] ?? []) {
      const one = await startOne(plugin, running);
      if (one.plugin === undefined) held.push(one);
      else ready.push(one);
    }
    started.set(kind, Object.freeze(ready));
    waiting.set(kind, Object.freeze(held));
  }
  // Each entry was started from its own kind's plugins, which TypeScript cannot follow through a map.
  const list = <K extends keyof Contracts>(kind: K) =>
    (started.get(kind) ?? []) as readonly Started<K>[];
  return {
    list,
    waiting: (kind) => waiting.get(kind) ?? [],
    one: <K extends keyof Contracts>(kind: K): One<K> | null => {
      const [run] = list(kind);
      if (run) return { ready: true, ...run };
      const [held] = waiting.get(kind) ?? [];
      return held ? { ready: false, ...held } : null;
    },
    close: () => closeAll(running),
  };
}

async function startOne<K extends keyof Contracts>(
  plugin: Plugin<K>,
  running: Running[],
): Promise<(Waiting & { plugin?: undefined }) | Started<K>> {
  const what = `the ${plugin.kind} "${plugin.name}"`;
  try {
    const started = await plugin.create();
    if (isNotReady(started)) return { name: plugin.name, needs: started.notReady };
    running.push({ what, close: async () => plugin.close?.(started) });
    return { name: plugin.name, plugin: started };
  } catch (err) {
    const unclosed = await closeAll(running).then(
      () => "",
      (closing: unknown) => ` (and closing the plugins already started failed: ${reason(closing)})`,
    );
    return refuse(`${what} failed to start: ${reason(err)}${unclosed}`);
  }
}

/** Latest first, every one attempted; the failures are reported once all have had their turn. */
async function closeAll(running: Running[]): Promise<void> {
  const failures: string[] = [];
  for (const plugin of running.splice(0).reverse())
    await plugin.close().catch((err: unknown) => failures.push(`${plugin.what}: ${reason(err)}`));
  if (failures.length > 0) throw new Error(failures.join("; "));
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));
