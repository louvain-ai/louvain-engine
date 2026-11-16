import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chatCompletions } from "./chat-completions.js";
import { installSetting } from "./install.js";
import { messagesApi } from "./messages-api.js";
import type { Model } from "./model.js";
import { RERANK_MODEL, SCORED_MODEL } from "./scored.js";
import type { Place } from "./steps.js";

/**
 * What a profile of this run changes: the model that answers, and the providers `check` calls once before a run.
 * `scored` is the scored configuration; `ownReranker` swaps Cohere for the published reranker; `openAnswerer` also
 * swaps the answerer for an open model. Everything else (the loop, the tools, the texts, the judge) is shared.
 */
export type Variant = {
  answerer: string;
  model: () => Model;
  check: (signal: AbortSignal, p: Place) => Promise<void>;
};

/**
 * The other two profiles' reranker: the self-tuned Qwen3 reranker, public on the hub, served by the rerank sidecar
 * (`services/rerank/rerank.py`, kind `qwen3-reranker`; the README names the commit to start it at). Their engine.config.ts
 * names the same model.
 */
const OWN_RERANK_MODEL = "Louvain/rerank-4b-erb";

/**
 * The open profile's answerer: Qwen3-235B-A22B-Instruct-2507 (open weights) through an OpenAI-compatible endpoint, by default
 * OpenRouter's, where the model is `qwen/qwen3-235b-a22b-2507`. `ANSWERER_BASE_URL` and `ANSWERER_MODEL` point it at
 * another host, your own included (a vLLM server names it `Qwen/Qwen3-235B-A22B-Instruct-2507`); `ANSWERER_API_KEY`
 * holds its key.
 */
const ossModel = () => ({
  baseUrl: process.env.ANSWERER_BASE_URL ?? "https://openrouter.ai/api/v1",
  model: process.env.ANSWERER_MODEL ?? "qwen/qwen3-235b-a22b-2507",
  keyVariable: "ANSWERER_API_KEY",
  maxOutputTokens: SCORED_MODEL.maxOutputTokens,
});

const say = { role: "user" as const, content: [{ type: "text", text: "OK?" }] };
const ping = { system: "Reply OK.", messages: [say], tools: [], final: true };

const claude = (): Model => messagesApi(SCORED_MODEL);

async function claudeAnswers(signal: AbortSignal) {
  await messagesApi({ ...SCORED_MODEL, maxOutputTokens: 64 })(ping, signal);
  console.log("anthropic: answered");
}

async function cohereAnswers(signal: AbortSignal) {
  const key = process.env.COHERE_API_KEY;
  if (!key) throw new Error("COHERE_API_KEY is not set: the scored reranker needs it");
  const rerank = await fetch("https://api.cohere.com/v2/rerank", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: RERANK_MODEL, query: "check", documents: ["check"] }),
    signal,
  });
  if (!rerank.ok) throw new Error(`cohere rerank answered ${rerank.status}`);
  console.log("cohere rerank: answered");
}

/**
 * The rerank sidecar the engine calls (`LOUVAIN_RERANK_URL`, from the environment or the install's `.env`) scores one text and names the published reranker. It
 * carries the profile's sidecar token, as the engine's call does.
 */
async function sidecarAnswers(signal: AbortSignal, p: Place) {
  const set = installSetting(p.engineRoot, "LOUVAIN_RERANK_URL") ?? "http://localhost:8096";
  const url = set.replace(/\/$/, "");
  const token = readFileSync(join(p.state, "sidecar-token"), "utf8").trim();
  const res = await fetch(`${url}/rerank`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query: "check", documents: [{ id: "0", text: "check" }] }),
    signal,
  });
  if (!res.ok) throw new Error(`the rerank sidecar at ${url} answered ${res.status}`);
  const { model } = (await res.json()) as { model?: string };
  if (model !== OWN_RERANK_MODEL)
    throw new Error(
      `the rerank sidecar at ${url} runs ${model ?? "an unnamed model"}, not ${OWN_RERANK_MODEL}`,
    );
  console.log(`rerank sidecar: answered, ${model}`);
}

async function openAnswers(signal: AbortSignal) {
  const settings = ossModel();
  await chatCompletions({ ...settings, maxOutputTokens: 64 })(ping, signal);
  console.log(`${settings.baseUrl}: ${settings.model} answered`);
}

export const scored: Variant = {
  answerer: SCORED_MODEL.model,
  model: claude,
  check: async (signal) => {
    await claudeAnswers(signal);
    await cohereAnswers(signal);
  },
};

export const ownReranker: Variant = {
  answerer: SCORED_MODEL.model,
  model: claude,
  check: async (signal, p) => {
    await claudeAnswers(signal);
    await sidecarAnswers(signal, p);
  },
};

export const openAnswerer: Variant = {
  answerer: ossModel().model,
  model: () => chatCompletions(ossModel()),
  check: async (signal, p) => {
    await openAnswers(signal);
    await sidecarAnswers(signal, p);
  },
};
