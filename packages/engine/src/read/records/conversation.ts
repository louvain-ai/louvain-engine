/**
 * The conversation key: which earlier records a record is read against. It is the one its source names
 * (`presentation.email.threadId`, `presentation.thread.id`), never a similarity. The SQL expression, its TypeScript twin
 * and the index on it (`event_log_conversation_idx`) must agree, so change all three together. Presentation is
 * untrusted: a value that is not a non-empty JSON string is no key. It lives in the core so that the readers and the
 * runner key one conversation the same way as ingest, which re-exports it.
 */

/** The key expression over an event body column (`body` or `alias.body`). */
export function conversationKeySql(column = "body"): string {
  if (!/^(?:[a-z_]+\.)?body$/.test(column)) throw new Error(`not an event body column: ${column}`);
  return `coalesce(
  case when jsonb_typeof(${column} #> '{presentation,email,threadId}') = 'string'
       then nullif(${column} #>> '{presentation,email,threadId}', '') end,
  case when jsonb_typeof(${column} #> '{presentation,thread,id}') = 'string'
       then nullif(${column} #>> '{presentation,thread,id}', '') end)`;
}

/** `conversationKeySql` over `event_log.body` unqualified: the indexed expression itself. */
export const CONVERSATION_KEY_SQL = conversationKeySql();

export type Conversation = {
  /** The source's own thread id: a mail thread, a chat thread's root. */
  key: string;
  /**
   * The message STARTS its thread inside a channel, so the conversation it is a turn of is the channel's,
   * not the thread's. A mail thread has no such message: a mailbox is not a conversation, so even a
   * thread's first mail is read against its thread (which has nothing earlier).
   */
  root: boolean;
};

const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** The conversation an event's body names, or null. The TypeScript twin of `CONVERSATION_KEY_SQL`. */
export function conversationOf(body: unknown): Conversation | null {
  const presentation =
    body && typeof body === "object"
      ? (body as { presentation?: unknown }).presentation
      : undefined;
  if (!presentation || typeof presentation !== "object") return null;
  const { email, thread } = presentation as { email?: unknown; thread?: unknown };
  const mail = email && typeof email === "object" ? (email as { threadId?: unknown }) : undefined;
  const mailKey = nonEmpty(mail?.threadId);
  if (mailKey) return { key: mailKey, root: false };
  const chat =
    thread && typeof thread === "object" ? (thread as { id?: unknown; root?: unknown }) : undefined;
  const chatKey = nonEmpty(chat?.id);
  return chatKey ? { key: chatKey, root: chat?.root === true } : null;
}
