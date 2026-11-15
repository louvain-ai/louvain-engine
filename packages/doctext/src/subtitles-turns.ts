/** Speaker turns: consecutive sentences by one speaker merged, within a time bound and only for the same identity. */
import { type Cue, follows } from "./subtitles-cues.js";

/**
 * Who a speaker is, as the transcript's writer states it — never read off the label. `email` and `id` are what the
 * writer attached to that speaker (a party, a matched invitee); `own` is the recorder's own channel (a "me"
 * microphone). Absent where the writer says only a name. Presentation: binding a speaker to a person is a later,
 * separate decision, never an access input.
 */
type SpeakerIdentity = { email?: string; id?: string; own?: true };

/** One speaker's turn: consecutive sentences by the same speaker are merged. */
export type Turn = {
  speaker: string;
  /** Who the transcript's writer says the speaker is (`SpeakerIdentity`); two turns merge only when this agrees too. */
  identity?: SpeakerIdentity;
  text: string;
  /** Seconds from the start of the recording, when the source says. */
  at?: number | null;
  /** Seconds from the start at which the turn's last cue ends, when the source says: bounds a merge. */
  end?: number | null;
};

export const UNKNOWN_SPEAKER = "Unknown speaker";

/**
 * Consecutive turns by the same speaker, as one. Where both turns say when they ran, only while the next starts within
 * `CONTINUES_WITHIN_S` of the last one's end and not before it: the words a speaker says minutes later are their own
 * turn, with their own time. A writer that gives no timing merges with no time bound.
 */
/** Two speakers the writer named the same but identified differently are two people: never one merged turn. */
const identityKey = (who: SpeakerIdentity | undefined): string =>
  who ? `${who.email ?? ""}\u0000${who.id ?? ""}\u0000${who.own ? "own" : ""}` : "";

export function mergeTurns(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of turns) {
    const text = t.text.replace(/\s+/g, " ").trim();
    if (text === "") continue;
    const speaker = t.speaker.trim() || UNKNOWN_SPEAKER;
    const at = typeof t.at === "number" ? t.at : null;
    const end = typeof t.end === "number" ? t.end : null;
    const last = out.at(-1);
    const timed = typeof last?.end === "number" && at !== null;
    if (
      last &&
      last.speaker === speaker &&
      identityKey(last.identity) === identityKey(t.identity) &&
      (!timed || follows({ at: last.at ?? null, end: last.end ?? null }, at))
    ) {
      last.text = `${last.text} ${text}`;
      if (end !== null) last.end = Math.max(end, last.end ?? end);
    } else
      out.push({
        speaker,
        ...(t.identity ? { identity: t.identity } : {}),
        text,
        ...(at !== null ? { at } : {}),
        ...(end !== null ? { end } : {}),
      });
  }
  return out;
}

export const turnsOf = (cues: Cue[]): Turn[] =>
  mergeTurns(
    cues.map((c) => ({
      speaker: c.speaker ?? UNKNOWN_SPEAKER,
      text: c.text,
      ...(c.at !== null ? { at: c.at } : {}),
      ...(c.end !== null ? { end: c.end } : {}),
    })),
  );
