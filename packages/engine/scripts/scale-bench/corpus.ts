import { once } from "node:events";
import { createWriteStream } from "node:fs";

/**
 * The scale benchmark's corpus, made up and seeded: the same `seed` and `count` always write the same records. Words
 * come from an invented lexicon with a skewed (Zipf) frequency, as in written language, so a few words are in most
 * records and most words in few; a corpus whose words were all common would make every keyword search the same. Each
 * record is about one passage of prose with a key of its own (`SUP-<n>`), a figure and an invented author, and no real
 * name or text. The queries are drawn from the same seed, each with the record it should find.
 */

const LEXICON = 20_000;
const SKEW = 1.07;
const WORDS_A_RECORD = 90;
const SYLLABLES =
  "ba be bi bo bu da de di do du fa fe fi fo ka ke ki ko la le li lo lu ma me mi mo na ne ni no pa pe pi po ra re ri ro sa se si so ta te ti to va ve vi vo za ze zi zo".split(
    " ",
  );
const PLAIN = "the a of to and in for on with is was by at from as this that report team".split(
  " ",
);

/** mulberry32: a small seeded generator, so a corpus is the same on every machine. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The invented words, distinct, and the cumulative weights a Zipf draw searches. */
function lexicon(random: () => number): { words: string[]; cumulative: Float64Array } {
  const words = new Set<string>();
  while (words.size < LEXICON) {
    const n = 2 + Math.floor(random() * 3);
    words.add(
      Array.from({ length: n }, () => SYLLABLES[Math.floor(random() * SYLLABLES.length)]).join(""),
    );
  }
  const cumulative = new Float64Array(LEXICON);
  let total = 0;
  for (let r = 0; r < LEXICON; r++) cumulative[r] = total += 1 / (r + 1) ** SKEW;
  for (let r = 0; r < LEXICON; r++) cumulative[r] = (cumulative[r] ?? 0) / total;
  return { words: [...words], cumulative };
}

type Corpus = {
  word: () => string;
  random: () => number;
};

function corpusOf(seed: number): Corpus {
  const random = seeded(seed);
  const { words, cumulative } = lexicon(random);
  const word = () => {
    const u = random();
    let lo = 0;
    let hi = LEXICON - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cumulative[mid] ?? 1) < u) lo = mid + 1;
      else hi = mid;
    }
    return words[lo] ?? "";
  };
  return { word, random };
}

// case-ok: writes a made-up title; nothing is read from its case
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Record `n`: its key, title, author, figure and prose. */
function recordOf(c: Corpus, n: number) {
  const prose = Array.from({ length: WORDS_A_RECORD }, (_, i) =>
    i % 6 === 5 ? (PLAIN[Math.floor(c.random() * PLAIN.length)] ?? "the") : c.word(),
  );
  const key = `SUP-${100_000 + n}`;
  const figure = `GBP ${(1_000 + Math.floor(c.random() * 900_000)).toLocaleString("en-GB")}`;
  const title = `${cap(c.word())} ${c.word()} notes ${n}`;
  const author = `${cap(c.word())} ${cap(c.word())}`;
  const text = `${title}. Ticket ${key}: ${prose.slice(0, 45).join(" ")}. The agreed amount is ${figure}. ${prose.slice(45).join(" ")}.`;
  return {
    key: `r${n}`,
    title,
    author,
    text,
    date: new Date(Date.UTC(2024, 0, 1) + n * 60_000).toISOString(),
    app: "bench",
  };
}

/** The records the queries ask for: `each` of the corpus's, spread by the seed, in order. */
export function targetsOf(seed: number, count: number, each: number): number[] {
  const pick = seeded(seed ^ 0x5eed);
  return [...new Set(Array.from({ length: each }, () => Math.floor(pick() * count)))].sort(
    (a, b) => a - b,
  );
}

type Written = ReturnType<typeof recordOf>;

/** Write `count` records, one JSON item a line, and hand back the ones `targets` names, as they were written. */
export async function writeCorpus(
  path: string,
  { seed, count, targets }: { seed: number; count: number; targets: readonly number[] },
): Promise<Written[]> {
  const c = corpusOf(seed);
  const wanted = new Set(targets);
  const kept: Written[] = [];
  const out = createWriteStream(path, "utf8");
  for (let n = 0; n < count; n++) {
    const record = recordOf(c, n);
    if (wanted.has(n)) kept.push(record);
    if (!out.write(`${JSON.stringify(record)}\n`)) await once(out, "drain");
  }
  out.end();
  await once(out, "finish");
  return kept;
}

/** A query and the title of the record it should find (a title is unique: it carries the record's number). */
export type Query = { kind: "keywords" | "key" | "question"; query: string; target: string };

/** Three queries a target record: two of its rarer words, its key, and a question about its title. */
export function queriesOf(targets: readonly Written[]): Query[] {
  return targets.flatMap((record) => {
    // case-ok: the made-up text is lower case by construction
    const words = record.text.split(/[^a-z]+/).filter((w) => w.length > 6);
    const key = /SUP-\d+/.exec(record.text)?.[0] ?? "";
    return [
      { kind: "keywords" as const, query: words.slice(-2).join(" "), target: record.title },
      { kind: "key" as const, query: key, target: record.title },
      {
        kind: "question" as const,
        query: `What do the ${record.title.toLowerCase()} say?`,
        target: record.title,
      },
    ];
  });
}
