/**
 * Ask is two contracts, composed by a function call: a `Model` (`model.ts`) and an `Answerer` (`answerer.ts`, the
 * engine's). `engine.config.ts` names the answerer (`plugins.ts`); the flow (`flow.ts`) owns what decides sight and
 * money: the tools and their refs, which citations reach the page, lookups, time, cancel.
 */

/** A model not usable as configured, and the one setting that would make it so (a key the environment lacks). */
export type Unready = { readonly needs: string };
export const unready = (made: object): made is Unready => "needs" in made;

/** What one answer may spend (`limits.ts`). The flow holds the lookups and the time; a model loop, the rest. */
export type Limits = {
  readonly rounds: number;
  readonly tokens: number;
  readonly turnTokens: number;
  readonly lookups: number;
  readonly readChars: number;
  readonly searchHits: number;
  readonly deadlineMs: number;
};
