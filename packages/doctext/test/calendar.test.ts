import assert from "node:assert/strict";
import test from "node:test";
import { classifyFile, extractText, readableExtensions } from "../src/index.js";
import { calendarArithmetic } from "./calendar-work.js";
import { looksReadable } from "./looks-readable.js";

/**
 * A calendar is read as its events (`calendar.ts`): what, when in the zone it was written in, where, who,
 * whether it repeats, and its description — never the raw iCalendar with its folds, escapes and time-zone blocks.
 */

const utf8 = (text: string) => new TextEncoder().encode(text);
const ics = (...lines: string[]) =>
  utf8(["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR", ""].join("\r\n"));

test("an .ics, a text/calendar attachment and bare calendar bytes are all a calendar", async () => {
  assert.equal(classifyFile("invite.ics"), "calendar");
  assert.equal(classifyFile("attachment", "text/calendar"), "calendar");
  const bytes = ics("BEGIN:VEVENT", "UID:1", "DTSTART:20261001T090000Z", "SUMMARY:x", "END:VEVENT");
  assert.equal(
    (await extractText(bytes, { filename: "invite" })).kind,
    "calendar",
    "no name at all",
  );
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
  assert.equal(
    (await extractText(bom, { filename: "noname.dat" })).kind,
    "calendar",
    "after a BOM",
  );
});

test("an event in its own zone, folded and escaped, with who and where", async () => {
  const read = await extractText(
    ics(
      "X-WR-CALNAME:Team",
      "BEGIN:VEVENT",
      "UID:2",
      "DTSTART;TZID=Pacific/Auckland:20261001T090000",
      "DTEND;TZID=Pacific/Auckland:20261001T100000",
      "SUMMARY:Pricing review\\, Q4",
      "LOCATION:Room 3",
      "ORGANIZER;CN=Priya Nair:mailto:priya@acme.example",
      "ATTENDEE:mailto:bob@acme.example",
      "DESCRIPTION:Agenda:\\n1. Price\\n2. Terms that are lon",
      " g and folded",
      "END:VEVENT",
    ),
    { filename: "invite.ics" },
  );
  assert.equal(read.reason, undefined);
  assert.equal(
    read.text,
    [
      "Team",
      "",
      "Pricing review, Q4",
      "When: 2026-10-01 09:00 Pacific/Auckland – 10:00 Pacific/Auckland",
      "Where: Room 3",
      "Organiser: Priya Nair <priya@acme.example>",
      "Attendees: bob@acme.example",
      "",
      "Agenda:",
      "1. Price",
      "2. Terms that are long and folded",
    ].join("\n"),
  );
  assert.equal(read.meta.events, 1);
});

test("an all-day event says its day; a calendar with no events says nothing it does not hold", async () => {
  const day = await extractText(
    ics("BEGIN:VEVENT", "UID:3", "DTSTART;VALUE=DATE:20261225", "SUMMARY:Holiday", "END:VEVENT"),
    { filename: "a.ics" },
  );
  assert.match(day.text, /^Holiday\nWhen: 2026-12-25/);
  const empty = await extractText(ics("X-WR-CALNAME:Nothing yet"), { filename: "b.ics" });
  assert.equal(empty.text, "Nothing yet");
});

test("a file that is not a calendar the library can parse is read as its text; one past its deadline is timed out", async () => {
  const raw = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nnot a property\r\n";
  const broken = await extractText(utf8(raw), { filename: "notes.txt" });
  assert.equal(broken.reason, undefined, "the text it is, as before calendars had a reader");
  assert.match(broken.text, /not a property/);
  assert.equal(broken.meta.readAs, "text");
  const late = await extractText(
    ics("BEGIN:VEVENT", "UID:4", "DTSTART:20261001T090000Z", "SUMMARY:x", "END:VEVENT"),
    { filename: "y.ics", deadlineMs: -1 },
  );
  assert.equal(late.reason, "timed-out");
});

