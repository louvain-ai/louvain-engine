/**
 * A workspace's passage-context mode, `off | header | shadow | on`: whether passages carry a header that situates
 * them, and whether the read side ranks by it. `off` writes nothing; `header` writes the deterministic header and the
 * lexical passes read it; `shadow` and `on` would add a model-written context, written and then read, and the setter
 * refuses them, since that step is not built. `header` is the default and `off` is its switch. The vector leg ranks by
 * the bare vector alone: a context moves the lexical passes only. The open engine is always `header`; a build that
 * stores a workspace's choice answers it through `ReadHooks.contextMode`.
 */

export type PassageContextMode = "off" | "header" | "shadow" | "on";

/** A workspace that never chose: `header`; `off` is the switch. */
export const DEFAULT_PASSAGE_CONTEXT: PassageContextMode = "header";

/** Whether the read side ranks by the contextual columns. `shadow` writes and NEVER reads: that is what it is. */
export const readsPassageContext = (mode: PassageContextMode): boolean =>
  mode === "header" || mode === "on";

/** Whether the write side fills them. */
export const writesPassageContext = (mode: PassageContextMode): boolean => mode !== "off";

/** How a workspace's mode is found: the open engine's is `header` for every workspace (`ReadHooks.contextMode`). */
export type ContextMode = (orgId: string) => Promise<PassageContextMode>;

/** The open engine's answer: every workspace writes and reads the deterministic header; it stores no setting. */
export const OPEN_CONTEXT_MODE: ContextMode = async () => DEFAULT_PASSAGE_CONTEXT;
