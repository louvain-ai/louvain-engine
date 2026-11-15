/**
 * A transcript or subtitle file (WebVTT, SubRip) as who said what, when: one parser for every caller, its own because
 * the available libraries mis-decode character references, misread SubRip stamps and recurse per nested tag. A file is parsed in
 * the reader's own process (`subtitles.ts`), which holds the deadline; a transcript already cut at
 * `MAX_TRANSCRIPT_CHARS` is parsed where the caller holds it.
 */
import { type CueOptions, parseCues } from "./subtitles-cues.js";
import { type Turn, turnsOf } from "./subtitles-turns.js";

/** `1:02:03` / `2:03` — a turn's offset into the recording. */
export function offset(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * A `.vtt` or `.srt` file as text: a line per turn, `[2:03] Priya Nair: …`, the one form a transcript is read in,
 * whatever wrote it. A file that names no speakers (a film's subtitles) keeps a line per cue with its time, rather than
 * one unattributed paragraph; a file with no timed cue at all is not subtitles, and reads as the text it is.
 */
export function subtitleText(
  raw: string,
  maxChars: number,
): { text: string; meta: Record<string, unknown> } {
  const { cues, truncated } = parseCues(raw, { maxChars });
  if (cues.length === 0) return { text: raw, meta: { readAs: "text" } };
  const named = cues.some((c) => c.speaker !== null);
  const lines = named
    ? turnsOf(cues).map(
        (t) => `${typeof t.at === "number" ? `[${offset(t.at)}] ` : ""}${t.speaker}: ${t.text}`,
      )
    : cues.map((c) => `${c.at !== null ? `[${offset(c.at)}] ` : ""}${c.text}`);
  const speakers = new Set(cues.flatMap((c) => (c.speaker ? [c.speaker] : [])));
  return {
    text: lines.join("\n"),
    meta: { cues: cues.length, speakers: speakers.size, ...(truncated ? { truncated: true } : {}) },
  };
}
