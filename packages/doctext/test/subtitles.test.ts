import assert from "node:assert/strict";
import test from "node:test";
import { assertLinearWork } from "../../engine-core/test/work.js";
import {
  classifyFile,
  cueSeconds,
  extractText,
  mergeTurns,
  parseCues,
  readableExtensions,
} from "../src/index.js";
import { looksReadable } from "./looks-readable.js";

/**
 * A transcript or subtitle file is read as who said what, when (`subtitles.ts`): the one parser every
 * `.vtt`/`.srt` reads through, never the timing lines and cue numbers as prose.
 */

const utf8 = (text: string) => new TextEncoder().encode(text);

test("a .vtt, a .srt, text/vtt and a WEBVTT signature are subtitles, still accepted, and read again from text", () => {
  assert.equal(classifyFile("standup.vtt"), "subtitles");
  assert.equal(classifyFile("film.srt"), "subtitles");
  assert.equal(classifyFile("transcript", "text/vtt"), "subtitles");
  assert.equal(classifyFile("captions", "application/x-subrip"), "subtitles");
  assert.equal(classifyFile("transcript", undefined, utf8("﻿WEBVTT\n\n")), "subtitles");
  assert.ok(readableExtensions().includes(".vtt") && readableExtensions().includes(".srt"));
  assert.equal(looksReadable("standup.vtt"), true);
});

test("a stamp is read in either separator, with or without hours", () => {
  assert.equal(cueSeconds("00:01:02.500"), 62.5);
  assert.equal(cueSeconds("01:02.5"), 62.5);
  assert.equal(cueSeconds("01:02:03,500"), 3723.5);
  assert.equal(cueSeconds("nonsense"), null);
});

const vtt = (...cues: [string, string][]) =>
  `WEBVTT\n\n${cues.map(([timing, text]) => `${timing}\n${text}`).join("\n\n")}`;
const speakersOf = (raw: string, namePrefix = false) =>
  parseCues(raw, { namePrefix }).cues.map((c) => [c.speaker, c.text]);

test("the voice tag names the speaker; references are decoded once; several voices in a cue are several turns", () => {
  const { cues } = parseCues(
    [
      "WEBVTT",
      "",
      "NOTE a comment block is not a cue",
      "",
      "1",
      "00:00:01.000 --> 00:00:02.000 align:start",
      "<v.loud Priya &amp; Co>We&#8217;ll <b>hold</b> &amp;lt; 40</v>",
      "",
      "00:00:02.500 --> 00:00:04.000",
      "and ship Friday.",
    ].join("\n"),
  );
  assert.deepEqual(cues, [
    { at: 1, end: 2, speaker: "Priya & Co", text: "We’ll hold &lt; 40" },
    { at: 2.5, end: 4, speaker: "Priya & Co", text: "and ship Friday." },
  ]);
  // The case: only the first voice counted, and A said both.
  assert.deepEqual(
    speakersOf(
      vtt(["00:00:01.000 --> 00:00:03.000", "<v A>I refuse.</v> <v B>I agree to pay.</v>"]),
    ),
    [
      ["A", "I refuse."],
      ["B", "I agree to pay."],
    ],
  );
});

test("a cue naming nobody continues the speaker only within seconds, in order", () => {
  // Forty-five minutes later is nobody's.
  assert.deepEqual(
    speakersOf(
      vtt(
        ["00:00:01.000 --> 00:00:02.000", "<v Priya Nair>Hi all.</v>"],
        ["00:45:00.000 --> 00:45:02.000", "I'll sign the contract today."],
      ),
    ),
    [
      ["Priya Nair", "Hi all."],
      [null, "I'll sign the contract today."],
    ],
  );
  // Within three seconds of the previous cue's end it is the same utterance; a cue going back in time is not.
  assert.deepEqual(
    speakersOf(
      vtt(
        ["00:00:10.000 --> 00:00:12.000", "<v Sam>Great.</v>"],
        ["00:00:14.500 --> 00:00:16.000", "I'll send the money."],
        ["00:00:05.000 --> 00:00:06.000", "earlier words"],
      ),
    ),
    [
      ["Sam", "Great."],
      ["Sam", "I'll send the money."],
      [null, "earlier words"],
    ],
  );
});

test("a Name: prefix is a speaker only where the format writes one, or the file's voice tags name them", () => {
  const shapes = [
    "Note: the budget is final",
    "Action item: Priya sends the quote",
    "Q3 revenue: 4.2M",
    "https: is the scheme",
    "So to be clear: I will sign it",
  ];
  // A file never takes a speaker from shape alone, and keeps the words whole.
  for (const text of shapes)
    assert.deepEqual(speakersOf(vtt(["00:00:01.000 --> 00:00:02.000", text])), [[null, text]]);
  // A film's first cue does not make every later line the narrator's.
  assert.deepEqual(
    speakersOf(
      vtt(
        ["00:00:01.000 --> 00:00:02.000", "NARRATOR: In the beginning."],
        ["00:00:02.500 --> 00:00:04.000", "I'll pay you tomorrow."],
      ),
    ),
    [
      [null, "NARRATOR: In the beginning."],
      [null, "I'll pay you tomorrow."],
    ],
  );
  // A name the file's voice tags use is that speaker.
  assert.deepEqual(
    speakersOf(
      vtt(
        ["00:00:01.000 --> 00:00:02.000", "<v Priya Nair>Morning.</v>"],
        ["00:01:00.000 --> 00:01:02.000", "Priya Nair: I'll send it."],
      ),
    ),
    [
      ["Priya Nair", "Morning."],
      ["Priya Nair", "I'll send it."],
    ],
  );
  // A format that writes every cue as `Name: …`: every cue is `Name: …`, and a number is never a name.
  assert.deepEqual(
    speakersOf(
      vtt(
        ["00:00:05.000 --> 00:00:06.000", "Sam Okoro: <i>Agreed.</i>"],
        ["00:00:07.000 --> 00:00:08.000", "12: a number is not a speaker"],
      ),
      true,
    ),
    [
      ["Sam Okoro", "Agreed."],
      ["Sam Okoro", "12: a number is not a speaker"],
    ],
  );
});

