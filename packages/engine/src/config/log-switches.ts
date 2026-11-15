/** The logger's two switches, read through their declarations (`settings.ts`): the logger is their only reader. */
import { environment } from "./environment.js";

/** Log lines are JSON outside production (`observability/logging.ts`, read at import): opt-in, only `true`. */
export const logJsonOn = (): boolean => environment("LOUVAIN_LOG_JSON");

/** Debug lines are written (`observability/logging.ts`, per call): only the exact word `debug`. */
export const logDebugOn = (): boolean => environment("LOUVAIN_LOG_LEVEL");
