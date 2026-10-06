// Enrichment for the edit screen: Datamuse + Wiktionary + GTX (+ cached DictionaryAPI), merged per type.
// Only the term leaves the extension; the page sentence and URL are never part of a request.
import "./term-kind.js";
import { WIKTIONARY_USER_AGENT, cleanPattern, cleanSuggestion, fetchJson, parseDatamuse, parseGtx, parseWiktionary } from "./sources.js";

const { classifyTerm, formatPattern } = globalThis.AnkiVocabularyTerm;

const ENRICH_BUDGET_MS = 2500;
const CACHE_TTL_MS = 30 * 60_000;

const PATTERN_WORDS = new Set(["about", "against", "at", "by", "for", "from", "in", "into", "of", "on", "over", "that", "to", "upon", "with"]);
// A follower must score at least this share of the strongest preposition to count as a pattern (5.5 fixtures).
const PATTERN_MIN_SHARE = 0.2;
const COLLOCATION_STOPWORDS = new Set(["a", "an", "the", "his", "her", "its", "their", "my", "your", "our", "it", "them", "him", "me", "us", "you", "more", "most", "less", "least", "very", "so", "too", "such", "other", "same", "own", "new", "old", "many", "much", "few", "all", "any", "some", "this", "that", "these", "those", "which", "what", "who", "and", "or", "but", "not", "is", "are", "was", "be", ...PATTERN_WORDS]);
const SIMILAR_TYPES = new Set(["phrasal verb", "verb + noun", "verb + preposition", "verb + adverb"]);
const IDIOM_SECTIONS = new Set(["idiom", "phrase", "proverb"]);
const LIMITS = { synonyms: 10, antonyms: 10, patterns: 5, collocations: 8, similar: 8, definitions: 5 };

// `area` is chrome.storage.session in the worker; tests and fallback use an in-memory map.
// Writes prune expired entries and the oldest overflow, so a long browsing session cannot fill the quota.
export function createCache({ area, ttlMs = CACHE_TTL_MS, now = Date.now, maxEntries = 200 } = {}) {
  const memory = new Map();
  const remove = async (keys) => {
    if (!keys.length) return;
    if (area) await area.remove(keys);
    else for (const key of keys) memory.delete(key);
  };
  async function prune() {
    const all = area ? await area.get(null) : Object.fromEntries(memory);
    const entries = Object.entries(all).filter(([, entry]) => Number.isFinite(entry?.at));
    const expired = entries.filter(([, entry]) => now() - entry.at >= ttlMs);
    const live = entries.filter(([, entry]) => now() - entry.at < ttlMs).sort((left, right) => left[1].at - right[1].at);
    await remove([...expired, ...live.slice(0, Math.max(0, live.length - maxEntries))].map(([key]) => key));
  }
  return {
    async get(key) {
      const entry = area ? (await area.get(key))[key] : memory.get(key);
      return entry && now() - entry.at < ttlMs ? entry.value : undefined;
    },
    async set(key, value) {
      const entry = { at: now(), value };
      if (area) await area.set({ [key]: entry });
      else memory.set(key, entry);
      await prune();
    },
  };
}

