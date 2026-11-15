import type { ShapeKind } from "../memory/shape-model.js";
/**
 * The things a question names, decided by grammar rather than by capitals. The subject guard refuses an answer when
 * the question commits to a name the evidence never mentions, so what counts as a name decides what it refuses. The
 * sidecar reads noun chunks, each head's part of speech and its possessives. Empty when
 * unconfigured or unreachable, which the guard reads as no reading: it then demands only known names.
 */
export type QuestionReading = {
  /** What the question names — see `absentSubjectsGiven`. */
  names: string[];
  /**
   * Does it ask about the order of things in time? Evidence is ranked by relevance, the wrong order for a question
   * about sequence: sorting the window chronologically shows the same rows in the order the question is about.
   */
  sequence: boolean;
  /**
   * Names in the question that a corpus may satisfy WITHOUT stating: a country,
   * a region, a date, a named event. Asked about camping trips "in the United
   * States", evidence saying Yellowstone and Utah answers it, and a guard
   * demanding the literal string refuses. Containment is world knowledge; the
   * LABEL is the part a model gets right.
   */
  places: string[];
  /**
   * The subject guard's candidates: the question's names read by both parsers (`names_precise`). Null when the sidecar
   * did not say (down, or a sidecar without the field), which a consumer reads as "fall back to `names`"; an empty list
   * is the sidecar saying "none".
   */
  precise: string[] | null;
  /**
   * What a "how many …" question counts, by lemma. A deterministic count plan
   * is only about the thing asked for if the predicate it counts relates to
   * this noun.
   */
  counted: string | null;
  /**
   * The span of time the question restricts itself to — "in March", "in the
   * last two months". A count is every instance INSIDE this window, and
   * evidence outside it is not weak evidence but wrong evidence.
   */
  window: { from: string; to: string; text: string } | null;
  /**
   * WHAT KIND of question it is, from the shape model (`memory/shape-model.ts`)
   * when one is configured, else null — the half of the job a part-of-speech
   * tagger cannot do. `enumerate` says a complete answer lists more than one
   * item; `multiDocument` that answering plausibly takes several sources;
   * `subjects` the things asked about as the question writes them. Consumers
   * treat null or false as "no shape known".
   */
  kind: ShapeKind | null;
  enumerate: boolean;
  multiDocument: boolean;
  subjects: string[];
};
