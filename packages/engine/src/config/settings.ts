import { refuse } from "@louvain/engine-core";
import { z } from "zod";

/**
 * The engine's settings: how a search reads and ranks, set in `engine.config.ts` under `settings`, never in the
 * environment, which carries addresses, keys and ports only (`environment.ts`). One schema, validated at the start; a
 * setting left out keeps its default, and the start says which depart from theirs. Anything nobody should set is a
 * constant beside its one reader, not a setting.
 */
export const Settings = z
  .object({
    retrieval: z
      .object({
        /** The person's question is searched beside an agent's rewrite of it, which drops words the question had. */
        searchQuestion: z.boolean().default(true),
        /** A keyword hit is shown by the passage that matched, not by the document's first. */
        bestPassage: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    rerank: z
      .object({
        /** How many of the first documents go to the reranker: each costs the reranker's time. */
        window: z.number().int().min(1).default(30),
        /** What stands for a document: the passage that ranked it, or its whole text. */
        feed: z.enum(["passage", "document"]).default("passage"),
        /** Characters of a passage sent. */
        passageChars: z.number().int().min(200).default(3_000),
        /** Characters of a whole document sent, when the feed is `document`. */
        documentChars: z.number().int().min(200).default(16_000),
        /** The reranker's weight against the fused order, 0 to 1; a reranker that states its own blend keeps it. */
        blend: z.number().min(0).max(1).default(0.5),
      })
      .strict()
      .prefault({}),
    server: z
      .object({
        /** How long a tool call's reply may take, in milliseconds; work under way runs on. */
        toolDeadlineMs: z.number().int().min(1_000).default(60_000),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type Settings = z.output<typeof Settings>;

declare module "@louvain/engine-core" {
  /** What `settings` in `engine.config.ts` takes: any setting, each at its default when left out. */
  interface EngineSettings extends z.input<typeof Settings> {}
}

const DEFAULTS: Settings = Settings.parse({});

/** The settings a configuration states, with defaults filled; a value out of range stops the start, by its path. */
export function settingsOf(stated: unknown): Settings {
  const parsed = Settings.safeParse(stated ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  return refuse(`engine.config.ts settings.${issue?.path.join(".")}: ${issue?.message}`);
}

/** Each setting that departs from its default, as `rerank.window 150 (default 30)`: what the start reports. */
export function departures(set: Settings, from: Settings = DEFAULTS): string[] {
  return Object.entries(set).flatMap(([group, values]) =>
    Object.entries(values).flatMap(([name, value]) => {
      const preset = (from as Record<string, Record<string, unknown>>)[group]?.[name];
      return value === preset ? [] : [`${group}.${name} ${value} (default ${preset})`];
    }),
  );
}

let read: () => Settings = () => DEFAULTS;

/** The settings in force, read at each call: what every search stage asks. */
export const settings = (): Settings => read();

/** Where the settings come from: the configuration's, once, at the start; a host may bind its own source instead. */
export function bindSettings(source: () => Settings): void {
  read = source;
}