test("a SubRip file names nobody on shape alone, and a film's subtitles read as a line per cue", async () => {
  const call = await extractText(
    utf8(
      "1\r\n00:00:16,246 --> 00:00:19,100\r\nPriya Nair: Thanks for joining.\r\n\r\n2\r\n00:00:19,300 --> 00:00:22,000\r\nLet's start.\r\n\r\n3\r\n00:01:02,500 --> 00:01:06,000\r\nSam Okoro: I'll send it Friday.\r\n",
    ),
    { filename: "call.srt" },
  );
  assert.equal(call.kind, "subtitles");
  assert.equal(
    call.text,
    // A file takes no speaker from a `Name:` prefix alone: the words stay whole, each cue with its time.
    "[0:16] Priya Nair: Thanks for joining.\n[0:19] Let's start.\n[1:02] Sam Okoro: I'll send it Friday.",
  );
  assert.equal(call.meta.speakers, 0);

  const film = await extractText(
    utf8(
      '1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n01:00:03,000 --> 01:00:04,000\n<font color="#fff">Goodbye.</font>\n',
    ),
    { filename: "film.srt" },
  );
  assert.equal(film.text, "[0:01] Hello there.\n[1:00:03] Goodbye.");
});

test("the read stops at maxChars of kept text and says so", async () => {
  const cue = (i: number) =>
    `00:00:${String(i % 60).padStart(2, "0")}.000 --> 00:00:59.000\nSpeaker ${i % 2}: ${"word ".repeat(20)}`;
  const raw = `WEBVTT\n\n${Array.from({ length: 2_000 }, (_, i) => cue(i)).join("\n\n")}`;
  const read = await extractText(utf8(raw), { filename: "long.vtt", maxChars: 5_000 });
  assert.equal(read.truncated, true);
  assert.ok(read.text.length <= 5_000, `kept ${read.text.length}`);
  const { cues } = parseCues(raw, { maxChars: 5_000 });
  const rendered = cues.reduce((n, c) => n + c.text.length + (c.speaker?.length ?? 0) + 14, 0);
  assert.ok(rendered <= 5_000, `the parse stops at the budget, prefixes counted: ${rendered}`);

  // One cue longer than the budget keeps its beginning; the file is not read as empty.
  const long = parseCues(vtt(["00:00:01.000 --> 00:00:02.000", "word ".repeat(10_000)]), {
    maxChars: 1_000,
  });
  assert.equal(long.truncated, true);
  assert.equal(long.cues.length, 1);
  assert.ok((long.cues[0]?.text.length ?? 0) > 900);
});

test("a .vtt with no timed cue reads as the text it is, not as nothing", async () => {
  const read = await extractText(utf8("Call notes, not subtitles.\nSecond line."), {
    filename: "notes.vtt",
  });
  assert.equal(read.reason, undefined);
  assert.equal(read.text, "Call notes, not subtitles.\nSecond line.");
});

test("a transcript file is parsed in the reader's own process, which holds the deadline", async () => {
  const raw = `WEBVTT\n\n${"00:00:01.000 --> 00:00:02.000\n<a x\n\n".repeat(200_000)}`;
  const read = await extractText(utf8(raw), { filename: "slow.vtt", deadlineMs: 1 });
  assert.equal(read.reason, "timed-out");
});

/**
 * Hostile input: every expression is linear, so each of these finishes quickly. Deep nesting would overflow a
 * recursive parser's stack; a backtracking voice pattern would take hours on the second.
 */
test("hostile transcripts are read in linear time", () => {
  // Linear, asserted as the characters read at 4N against N, counted (`work.ts`): a clock budget fails a linear parse on
  // a slow runner, and a ratio of CPU time measures the load.
  const shapes: Record<string, (n: number) => string> = {
    "nested tags": (n) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${"<b>".repeat(n / 3)}x\n`,
    "a voice tag that never closes": (n) =>
      `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v${" ".repeat(n)}x\n`,
    "a tag opener run": (n) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${"<".repeat(n)}\n`,
    "a colon-free first line": (n) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${"a".repeat(n)}\n`,
    "a stamp of digits": (n) => `WEBVTT\n\n${"1".repeat(n)}:00:01.000 --> 00:00:02.000\nx\n`,
    "blank-ish lines": (n) => `WEBVTT\n${"\n \t".repeat(n / 3)}`,
    "a cue per line": (n) => `WEBVTT\n\n${"00:00:01.000 --> 00:00:02.000\nx\n\n".repeat(n / 40)}`,
  };
  for (const [name, shape] of Object.entries(shapes))
    assertLinearWork(name, shape, (text) => parseCues(text), 250_000);
});

test("two speakers the vendor named alike but identified apart stay two turns", () => {
  const merged = mergeTurns([
    { speaker: "Sam", identity: { email: "sam@acme.test" }, text: "I'll take the deck." },
    { speaker: "Sam", identity: { email: "sam@customer.test" }, text: "And we'll review it." },
    { speaker: "Sam", identity: { email: "sam@customer.test" }, text: "By Monday." },
  ]);
  assert.deepEqual(
    merged.map((t) => [t.identity?.email, t.text]),
    [
      ["sam@acme.test", "I'll take the deck."],
      ["sam@customer.test", "And we'll review it. By Monday."],
    ],
  );
});