export function createEnricher({ cache = createCache(), budgetMs = ENRICH_BUDGET_MS, fetcher = fetchJson } = {}) {
  return async function enrich({ term: rawTerm, type = "" }) {
    const classified = classifyTerm(rawTerm);
    if (!classified) throw new Error("Invalid term");
    const { term, kind } = classified;
    const key = `enrich:${kind}:${type}:${term.toLowerCase()}`;
    const hit = await cache.get(key);
    if (hit) return hit;

    const controller = new AbortController();
    const deadline = new Promise((resolve) => {
      const timer = setTimeout(() => { controller.abort(); resolve("timeout"); }, budgetMs);
      controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });
    const request = (url, headers) => Promise.race([
      fetcher(url, { headers, signal: controller.signal }).then((value) => ({ status: "ok", value }), () => ({ status: controller.signal.aborted ? "timeout" : "error" })),
      deadline.then(() => ({ status: "timeout" })),
    ]);
    const cachedGtx = await cache.get(`gtx:${term.toLowerCase()}`);
    const dictionary = await cache.get(`dictionary:${term.toLowerCase()}`);

    const datamuseUrls = kind === "word" ? wordDatamuseRequests(term, type) : SIMILAR_TYPES.has(type) ? { similar: datamuse({ ml: term, md: "p" }) } : {};
    const datamuseKeys = Object.keys(datamuseUrls);
    const [wiktionary, gtx, ...datamuseResults] = await Promise.all([
      request(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term.replace(/ /g, "_"))}`, { "Api-User-Agent": WIKTIONARY_USER_AGENT }),
      cachedGtx ? Promise.resolve({ status: "ok", value: null, parsed: cachedGtx }) : request(gtxUrl(term)),
      ...datamuseKeys.map((name) => request(datamuseUrls[name])),
    ]);
    controller.abort();

    const relations = Object.fromEntries(datamuseKeys.map((name, index) => [name, datamuseResults[index].status === "ok" ? parseDatamuse(datamuseResults[index].value) : []]));
    const gtxData = gtx.parsed || (gtx.status === "ok" ? parseGtx(gtx.value) : parseGtx(null));
    const sections = wiktionary.status === "ok" ? parseWiktionary(wiktionary.value) : [];
    const sources = {
      datamuse: datamuseKeys.length === 0 ? "skipped" : worstStatus(datamuseResults),
      wiktionary: wiktionary.status,
      gtx: gtx.status,
    };

    const result = kind === "word"
      ? mergeWord({ term, type, gtx: gtxData, dictionary, sections, relations })
      : mergeCollocation({ term, type, gtx: gtxData, sections, relations });
    const enriched = { term, kind, type, ...result, sources };
    if (Object.values(sources).every((status) => status === "ok" || status === "skipped")) await cache.set(key, enriched);
    return enriched;
  };
}

function wordDatamuseRequests(term, type) {
  const requests = {
    synonyms: datamuse({ rel_syn: term, md: "pf" }),
    antonyms: datamuse({ rel_ant: term, md: "pf" }),
    followers: datamuse({ rel_bga: term, md: "pf" }),
  };
  if (type === "adjective") requests.nounsAfter = datamuse({ rel_jja: term, md: "pf" });
  if (type === "noun") requests.adjectivesBefore = datamuse({ rel_jjb: term, md: "pf" });
  return requests;
}

function mergeWord({ term, type, gtx, dictionary, sections, relations }) {
  // Datamuse lists every POS a word can take; only its first (most common) one must match.
  const matchesType = (item) => !type || item.types[0] === type;
  const typedSections = sections.filter((section) => !type || section.type === type);
  const synonyms = collect(term, LIMITS.synonyms, [
    ["gtx", gtx.synonyms[type] || []],
    ["dictionary", dictionary?.synonyms?.[type] || []],
    ["datamuse", relations.synonyms?.filter(matchesType) || [], true],
  ]);
  const antonyms = collect(term, LIMITS.antonyms, [
    ["dictionary", dictionary?.antonyms?.[type] || []],
    ["datamuse", relations.antonyms?.filter(matchesType) || [], true],
  ]);
  const patterns = collect(term, LIMITS.patterns, [
    ["wiktionary", typedSections.flatMap((section) => section.prepositions.map((word) => patternText(term, word)))],
    ["datamuse", strongPrepositions(relations.followers || []).map((item) => patternText(term, item.word))],
  ], cleanPattern);
  const content = (item, wanted) => item.types[0] === wanted && !COLLOCATION_STOPWORDS.has(item.word) && item.word !== term;
  const collocations = collect(term, LIMITS.collocations, [
    ["datamuse", (relations.nounsAfter || []).filter((item) => content(item, "noun")).map((item) => `${term} ${item.word}`)],
    ["datamuse", (relations.adjectivesBefore || []).filter((item) => content(item, "adjective")).map((item) => `${item.word} ${term}`)],
    ["datamuse", type === "verb" ? (relations.followers || []).filter((item) => content(item, "noun")).map((item) => `${term} ${item.word}`) : []],
  ]);
  const definitions = [
    ...(gtx.definitions[type] || []).map((item) => ({ text: item.text, example: item.example, source: "gtx" })),
    ...typedSections.flatMap((section) => section.definitions.map((text) => ({ text, example: section.examples[0] || "", source: "wiktionary" }))),
  ].slice(0, LIMITS.definitions);
  return { synonyms, antonyms, patterns, collocations, similar: [], definitions, suggestedType: "" };
}

function mergeCollocation({ term, gtx, sections, relations }) {
  const similar = collect(term, LIMITS.similar, [["datamuse", relations.similar || [], true]]);
  const definitions = [
    ...sections.flatMap((section) => section.definitions.map((text) => ({ text, example: section.examples[0] || "", source: "wiktionary" }))),
    ...Object.values(gtx.definitions).flat().map((item) => ({ text: item.text, example: item.example, source: "gtx" })),
  ].slice(0, LIMITS.definitions);
  const suggestedType = sections.some((section) => IDIOM_SECTIONS.has(section.pos)) ? "idiom / fixed expression" : "";
  return { synonyms: [], antonyms: [], patterns: [], collocations: [], similar, definitions, suggestedType };
}

// Ordered, case-insensitive dedupe across sources; Datamuse items keep their POS types for display/filtering.
function collect(term, limit, groups, clean = cleanSuggestion) {
  const seen = new Set([term.toLowerCase()]);
  const items = [];
  for (const [source, values, withTypes] of groups) {
    for (const value of values) {
      const text = clean(withTypes ? value.word : value, 80);
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      items.push(withTypes ? { text, source, types: value.types } : { text, source });
      if (items.length === limit) return items;
    }
  }
  return items;
}

// Without a sentence there is no visible object, so patterns use the generic placeholder.
function patternText(term, preposition) {
  return formatPattern(term, preposition, preposition === "that" ? "+ clause" : "sb/sth");
}

function strongPrepositions(followers) {
  const prepositions = followers.filter((item) => PATTERN_WORDS.has(item.word));
  const top = Math.max(0, ...prepositions.map((item) => item.score));
  return prepositions.filter((item) => item.score >= top * PATTERN_MIN_SHARE);
}

function worstStatus(results) {
  return ["timeout", "error"].find((status) => results.some((result) => result.status === status)) || "ok";
}

function datamuse(params) {
  return `https://api.datamuse.com/words?${new URLSearchParams({ ...params, max: "20" })}`;
}

function gtxUrl(term, targetLanguage = "vi") {
  const query = new URLSearchParams({ client: "gtx", sl: "auto", tl: targetLanguage, q: term });
  for (const dt of ["t", "bd", "ss", "md", "ex"]) query.append("dt", dt);
  return `https://translate.googleapis.com/translate_a/single?${query}`;
}
