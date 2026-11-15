/** This profile's run: `npx tsx run.ts <step> [options]` from this folder (`run/main.ts` lists them). */
import { runProfile } from "./run/main.js";
import { scored } from "./run/variants.js";

runProfile(import.meta.url, scored);
