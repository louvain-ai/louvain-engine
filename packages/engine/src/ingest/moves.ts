type Added = { key: string; change: "added"; reader?: string };

/**
 * Telling a move from an addition. An added item whose words the collection already held may have moved there; that
 * is known only once the listing has shown which key is gone, so its line waits until then.
 * Twins with the same words pair in listing order, which is arbitrary: a move is only a label on the same work.
 */
export class Moves {
  private readonly waiting = new Map<string, Added[]>();

  constructor(private readonly heldWords: ReadonlySet<string>) {}

  /** Holds back an addition of words the collection held; false when the words are new and it can be said now. */
  hold(words: string, added: Added): boolean {
    if (!this.heldWords.has(words)) return false;
    this.waiting.set(words, [...(this.waiting.get(words) ?? []), added]);
    return true;
  }

  /** The held-back addition a gone item's words went to, if any. */
  claim(words: string | null): Added | undefined {
    return words === null ? undefined : this.waiting.get(words)?.shift();
  }

  /** What was held back and never claimed: plain additions after all. */
  unclaimed(): Added[] {
    return [...this.waiting.values()].flat();
  }
}
