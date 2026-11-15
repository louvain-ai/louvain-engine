/**
 * An answerer: a question in, answer events out, with the tools the flow binds for that answer (`flow.ts`). The contract
 * is the engine's (`@louvain/engine-core`), so a configuration names an answerer as it names any plugin.
 */
export type {
  AnswerEvent,
  Answerer,
  AnswerRequest,
  BoundResult,
  BoundTool,
} from "@louvain/engine-core";
