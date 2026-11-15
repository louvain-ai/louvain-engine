import type { Block, Message, Usage } from "../model.js";
import type { Question, Step } from "./types.js";

/** One question while it is asked: the conversation, every call made, every id returned and every document opened. */
export type Asking = {
  question: Question;
  system: string;
  chat: Conversation;
  steps: Step[];
  returned: string[];
  read: string[];
  usage: Usage;
};

export function askingOf(question: Question, system: string): Asking {
  return {
    question,
    system,
    chat: new Conversation(question.question),
    steps: [],
    returned: [],
    read: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

/** The conversation as sent: a user block joins the last user message, so a turn's results travel together. */
export class Conversation {
  readonly messages: Message[];

  constructor(question: string) {
    this.messages = [{ role: "user", content: [{ type: "text", text: question }] }];
  }

  user(block: Block): void {
    const last = this.messages.at(-1);
    if (last?.role === "user") last.content.push(block);
    else this.messages.push({ role: "user", content: [block] });
  }

  say(text: string): void {
    this.user({ type: "text", text });
  }

  /** The model's reply, kept exactly as it came, thinking included. */
  assistant(content: Block[]): void {
    this.messages.push({ role: "assistant", content });
  }
}
