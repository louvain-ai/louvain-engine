import { telemetryOf } from "../../host/given.js";
import { endpointOf } from "../../store/keyword-index.js";
import { bm25Tiers, holdingEvery } from "./tiers.js";
import type { WordsTest } from "./titled.js";

/**
 * The words test of an index with tiers (`tiers.ts`), the open build's: a document holds the search's words when
 * the index's first tier holds it, asked of those records alone (`ids`), so every word searched, a word no readable
 * document holds read as a prefix or a typo of a held one, or left out. A word is held when its own tier finds a
 * readable document and nothing had to be completed, corrected or left out. An index that cannot answer holds nothing,
 * and says so in telemetry.
 */
export const tierWords: WordsTest = {
  async holders(context, reader, { query, ids }) {
    if (!endpointOf(context).configured()) return new Set();
    try {
      const { orgId, containers } = reader;
      const tiers = await bm25Tiers(endpointOf(context), {
        orgId,
        containers,
        query,
        limit: ids.length,
        narrow: { ids },
      });
      return new Set(holdingEvery(tiers).map((h) => h.id));
    } catch (err) {
      telemetryOf(context).error("search.words_by_tiers", err, {});
      return new Set();
    }
  },
  async held(context, reader, words) {
    if (!endpointOf(context).configured()) return new Set();
    const held = await Promise.all(
      [...new Set(words)].map(async (word) => {
        try {
          const t = await bm25Tiers(endpointOf(context), {
            orgId: reader.orgId,
            containers: reader.containers,
            query: word,
            limit: 1,
          });
          const unheld = t.completed.length + t.corrected.length + t.dropped.length;
          return t.hits.length > 0 && unheld === 0 ? [word] : [];
        } catch (err) {
          telemetryOf(context).error("search.held_words", err, {});
          return [];
        }
      }),
    );
    return new Set(held.flat());
  },
};
