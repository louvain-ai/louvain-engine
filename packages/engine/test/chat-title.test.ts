import assert from "node:assert/strict";
import { test } from "node:test";
import type { Revision } from "../src/ingest/revision.js";
import { chatPlace, chatTitle, standsInForTitle } from "../src/read/originals/chat-title.js";
import { sourceMetadata } from "../src/read/originals/metadata.js";

/**
 * A chat message is listed by its opening sentence (`read/originals/chat-title.ts`), beside its place, where its source
 * stated no title of its own (`read/originals/metadata.ts` `titleOf`). All text invented.
 */

const title = (text: string, place: string | null = "all-hands") => chatTitle({ text, place });

test("the opening sentence, its markup stripped and whitespace normalised", () => {
  assert.equal(
    title("Our mission line is still:   make high-performance compute boring. More on Friday."),
    "Our mission line is still: make high-performance compute boring.",
  );
  assert.equal(
    title(
      "<@U042ABC|ana> can you check <https://x.example/a|the rollout doc> :eyes: before *Friday*?",
    ),
    "ana can you check the rollout doc before Friday?",
  );
  assert.equal(
    title("<!here> <@U042ABC> please review https://x.example/pr/7 today"),
    "please review today",
  );
  assert.equal(
    title("> quoted ~line~ with `code` and _stress_ 🎉🎉"),
    "quoted line with code and stress",
  );
  assert.equal(title("<!subteam^S01|@ops> the deploy is paused"), "@ops the deploy is paused");
});

test("a short opening sentence takes the next, and a long one is cut after a whole word", () => {
  assert.equal(
    title("Hi all! The offsite moves to the 14th."),
    "Hi all! The offsite moves to the 14th.",
  );
  const long = title(
    "We have decided to consolidate every regional storage bucket into the two primary regions before the audit window closes next quarter",
  );
  assert.ok(long);
  assert.ok([...long].length <= 80, long);
  assert.ok(long.endsWith("…"), long);
  assert.ok(
    long.startsWith("We have decided to consolidate every regional storage bucket into the two"),
    long,
  );
  assert.ok(!/\s…$/.test(long), long);
});

test("emoji-only, link-only, short and empty messages derive nothing", () => {
  assert.equal(title(":tada: :tada:"), null);
  assert.equal(title("👍"), null);
  assert.equal(title("https://x.example/only-a-link"), null);
  assert.equal(title("<https://x.example/only-a-link>"), null);
  assert.equal(title("k"), null);
  assert.equal(title("   \n  "), null);
});

test("a line naming the channel and a transcript's speakers are passed over", () => {
  const exported = [
    "eng-infra",
    "",
    "Alex: Quick cost comp across regions for reserved vs on-demand GPUs.",
    "Maria: Got it — opening link now.",
  ].join("\n");
  assert.equal(
    title(exported, "eng-infra"),
    "Quick cost comp across regions for reserved vs on-demand GPUs.",
  );
  // One "Word: …" line is the message's own words, not a speaker.
  assert.equal(
    title("Reminder: the freeze starts at noon."),
    "Reminder: the freeze starts at noon.",
  );
  // A line opening with a number is never a speaker.
  assert.equal(title("2026: revenue is up\n2027: forecast flat"), "2026: revenue is up");
});

test("text in other scripts is read by its own sentences and words", () => {
  assert.equal(
    title("明日の会議は十時からです。資料は共有済みです。"),
    "明日の会議は十時からです。",
  );
  assert.equal(
    title("Die Migration ist abgeschlossen. Bitte prüft die Dashboards."),
    "Die Migration ist abgeschlossen.",
  );
  assert.equal(title("Привет! Релиз переносим на четверг."), "Привет! Релиз переносим на четверг.");
  const cjk = title("这是一个非常长的句子".repeat(12));
  assert.ok(cjk && [...cjk].length <= 80 && cjk.endsWith("…"), cjk ?? "");
});

test("the place drops a thread suffix and its #; a stated title stands in only when it says nothing", () => {
  const none = { title: "", container: "C042" };
  assert.equal(chatPlace("#general › thread", undefined, none), "general");
  assert.equal(chatPlace(null, "launch", none), "launch");
  assert.equal(chatPlace(null, undefined, none), null);
  // A feed that titles a thread by its channel and files it under it: the title is the place.
  assert.equal(
    chatPlace(null, undefined, { title: "all-hands", container: "slack/all-hands" }),
    "all-hands",
  );
  assert.equal(
    chatPlace(null, undefined, { title: "Weekly sync", container: "slack/all-hands" }),
    null,
  );
  const read = { firstLine: "<@U1> the deploy is paused", place: "general" };
  assert.equal(standsInForTitle("", read), true);
  assert.equal(standsInForTitle("#general", read), true);
  assert.equal(standsInForTitle("1710501234", read), true);
  assert.equal(standsInForTitle("2024-03-15 10:00", read), true);
  assert.equal(standsInForTitle("<@U1> the deploy", read), true);
  assert.equal(standsInForTitle("Quarterly planning", read), false);
});