test("a DURATION is said, never added to its start: a hundred quintillion weeks reads at once (review P0)", async () => {
  const forever = ics(
    "BEGIN:VEVENT",
    "UID:5",
    "DTSTART:20261001T090000Z",
    "DURATION:P99999999999999999999W",
    "SUMMARY:Forever",
    "END:VEVENT",
  );
  const read = await extractText(forever, { filename: "long.ics" });
  assert.equal(read.reason, undefined);
  assert.match(
    read.text,
    /When: 2026-10-01 09:00 UTC, for 1e\+20 weeks|When: 2026-10-01 09:00 UTC, for \d+ weeks/,
  );
  const review = ics(
    "BEGIN:VEVENT",
    "UID:6",
    "DTSTART:20261001T090000Z",
    "DURATION:PT1H30M",
    "SUMMARY:Review",
    "END:VEVENT",
  );
  const short = await extractText(review, { filename: "short.ics" });
  assert.match(short.text, /When: 2026-10-01 09:00 UTC, for 1 h 30 min/);
  // "At once" is what the read computed against an hour and a half (`calendar-work.ts`), never milliseconds: an
  // end computed by walking the weeks adds the duration and walks months an ordinary event never does.
  const foreverWork = calendarArithmetic(forever);
  assert.equal(foreverWork.durationsAdded, 0, "no end time was computed");
  assert.deepEqual(
    foreverWork,
    calendarArithmetic(review),
    "a forever event reads as an ordinary one",
  );
});

test("one event the library cannot read is skipped and counted; two calendars in one file are both read", async () => {
  const read = await extractText(
    utf8(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:a",
        "DTSTART:20261001T090000Z",
        "SUMMARY:Kept",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:b",
        "DTSTART:20261001T090000Z",
        "RRULE:FREQ=NOPE",
        "SUMMARY:Bad rule",
        "END:VEVENT",
        "END:VCALENDAR",
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:c",
        "DTSTART:20261002T090000Z",
        "SUMMARY:Second file",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    ),
    { filename: "two.ics" },
  );
  assert.equal(read.reason, undefined, read.detail);
  assert.match(read.text, /Kept/);
  assert.match(read.text, /Second file/);
  assert.equal(read.meta.events, 2);
  assert.equal(read.meta.skipped, 1);
});

test("a calendar is a readable kind of its own: a file picker offers it and a reader takes it", () => {
  // `.ics` is its own kind, and must stay in a file picker's list of readable files.
  assert.ok(readableExtensions().includes(".ics"));
  assert.equal(looksReadable("invite.ics", "text/calendar"), true);
});

test("a file of ONE event states it as an invite: UID, start as an instant, organiser; nothing else does", async () => {
  const event = (...extra: string[]) =>
    ics(
      "BEGIN:VEVENT",
      "UID:kick-1@kestrel.example",
      "DTSTART;TZID=Pacific/Auckland:20261001T090000",
      "SUMMARY:Kickoff",
      "ORGANIZER;CN=Owner:mailto:Owner@Kestrel.example",
      ...extra,
      "END:VEVENT",
    );
  const one = await extractText(event(), { filename: "invite.ics" });
  assert.deepEqual(one.meta.invite, {
    uid: "kick-1@kestrel.example",
    start: "2026-09-30T20:00:00.000Z",
    organiser: "owner@kestrel.example",
  });
  assert.equal(
    (await extractText(event("RRULE:FREQ=WEEKLY"), { filename: "i.ics" })).meta.invite,
    undefined,
    "a series is not one event",
  );
  const windows = ics(
    "BEGIN:VEVENT",
    "UID:x@y.example",
    "DTSTART;TZID=Pacific Standard Time:20261001T090000",
    "ORGANIZER:mailto:a@y.example",
    "END:VEVENT",
  );
  // Outlook's Windows name is the CLDR zone it maps to; a name nothing maps names no instant.
  assert.equal(
    (await extractText(windows, { filename: "i.ics" })).meta.invite?.start,
    "2026-10-01T16:00:00.000Z",
  );
  const custom = ics(
    "BEGIN:VEVENT",
    "UID:x@y.example",
    "DTSTART;TZID=Customized Time Zone:20261001T090000",
    "ORGANIZER:mailto:a@y.example",
    "END:VEVENT",
  );
  assert.equal(
    (await extractText(custom, { filename: "i.ics" })).meta.invite,
    undefined,
    "a zone nothing names has no instant",
  );
  const two = ics(
    "BEGIN:VEVENT",
    "UID:a@y.example",
    "DTSTART:20261001T090000Z",
    "ORGANIZER:mailto:a@y.example",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:b@y.example",
    "DTSTART:20261002T090000Z",
    "ORGANIZER:mailto:a@y.example",
    "END:VEVENT",
  );
  assert.equal(
    (await extractText(two, { filename: "i.ics" })).meta.invite,
    undefined,
    "two events are not one invite",
  );
  const allDay = ics(
    "BEGIN:VEVENT",
    "UID:d@y.example",
    "DTSTART;VALUE=DATE:20261001",
    "ORGANIZER:mailto:a@y.example",
    "END:VEVENT",
  );
  assert.equal(
    (await extractText(allDay, { filename: "i.ics" })).meta.invite?.start,
    "2026-10-01T00:00:00.000Z",
  );
});
