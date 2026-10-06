import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCache, createEnricher } from "../enrich.js";

const ALLOWED_HOSTS = new Set(["api.datamuse.com", "en.wiktionary.org", "translate.googleapis.com"]);
const fixture = async (path) => {
  try { return JSON.parse(await readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8")); } catch { return null; }
};

// Serves recorded fixtures; `overrides(url)` may return a Response, throw, or delay.
function fixtureFetch(log, overrides = () => undefined) {
  return async (url, options = {}) => {
    log.push({ url: String(url), headers: options.headers || {} });
    const custom = await overrides(new URL(url), options);
    if (custom) return custom;
    const parsed = new URL(url);
    let recorded = null;
    if (parsed.hostname === "api.datamuse.com") {
      const relation = [...parsed.searchParams.keys()].find((key) => key.startsWith("rel_") || key === "ml");
      recorded = await fixture(`datamuse/${parsed.searchParams.get(relation).replace(/\s+/g, "-")}.${relation}.json`);
    } else if (parsed.hostname === "en.wiktionary.org") {
      recorded = await fixture(`wiktionary/${decodeURIComponent(parsed.pathname.split("/").pop()).replace(/_/g, "-")}.json`);
    } else if (parsed.hostname === "translate.googleapis.com") {
      recorded = await fixture(`gtx/${parsed.searchParams.get("q").replace(/\s+/g, "-")}.json`);
    }
    if (!recorded) return new Response("not recorded", { status: 503 });
    return new Response(JSON.stringify(recorded.body), { status: recorded.status || 200, headers: { "content-type": "application/json" } });
  };
}

function setup({ overrides, budgetMs = 2500 } = {}) {
  const log = [];
  let clock = 1_000_000;
  globalThis.fetch = fixtureFetch(log, overrides);
  const cache = createCache({ ttlMs: 30 * 60_000, now: () => clock });
  const enrich = createEnricher({ cache, budgetMs });
  return { log, cache, enrich, advance: (ms) => { clock += ms; } };
}

const texts = (items) => items.map((item) => item.text);

test("word: synonyms, antonyms, collocations, patterns, definitions merged by type", async () => {
  const { enrich } = setup();
  const light = await enrich({ term: "light", type: "adjective" });
  assert.equal(light.kind, "word");
  assert.equal(light.synonyms[0].text, "bright");
  assert.equal(light.synonyms[0].source, "gtx");
  assert.ok(light.synonyms.length <= 10);
  assert.equal(new Set(texts(light.synonyms).map((text) => text.toLowerCase())).size, light.synonyms.length, "deduplicated");
  assert.ok(!texts(light.synonyms).includes("light"));
  assert.ok(light.synonyms.filter((item) => item.source === "datamuse").every((item) => item.types.includes("adjective")), "Datamuse filtered by POS");
  assert.deepEqual(texts(light.antonyms).slice(0, 2), ["heavy", "dark"]);
  assert.equal(light.collocations[0].text, "light source");
  assert.equal(light.definitions[0].text, "having a considerable or sufficient amount of natural light; not dark.");
  assert.deepEqual(light.sources, { datamuse: "ok", wiktionary: "ok", gtx: "ok" });

  const depend = await enrich({ term: "depend", type: "verb" });
  assert.deepEqual(texts(depend.patterns).slice(0, 2), ["depend on sb/sth", "depend upon sb/sth"], "patterns name their object");
  assert.equal(depend.patterns[0].source, "wiktionary");
  assert.ok(depend.patterns.length <= 5);

  const decision = await enrich({ term: "decision", type: "noun" });
  assert.equal(decision.collocations[0].text, "final decision");
  assert.deepEqual(texts(decision.antonyms), ["indecision", "indecisiveness"]);
  assert.equal(decision.sources.gtx, "error", "no GTX fixture for decision");
  assert.ok(decision.synonyms.length > 0, "other sources still returned");
});

test("POS filter uses the primary Datamuse type; weak prepositions and function words are dropped", async () => {
  const { enrich } = setup();
  const lightVerb = await enrich({ term: "light", type: "verb" });
  assert.ok(!texts(lightVerb.antonyms).includes("heavy"), "heavy is primarily an adjective");
  assert.ok(texts(lightVerb.antonyms).includes("extinguish"));
  assert.ok(lightVerb.collocations.every((item) => !/ (from|which|for|of|to|a|an|the|it)$/.test(item.text)), texts(lightVerb.collocations).join(","));

  assert.deepEqual(texts((await enrich({ term: "resilient", type: "adjective" })).patterns), ["resilient to sb/sth", "resilient in sb/sth"]);
  assert.deepEqual(texts((await enrich({ term: "happy", type: "adjective" })).patterns), ["happy to sb/sth", "happy in sb/sth", "happy with sb/sth"]);
  assert.deepEqual(texts((await enrich({ term: "depend", type: "verb" })).patterns), ["depend on sb/sth", "depend upon sb/sth"]);
  const resilient = await enrich({ term: "resilient", type: "adjective" });
  assert.ok(!texts(resilient.synonyms).includes("live"), "live is primarily a verb");
});

test("collocation: similar expressions only for verb types, Wiktionary definitions and idiom hint", async () => {
  const { enrich, log } = setup();
  const giveUp = await enrich({ term: "give up", type: "phrasal verb" });
  assert.equal(giveUp.kind, "collocation");
  assert.deepEqual(texts(giveUp.similar).slice(0, 3), ["part with", "relinquish", "resign"]);
  assert.equal(giveUp.definitions.find((item) => item.source === "wiktionary").text, "To surrender; to inform on (someone).");
  assert.equal(giveUp.suggestedType, "");

  const mind = await enrich({ term: "make a decision", type: "verb + noun" });
  assert.ok(texts(mind.similar).includes("make up one's mind"));

  log.length = 0;
  const rain = await enrich({ term: "heavy rain", type: "adjective + noun" });
  assert.deepEqual(rain.similar, []);
  assert.ok(!log.some((entry) => entry.url.includes("datamuse")), "ml skipped for adjective + noun");
  assert.equal(rain.sources.datamuse, "skipped");
  assert.equal(rain.sources.wiktionary, "ok", "404 means no entry, not an error");

  globalThis.fetch = fixtureFetch([], (url) => url.hostname === "en.wiktionary.org"
    ? new Response(JSON.stringify({ en: [{ partOfSpeech: "Idiom", definitions: [{ definition: "To initiate social interaction." }] }] }), { status: 200 })
    : undefined);
  const { enrich: fresh } = { enrich: createEnricher({ cache: createCache({ ttlMs: 1 }), budgetMs: 2500 }) };
  assert.equal((await fresh({ term: "break the ice", type: "verb + noun" })).suggestedType, "idiom / fixed expression");
});

test("a failing or slow source still returns the others within the budget", async () => {
  const failing = setup({ overrides: (url) => { if (url.hostname === "api.datamuse.com") throw new TypeError("network down"); } });
  const partial = await failing.enrich({ term: "depend", type: "verb" });
  assert.equal(partial.sources.datamuse, "error");
  assert.equal(partial.sources.wiktionary, "ok");
  assert.deepEqual(texts(partial.patterns), ["depend on sb/sth", "depend upon sb/sth"]);

  const slow = setup({
    budgetMs: 150,
    overrides: (url, options) => url.hostname === "en.wiktionary.org"
      ? new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response("{}")), 5000);
        options.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); });
      })
      : undefined,
  });
  const started = Date.now();
  const result = await slow.enrich({ term: "light", type: "adjective" });
  assert.ok(Date.now() - started < 1000, "returned at the budget");
  assert.equal(result.sources.wiktionary, "timeout");
  assert.equal(result.synonyms[0].text, "bright");
});