const event = (over: {
  title?: string;
  location?: string;
  type?: string;
  connector?: string;
  text: string;
  presentation?: Record<string, unknown>;
}): Revision =>
  ({
    id: "01TESTEVENT0000000000000001",
    idempotencyKey: "k-1",
    kind: "message",
    occurredAt: "2026-11-01T10:00:00.000Z",
    observedAt: "2026-11-01T10:00:00.000Z",
    actor: { sourceUserId: "u1", displayName: "Ana" },
    source: {
      connector: over.connector ?? "slack",
      workspace: "w",
      container: "general",
      nativeId: "C1:1.0",
      ...(over.title === undefined ? {} : { title: over.title }),
      ...(over.location === undefined ? {} : { location: over.location }),
      type: over.type ?? "message",
    },
    body: {
      text: over.text,
      presentation: over.presentation ?? { thread: { id: "C1:1.0", root: true } },
    },
  }) as unknown as Revision;

const origin = {
  presentation: (raw: unknown) => ({ success: true as const, data: (raw ?? {}) as never }),
};
const titled = (e: Revision) =>
  sourceMetadata(e, "00000000-0000-0000-0000-000000000001", origin)?.title;

test("a chat message's listing title is its place and opening sentence", () => {
  assert.equal(
    titled(
      event({
        title: "<@U1|ana> mission line?",
        location: "#all-hands",
        text: "<@U1|ana> mission line?\nmore",
      }),
    ),
    "all-hands · ana mission line?",
  );
  // A generic inbound record whose type says it is a chat thread, titled by its channel, its text a channel export.
  assert.equal(
    titled(
      event({
        connector: "http",
        type: "slack",
        title: "all-hands",
        location: "#all-hands",
        text: "all-hands\n\nmaya: Our mission line is still: make high-performance compute boring.\nleo: agreed",
        presentation: {},
      }),
    ),
    "all-hands · Our mission line is still: make high-performance compute boring.",
  );
  // The same with no location: the channel is known only as the title and the collection it is filed under.
  for (const type of ["slack", "gchat"])
    assert.equal(
      titled(
        event({
          connector: "http",
          type,
          title: "general",
          text: "general\n\nmaya: The offsite moves to the 14th.\nleo: noted",
          presentation: {},
        }),
      ),
      "general · The offsite moves to the 14th.",
      type,
    );
  // Nothing to say: the place, unless the message is only a link (the listing shows its preview instead).
  assert.equal(titled(event({ location: "#random", text: ":tada:" })), "random");
  assert.equal(
    titled(
      event({ title: "https://x.example/a", location: "#random", text: "https://x.example/a" }),
    ),
    "https://x.example/a",
  );
});

test("a title the source wrote stands, and a document or a mail is titled as before", () => {
  assert.equal(
    titled(
      event({
        connector: "teams",
        title: "Quarterly planning",
        location: "Teams › Ops",
        text: "hello there all",
      }),
    ),
    "Quarterly planning",
  );
  assert.equal(
    titled(
      event({
        connector: "slack",
        location: "#general",
        text: "Design notes\n\nbody",
        presentation: { document: {} },
      }),
    ),
    "Design notes",
  );
  assert.equal(
    titled(
      event({
        connector: "gmail",
        type: "email",
        text: "Subject line here\n\nbody",
        presentation: {},
      }),
    ),
    "Subject line here",
  );
});

test("a build's own chat title is asked first, and its null takes the generic one", () => {
  const withRules = (chatTitleRule: () => string | null) =>
    sourceMetadata(
      event({ location: "#ops", text: "the deploy is paused until noon" }),
      "00000000-0000-0000-0000-000000000001",
      { ...origin, rules: { chatTitle: chatTitleRule } },
    )?.title;
  assert.equal(
    withRules(() => "Deploy paused"),
    "ops · Deploy paused",
  );
  assert.equal(
    withRules(() => null),
    "ops · the deploy is paused until noon",
  );
});
