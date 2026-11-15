/**
 * A message as text, from `postal-mime`'s parse, run in a reader process (`email-worker.ts`), never in the caller's
 * own. See `email.ts` for the bounds checked before it and the limits passed to the library.
 */

import type PostalMime from "postal-mime";
import { htmlToText } from "./plain.js";
import { decodeEntities } from "./text.js";

/** Attachments named in the text; the rest are counted. */
const MAX_EMAIL_ATTACHMENTS_NAMED = 50;

type Mailbox = { name: string; address?: string | undefined; group?: Mailbox[] | undefined };

/** `Name <address>`, a bare address, or a group's members. */
function addresses(list: Mailbox | Mailbox[] | undefined): string | null {
  const all = (Array.isArray(list) ? list : list ? [list] : []).flatMap((a) =>
    a.group ? a.group : [a],
  );
  const shown = all
    .map((a) => (a.name && a.address ? `${a.name} <${a.address}>` : (a.address ?? a.name ?? "")))
    .filter(Boolean);
  return shown.length > 0 ? shown.join(", ") : null;
}

export async function readEmail(
  parser: typeof PostalMime,
  bytes: Uint8Array,
  limits: { maxNestingDepth: number; maxHeadersSize: number; maxRfc822NestingDepth: number },
): Promise<{ text: string; meta: Record<string, unknown> }> {
  const mail = await parser.parse(bytes, {
    ...limits,
    // The library decodes every attachment in full whatever this says; those buffers sit outside the heap cap, bounded by the input's byte cap.
    attachmentEncoding: "arraybuffer",
  });
  const head = headerLines(mail);
  // Mailers pad a plain part with references (`&#160;`, `&#847;&zwnj;`) as they do an HTML one.
  const body = mail.text?.trim()
    ? decodeEntities(mail.text)
    : mail.html
      ? htmlToText(mail.html)
      : "";
  const attached = mail.attachments.filter((a) => a.disposition !== "inline" || a.filename);
  const list = attachedLine(attached);
  return {
    text: [head.join("\n"), body.trim(), ...list].filter(Boolean).join("\n\n"),
    meta: { attachments: attached.length },
  };
}

type Mail = Awaited<ReturnType<(typeof PostalMime)["parse"]>>;

/** From, To, Cc, Date and Subject, each only when the mail says it. */
function headerLines(mail: Mail): string[] {
  return [
    ["From", addresses(mail.from as Mailbox | undefined)],
    ["To", addresses(mail.to as Mailbox[] | undefined)],
    ["Cc", addresses(mail.cc as Mailbox[] | undefined)],
    // As the sender's mailer wrote it, in their zone: the library's `date` is the same instant in UTC.
    ["Date", mail.headers.find((h) => h.key === "date")?.value.trim() || (mail.date ?? null)],
    ["Subject", mail.subject ?? null],
  ]
    .filter((pair): pair is [string, string] => typeof pair[1] === "string" && pair[1] !== "")
    .map(([name, value]) => `${name}: ${value}`);
}

/** The attachments by name, at most `MAX_EMAIL_ATTACHMENTS_NAMED`, as one line; none when nothing was attached. */
function attachedLine(attached: Mail["attachments"]): string[] {
  const named = attached
    .slice(0, MAX_EMAIL_ATTACHMENTS_NAMED)
    .map((a) => (a.filename ? `${a.filename} (${a.mimeType})` : a.mimeType));
  const more = attached.length - named.length;
  return named.length > 0
    ? [`Attached: ${named.join(", ")}${more > 0 ? `, and ${more} more` : ""}`]
    : [];
}