test("oversized and malformed responses are rejected", async () => {
  const huge = setup({ overrides: (url) => url.hostname === "api.datamuse.com" ? new Response(`[${'{"word":"x","score":1},'.repeat(20000)}{"word":"y"}]`) : undefined });
  assert.equal((await huge.enrich({ term: "light", type: "adjective" })).sources.datamuse, "error");

  const broken = setup({ overrides: (url) => url.hostname === "en.wiktionary.org" ? new Response("<!DOCTYPE html><p>maintenance</p>", { status: 200 }) : undefined });
  assert.equal((await broken.enrich({ term: "light", type: "adjective" })).sources.wiktionary, "error");
});

test("only the term is sent, to fixed hosts, with the Wikimedia user agent header", async () => {
  const { enrich, log } = setup();
  await enrich({ term: "light", type: "adjective", sentence: "Please light the candles.", source: { url: "https://secret.example/page" } });
  await enrich({ term: "give up", type: "phrasal verb" });
  assert.ok(log.length > 0);
  for (const { url, headers } of log) {
    const parsed = new URL(url);
    assert.ok(ALLOWED_HOSTS.has(parsed.hostname), url);
    assert.equal(parsed.protocol, "https:");
    assert.ok(!url.includes("candles") && !url.includes("secret"), url);
    if (parsed.hostname === "en.wiktionary.org") assert.match(headers["Api-User-Agent"], /AnkiAddVocabulary/);
  }
});

test("complete results are cached for 30 minutes; partial results are not", async () => {
  const { enrich, log, advance } = setup();
  await enrich({ term: "decision", type: "noun" });
  const afterFirst = log.length;
  await enrich({ term: "decision", type: "noun" });
  assert.equal(log.length, afterFirst * 2, "GTX error made the result partial, so it was not cached");

  const cached = setup();
  await cached.enrich({ term: "light", type: "adjective" });
  const first = cached.log.length;
  await cached.enrich({ term: "light", type: "adjective" });
  assert.equal(cached.log.length, first, "second call served from cache");
  await cached.enrich({ term: "light", type: "noun" });
  assert.ok(cached.log.length > first, "type is part of the cache key");
  const beforeExpiry = cached.log.length;
  cached.advance(31 * 60_000);
  await cached.enrich({ term: "light", type: "adjective" });
  assert.ok(cached.log.length > beforeExpiry, "expired entry refetched");
});

test("GTX data already cached by translate is reused without a request", async () => {
  const { enrich, log, cache } = setup();
  await cache.set("gtx:light", { translation: "ánh sáng", detectedLanguage: "en", types: ["adjective"], meanings: {}, synonyms: { adjective: ["pale"] }, definitions: {}, examples: [] });
  const result = await enrich({ term: "light", type: "adjective" });
  assert.equal(result.synonyms[0].text, "pale");
  assert.ok(!log.some((entry) => entry.url.includes("translate.googleapis.com")));
});

test("patterns keep their placeholders and stay within the relevance threshold", async () => {
  const { enrich } = setup();
  const decision = await enrich({ term: "decision", type: "noun" });
  assert.deepEqual(texts(decision.patterns), ["decision to sb/sth", "decision of sb/sth", "decision in sb/sth", "decision on sb/sth"]);
  assert.ok(!texts(decision.patterns).some((text) => text.includes("that")), "\"that\" scores 14% of the top preposition, below the threshold");
});
