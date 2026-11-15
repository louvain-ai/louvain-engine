import type { Source } from "./source.js";

/**
 * A document as the messages a connector would send: a mail thread one part per message, a channel export one part per
 * speaker's message, anything else one part. A part's key is the dsid alone, or `<dsid>#<n>` when there are several.
 */
export type MailHeader = {
  from: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
};
export type Part =
  | { kind: "mail"; key: string; header: MailHeader; body: string; index: number }
  | { kind: "chat"; key: string; speaker: string; body: string; index: number }
  | { kind: "whole"; key: string; body: string; index: number };

export function splitDocument(source: Source, text: string, dsid: string): Part[] {
  if (source === "gmail") return splitMail(text, dsid);
  if (source === "slack") return splitChat(text, dsid);
  return [{ kind: "whole", key: dsid, body: text, index: 0 }];
}

const keyOf = (dsid: string, index: number, count: number): string =>
  count === 1 ? dsid : `${dsid}#${index + 1}`;

const HEADER = /^(From|To|Cc|Date|Subject|Attachments):\s?(.*)$/i;

/** A block starts at a `From:` line followed by another header line, and its body runs to the next block. */
function splitMail(text: string, dsid: string): Part[] {
  const lines = text
    .split("\n")
    .flatMap((line) =>
      /^From:.*\\n(To|Cc|Date|Subject):/i.test(line) ? line.split("\\n") : [line],
    );
  const starts = lines.flatMap((line, i) =>
    /^From:\s/i.test(line) && /^(To|Cc|Date|Subject):/i.test(lines[i + 1] ?? "") ? [i] : [],
  );
  if (starts.length === 0) return [{ kind: "whole", key: dsid, body: text, index: 0 }];
  return starts.map((start, n) => {
    const end = starts[n + 1] ?? lines.length;
    const { header, bodyAt } = headerOf(lines, start, end);
    const body = lines.slice(bodyAt, end).join("\n").trim();
    return { kind: "mail", key: keyOf(dsid, n, starts.length), header, body, index: n };
  });
}

function headerOf(lines: readonly string[], start: number, end: number) {
  const fields: Record<string, string> = {};
  let i = start;
  for (; i < end; i += 1) {
    const m = HEADER.exec(lines[i] ?? "");
    if (!m?.[1]) break;
    fields[m[1].toLowerCase()] = (m[2] ?? "").trim();
  }
  const header: MailHeader = {
    from: fields.from ?? "",
    ...(fields.to ? { to: fields.to } : {}),
    ...(fields.cc ? { cc: fields.cc } : {}),
    ...(fields.subject ? { subject: fields.subject } : {}),
    ...(fields.date ? { date: fields.date } : {}),
  };
  return { header, bodyAt: i };
}

/** `Speaker: text` starts a message (one to four words, no URL or sentence punctuation); other lines continue one. */
function splitChat(text: string, dsid: string): Part[] {
  const messages: { speaker: string; body: string[] }[] = [];
  let inFence = false;
  for (const line of text.split("\n").slice(1)) {
    const fenced = inFence;
    if ((line.match(/```/g)?.length ?? 0) % 2 === 1) inFence = !inFence;
    const speaker = fenced ? null : speakerOf(line);
    if (speaker) messages.push({ speaker: speaker.name, body: [speaker.text] });
    else messages.at(-1)?.body.push(line);
  }
  const real = messages.filter((m) => m.body.join("\n").trim().length > 0);
  if (real.length === 0) return [{ kind: "whole", key: dsid, body: text, index: 0 }];
  return real.map((m, n) => ({
    kind: "chat",
    key: keyOf(dsid, n, real.length),
    speaker: m.speaker,
    body: m.body.join("\n").trim(),
    index: n,
  }));
}

function speakerOf(line: string): { name: string; text: string } | null {
  const m = /^([^:\n]{1,40}):\s(.*)$/.exec(line);
  const name = m?.[1]?.trim() ?? "";
  const plain =
    name.split(/\s+/).length <= 4 && !/https?|[.?!,;]$|^\d/.test(name) && !/[()[\]{}`"]/.test(name);
  return m && plain ? { name, text: m[2] ?? "" } : null;
}
