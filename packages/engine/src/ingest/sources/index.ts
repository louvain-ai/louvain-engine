/**
 * The one place a source is opened: the configuration's source of that name (`engine.config.ts` `sources`), its
 * request parsed by its own schema, and the guarded fetch handed to it as the only network it has. An unknown name or
 * a request the schema refuses stops the run before anything is read.
 */
import type { IngestSource, PluginRegistry, Source } from "@louvain/engine-core";
import { guardedFetch } from "./guarded-fetch.js";

export class IngestSourceRefused extends Error {}

/** The source the configuration names `name`; an unknown name is refused with the names it runs. */
export function sourceNamed(plugins: PluginRegistry, name: string): Source {
  const sources = plugins.list("source");
  const found = sources.find((s) => s.name === name);
  if (!found)
    throw new IngestSourceRefused(
      `no source is called "${name}" (engine.config.ts runs: ${sources.map((s) => s.name).join(", ") || "none"})`,
    );
  return found.plugin;
}

/** The source the configuration names `name`, opened for this request. */
export function openSource(plugins: PluginRegistry, name: string, request: unknown): IngestSource {
  const source = sourceNamed(plugins, name);
  const parsed = source.request.safeParse(request);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new IngestSourceRefused(`${field}${issue?.message ?? "request refused"}`);
  }
  return source.open(parsed.data, { fetch: guardedFetch });
}

/** The configured sources that take items over the server's door, each with its token. */
export const doorSources = (plugins: PluginRegistry): { name: string; token: string }[] =>
  plugins
    .list("source")
    .flatMap((s) => (s.plugin.door ? [{ name: s.name, ...s.plugin.door }] : []));
