/**
 * The cues of a WebVTT or SubRip file, each attributed only as the file says: a voice tag is a speaker, a `Name:`
 * prefix only where the source writes speakers that way or the file's voices use that name, and a cue naming nobody
 * continues the previous speaker only within `CONTINUES_WITHIN_S`. Every expression is linear and nothing recurses.
 */
import { decodeEntities } from "./text.js";

/** One cue (or one voice span of a cue): its text, when it runs, and who said it when the file says. */
export type Cue = { at: number | null; end: number | null; speaker: string | null; text: string };

/** How close a cue naming nobody must follow the previous cue to be the same person still speaking. */
const CONTINUES_WITHIN_S = 3;

/** A cue's timing line: `00:01:02.500 --> 00:01:04.000`, `01:02.500 --> …`, SubRip's `00:01:02,500 --> …`. */
const STAMP = "(?:\\d{1,3}:)?\\d{1,2}:\\d{2}(?:[.,]\\d{1,3})?";

const TIMING = new RegExp(`^(${STAMP})[ \\t]+-->[ \\t]*(${STAMP})?`);

/** WebVTT's voice tag, `<v Name>` or `<v.loud Name>`: the name at most 80 characters, to its `>`. */
const VOICE = /<v(?:\.[^\s<>]*)?[ \t]([^<>]{1,80})>/g;

/** Any other tag (`<b>`, `<c.yellow>`, `<00:01.000>`, `</v>`, SubRip's `<font>`): it stops at the next `<`. */
const TAG = /<[^<>]*>/g;

/** `Speaker Name: what they said`, the name at most 80 characters and not a bare number. */
const NAMED = /^([^:]{1,80}?):\s+([\s\S]+)$/;

/** `00:01:02.500` / `01:02.5` / `00:01:02,500` as seconds, or null. */
export function cueSeconds(stamp: string): number | null {
  const m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(stamp.trim());
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return (
    Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + Number((ms ?? "0").padEnd(3, "0")) / 1000
  );
}

const plain = (payload: string): string =>
  decodeEntities(payload.replace(TAG, "")).replace(/\s+/g, " ").trim();

type Block = { at: number | null; end: number | null; payload: string };

/** The timed blocks, in file order. A block with no timing line (the header, a NOTE, a STYLE) is skipped. */
function blocksOf(raw: string): Block[] {
  const out: Block[] = [];
  for (const block of raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)) {
    const lines = block.split("\n");
    const timing = lines.findIndex((l) => TIMING.test(l.trim()));
    if (timing < 0) continue;
    const m = TIMING.exec((lines[timing] ?? "").trim());
    out.push({
      at: m?.[1] ? cueSeconds(m[1]) : null,
      end: m?.[2] ? cueSeconds(m[2]) : null,
      payload: lines
        .slice(timing + 1)
        .map((l) => l.trim())
        .filter((l) => l !== "")
        .join(" "),
    });
  }
  return out;
}

/** A block's voice spans: the text before the first tag (nobody's) and each tag's own words. */
function spansOf(payload: string): { speaker: string | null; payload: string }[] {
  const spans: { speaker: string | null; payload: string }[] = [];
  let from = 0;
  let speaker: string | null = null;
  for (const m of payload.matchAll(VOICE)) {
    spans.push({ speaker, payload: payload.slice(from, m.index) });
    speaker = decodeEntities(m[1] ?? "").trim() || null;
    from = m.index + m[0].length;
  }
  spans.push({ speaker, payload: payload.slice(from) });
  return spans;
}

/** Whether a cue starting at `at` follows `before` closely enough, and in order, to be the same utterance. */
export function follows(
  before: { at: number | null; end: number | null },
  at: number | null,
): boolean {
  if (at === null || before.at === null) return false;
  const end = before.end ?? before.at;
  return at >= before.at && at - end <= CONTINUES_WITHIN_S;
}

export type CueOptions = {
  /** The source's format writes each cue as `Speaker Name: …`, so a prefix is a speaker. */
  namePrefix?: boolean;
  /** Stop once this much text (speakers and times included) is kept. */
  maxChars?: number;
};

/**
 * The cues of a WebVTT or SubRip file, in the file's order, each attributed only as the file says. Anything
 * unparseable is skipped, never thrown on: a transcript is text.
 */
export function parseCues(
  raw: string,
  options: CueOptions = {},
): { cues: Cue[]; truncated: boolean } {
  const maxChars = options.maxChars ?? Number.POSITIVE_INFINITY;
  const blocks = blocksOf(raw);
  const voiced = voicedNames(blocks);
  const cues: Cue[] = [];
  let kept = 0;
  for (const block of blocks) {
    for (const span of spansOf(block.payload)) {
      const said = attributed(span, voiced, options.namePrefix === true);
      let speaker = said.speaker;
      const text = said.text;
      if (text === "") continue;
      const last = cues.at(-1);
      if (!speaker && last?.speaker && follows(last, block.at)) speaker = last.speaker;
      // A line costs its words, its speaker and its `[1:02:03] ` (`subtitleText`).
      const overhead = (speaker?.length ?? 0) + 14;
      if (kept + text.length + overhead > maxChars) {
        // A first cue longer than the whole budget keeps its beginning rather than reading the file as empty.
        if (cues.length === 0 && maxChars > overhead)
          cues.push({
            at: block.at,
            end: block.end,
            speaker,
            text: text.slice(0, maxChars - overhead),
          });
        return { cues, truncated: true };
      }
      kept += text.length + overhead;
      cues.push({ at: block.at, end: block.end, speaker, text });
    }
  }
  return { cues, truncated: false };
}

/** The names this file's own voice tags use: a `Name:` naming one of them is that speaker in any source. */
function voicedNames(blocks: Block[]): Set<string> {
  const voiced = new Set<string>();
  for (const b of blocks)
    for (const m of b.payload.matchAll(VOICE)) {
      const name = decodeEntities(m[1] ?? "").trim();
      if (name) voiced.add(name);
    }
  return voiced;
}

/** A span's speaker and words: its voice tag, else a `Name:` prefix where the format or the file's voices allow one. */
function attributed(
  span: { speaker: string | null; payload: string },
  voiced: Set<string>,
  namePrefix: boolean,
): { speaker: string | null; text: string } {
  let speaker = span.speaker;
  let text = plain(span.payload);
  if (!speaker) {
    const named = NAMED.exec(text);
    const name = named?.[1]?.trim();
    if (name && named?.[2] && !/^\d+$/.test(name) && (namePrefix || voiced.has(name))) {
      speaker = name;
      text = named[2].trim();
    }
  }
  return { speaker, text };
}
