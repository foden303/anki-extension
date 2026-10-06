#!/usr/bin/env node
// Task 5.1: record live responses from every Stage 5 data source as test fixtures.
// Usage: node tests/fixtures/probe.mjs            (public endpoints + OpenRouter model list)
//        OPENROUTER_API_KEY=... node tests/fixtures/probe.mjs   (also one free-model chat call)
//        node tests/fixtures/probe.mjs dictionaryapi gtx         (only the named sources)
// The API key is only sent to OpenRouter and is never written to disk.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const USER_AGENT = "anki-add-vocabulary-fixture-probe/0.1 (local development)";
const WORDS = ["light", "resilient", "happy", "depend", "decision"];
const PHRASES = ["give up", "make a decision", "heavy rain"];
const RATE_HEADERS = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after", "content-type"];
const summary = [];
const only = new Set(process.argv.slice(2));
const want = (source) => only.size === 0 || only.has(source);

async function record(file, url, options = {}, transform = (body) => body) {
  const started = Date.now();
  let entry;
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(Number(process.env.PROBE_TIMEOUT_MS) || 15_000) });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { nonJsonBody: text.slice(0, 2000) }; }
    const headers = Object.fromEntries(RATE_HEADERS.filter((name) => response.headers.has(name)).map((name) => [name, response.headers.get(name)]));
    entry = { request: redact(url, options), status: response.status, headers, elapsedMs: Date.now() - started, fetchedAt: new Date().toISOString(), body: transform(body) };
  } catch (error) {
    entry = { request: redact(url, options), error: String(error?.cause?.code || error?.name || error), elapsedMs: Date.now() - started, fetchedAt: new Date().toISOString() };
  }
  await mkdir(dirname(join(OUT, file)), { recursive: true });
  await writeFile(join(OUT, file), `${JSON.stringify(entry, null, 2)}\n`);
  summary.push(`${String(entry.status ?? entry.error).padEnd(14)} ${String(entry.elapsedMs).padStart(5)}ms  ${file}`);
  return entry;
}

function redact(url, options) {
  const headers = { ...(options.headers || {}) };
  if (headers.Authorization) headers.Authorization = "Bearer <redacted>";
  return { method: options.method || "GET", url, headers, body: options.body ? JSON.parse(options.body) : undefined };
}

const slug = (term) => term.replace(/\s+/g, "-");

// DictionaryAPI: single words plus phrases (to capture the "no entry" shape).
for (const term of want("dictionaryapi") ? [...WORDS, ...PHRASES] : []) {
  await record(`dictionaryapi/${slug(term)}.json`, `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`);
}

// Datamuse: relations for single words, means-like for phrases.
const datamuse = (params) => `https://api.datamuse.com/words?${new URLSearchParams({ max: "20", ...params })}`;
for (const word of want("datamuse") ? WORDS : []) {
  await record(`datamuse/${word}.sp.json`, datamuse({ sp: word, md: "pf", max: "1" }));
  for (const relation of ["rel_syn", "rel_ant", "rel_bga", "rel_bgb", "rel_jja", "rel_jjb"]) {
    await record(`datamuse/${word}.${relation}.json`, datamuse({ [relation]: word, md: "pf" }));
  }
}
for (const phrase of want("datamuse") ? PHRASES : []) {
  await record(`datamuse/${slug(phrase)}.ml.json`, datamuse({ ml: phrase, md: "p" }));
}

// Wiktionary REST definitions.
for (const term of want("wiktionary") ? [...WORDS, ...PHRASES, "resilience"] : []) {
  await record(`wiktionary/${slug(term)}.json`, `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term.replace(/\s+/g, "_"))}`, { headers: { "Api-User-Agent": USER_AGENT } });
}

// Google GTX: extra dictionary blocks beyond dt=t.
for (const term of want("gtx") ? ["light", "give up"] : []) {
  const query = new URLSearchParams({ client: "gtx", sl: "en", tl: "vi", q: term });
  for (const dt of ["t", "bd", "ss", "at", "md", "ex"]) query.append("dt", dt);
  await record(`gtx/${slug(term)}.json`, `https://translate.googleapis.com/translate_a/single?${query}`);
}

// OpenRouter model list (public); keep only free models to stay small.
if (!want("openrouter")) finish();
const models = await record("openrouter/models-free.json", "https://openrouter.ai/api/v1/models", {}, (body) => {
  const all = Array.isArray(body?.data) ? body.data : [];
  const free = all.filter((model) => model?.pricing?.prompt === "0" && model?.pricing?.completion === "0");
  return {
    totalModels: all.length,
    freeModels: free.length,
    sampleFullEntry: free[0] || null,
    free: free.map((model) => ({ id: model.id, name: model.name, context_length: model.context_length, architecture: model.architecture, pricing: model.pricing, top_provider: model.top_provider, per_request_limits: model.per_request_limits, expiration_date: model.expiration_date, supported_parameters: model.supported_parameters })),
  };
});

const key = process.env.OPENROUTER_API_KEY;
if (key && models.body?.free?.length) {
  const candidate = models.body.free.find((model) => model.supported_parameters?.includes("response_format")) || models.body.free[0];
  const request = {
    model: candidate.id,
    temperature: 0.2,
    max_tokens: 500,
    messages: [
      { role: "system", content: "Return only JSON: {\"inContextPattern\":string,\"patterns\":[{\"text\":string,\"example\":string}],\"collocations\":[{\"text\":string,\"example\":string}]}. Max 5 items per list. Every item must contain the term." },
      { role: "user", content: "Term: resilient\nType: adjective\nSentence: The company proved resilient in the downturn." },
    ],
  };
  if (candidate.supported_parameters?.includes("response_format")) request.response_format = { type: "json_object" };
  await record("openrouter/chat-free-resilient.json", "https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Anki Add Vocabulary (fixture probe)" },
    body: JSON.stringify(request),
  });
  await record("openrouter/chat-invalid-model.json", "https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "does-not-exist/model:free", messages: [{ role: "user", content: "hi" }], max_tokens: 5 }),
  });
} else {
  summary.push("skipped        OpenRouter chat (set OPENROUTER_API_KEY to record)");
}
await record("openrouter/chat-bad-key.json", "https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: "Bearer sk-or-invalid-fixture-key", "Content-Type": "application/json" },
  body: JSON.stringify({ model: "openrouter/auto", messages: [{ role: "user", content: "hi" }], max_tokens: 5 }),
});

// Local providers (recorded only if running).
if (want("local")) {
  await record("local/ollama-models.json", "http://localhost:11434/v1/models");
  await record("local/lmstudio-models.json", "http://localhost:1234/v1/models");
}
finish();

function finish() {
  console.log(summary.join("\n"));
  process.exit(0);
}
