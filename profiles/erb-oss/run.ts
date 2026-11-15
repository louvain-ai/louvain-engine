/** This profile's run: `npx tsx run.ts <step> [options]` from this folder (the shared `main.ts` lists them). */
import { runProfile } from "../erb/run/main.js";
import { openAnswerer } from "../erb/run/variants.js";

runProfile(import.meta.url, openAnswerer);
