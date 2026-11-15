import type { Texts } from "../../text/index.js";
import type { KeyResolver } from "../keys.js";
import type { Model } from "../model.js";
import type { ServedTool, ToolServer } from "../tools/mcp.js";
import type { OfferedTool } from "../tools/offer.js";
import type { LoopSettings } from "./types.js";

/** What the loop is handed: the model, the server and what it serves, the tools offered, the texts and the limits. */
export type Agent = {
  model: Model;
  server: ToolServer;
  served: readonly ServedTool[];
  offered: readonly OfferedTool[];
  texts: Texts;
  keys: KeyResolver;
  loop: LoopSettings;
};
