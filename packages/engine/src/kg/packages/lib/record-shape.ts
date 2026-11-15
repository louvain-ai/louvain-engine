import { isObject, str } from "./text.js";

/**
 * WHAT KIND OF RECORD THIS IS, BY WHAT IT SAYS OF ITSELF: its presentation first, then its listing's type
 * (`source_revision.kind`), then its connector. One rule for every reader of it — which search hits are a
 * conversation's messages (`passagesAround`, `kg/read/passages.ts`), and a build that heads a passage by its record's
 * kind — so a source cannot be a chat to one and a document to the other. Anything not recognised is a document.
 */
export type Shape = "chat" | "email" | "ticket" | "doc";

const CHAT_KINDS = new Set([
  "slack",
  "teams",
  "discord",
  "chat",
  "google-chat",
  "mattermost",
  "message",
]);
const EMAIL_KINDS = new Set(["gmail", "outlook", "email", "mail", "exchange"]);
const TICKET_KINDS = new Set([
  "jira",
  "linear",
  "github",
  "gitlab",
  "zendesk",
  "intercom",
  "freshdesk",
  "servicenow",
  "asana",
  "clickup",
  "monday",
  "trello",
  "shortcut",
  "hubspot",
  "salesforce",
  "pipedrive",
  "attio",
  "ticket",
  "issue",
  "record",
]);

export function recordShape(record: {
  /** `event_log.body.presentation`. */
  presentation: Record<string, unknown>;
  /** `event_log.connector`. */
  connector: string;
  /** `source_revision.kind`, when the record was listed. */
  kind?: string | null | undefined;
}): Shape {
  const p = record.presentation;
  const kind = str(record.kind).toLowerCase();
  const connector = str(record.connector).toLowerCase();
  if (isObject(p.email) || EMAIL_KINDS.has(kind) || EMAIL_KINDS.has(connector)) return "email";
  if (isObject(p.record) || TICKET_KINDS.has(kind) || TICKET_KINDS.has(connector)) return "ticket";
  if (isObject(p.document)) return "doc";
  if (CHAT_KINDS.has(kind) || CHAT_KINDS.has(connector)) return "chat";
  return "doc";
}
