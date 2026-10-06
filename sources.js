// Parsers for public vocabulary sources. Every parser accepts untrusted JSON and never throws.
import "./term-kind.js";

const { WORD_TYPES } = globalThis.AnkiVocabularyTerm;

export const WIKTIONARY_USER_AGENT = "AnkiAddVocabulary/0.1 (Chrome extension for personal Anki vocabulary)";
const MAX_RESPONSE_CHARS = 300_000;

const POS_ALIASES = { exclamation: "interjection", article: "determiner" };
// Datamuse POS tags are case-sensitive: "N", "prop", and "f:…" are not parts of speech.
const DATAMUSE_TAGS = { n: "noun", v: "verb", adj: "adjective", adv: "adverb" };
// GTX labels senses like "British informal" or "Australian"; learners get only neutral, general-English synonyms.
const SKIPPED_SYNONYM_LABEL = /\b(archaic|rare|dated|obsolete|literary|vulgar|offensive|derogatory|informal|slang|humorous|dialect|british|australian|north american|scottish|irish|us)\b/i;
const USAGE_PREPOSITIONS = new Set(["about", "against", "at", "by", "for", "from", "in", "into", "of", "on", "onto", "over", "to", "towards", "upon", "with"]);
const INLINE_TAGS = /^(a|abbr|b|bdi|bdo|cite|code|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|u|var|wbr)$/i;

// Throws on HTTP errors, oversized bodies, and invalid JSON; returns null for 404 (no entry).
export async function fetchJson(url, { headers, signal, maxChars = MAX_RESPONSE_CHARS } = {}) {
  const response = await fetch(url, { headers, signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > maxChars) throw new Error("Response too large");
  return JSON.parse(text);
}

function normalizeWordType(value) {
  const raw = String(value || "").trim().toLowerCase();
  const type = POS_ALIASES[raw] || raw;
  return WORD_TYPES.includes(type) ? type : "";
}

export function cleanSuggestion(value, maximum = 60) {
  const text = String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  return text.length <= maximum && /^\p{L}[\p{L}\p{M}'’ -]*$/u.test(text) ? text : "";
}

// Patterns carry placeholders that a plain suggestion may not: "depend on sb/sth", "sure that + clause".
export function cleanPattern(value, maximum = 80) {
  const text = String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  return text.length <= maximum && /^\p{L}[\p{L}\p{M}'’ /+-]*$/u.test(text) ? text : "";
}

export function htmlToText(html, maximum = 500) {
  const text = String(html ?? "")
    .slice(0, 20_000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style)\b[\s\S]*$/i, " ")
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (_, tag) => (INLINE_TAGS.test(tag) ? "" : " "))
    .replace(/<[^>]*(>|$)/g, " ");
  return decodeEntities(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?\])])/g, "$1")
    .replace(/([[(])\s+/g, "$1")
    .trim()
    .slice(0, maximum);
}

function decodeEntities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (entity, body) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

const array = (value) => (Array.isArray(value) ? value : []);
// NFC so decomposed Vietnamese from GTX compares and deduplicates like typed text.
const string = (value) => (typeof value === "string" ? value.normalize("NFC") : "");
const unique = (values, limit) => [...new Set(values.filter(Boolean))].slice(0, limit);

// Google GTX positional response for dt=t,bd,ss,md,ex.
export function parseGtx(body) {
  const root = array(body);
  const result = { translation: "", detectedLanguage: "", types: [], meanings: {}, synonyms: {}, definitions: {}, examples: [] };
  result.translation = array(root[0]).map((part) => string(array(part)[0])).join("").trim().slice(0, 1000);
  result.detectedLanguage = string(root[2]).slice(0, 10);

  for (const group of array(root[1])) {
    const type = normalizeWordType(array(group)[0]);
    if (!type) continue;
    if (!result.types.includes(type)) result.types.push(type);
    result.meanings[type] = unique(array(group[1]).map((item) => string(item).trim().slice(0, 80)), 5);
  }
  for (const group of array(root[11])) {
    const type = normalizeWordType(array(group)[0]);
    if (!type) continue;
    const words = array(group[1])
      .filter((sense) => !array(array(sense)[2]).flat().some((label) => SKIPPED_SYNONYM_LABEL.test(string(label))))
      .flatMap((sense) => array(array(sense)[0]).map((word) => cleanSuggestion(word)));
    const cleaned = unique(words, 10);
    if (cleaned.length) result.synonyms[type] = cleaned;
  }
  for (const group of array(root[12])) {
    const type = normalizeWordType(array(group)[0]);
    if (!type) continue;
    result.definitions[type] = array(group[1]).slice(0, 3)
      .map((item) => ({ text: htmlToText(string(array(item)[0])), example: htmlToText(string(array(item)[2]), 200) }))
      .filter((item) => item.text);
  }
  result.examples = unique(array(array(root[13])[0]).map((item) => htmlToText(string(array(item)[0]), 200)), 5);
  return result;
}

export function isDictionaryAudio(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "api.dictionaryapi.dev";
  } catch {
    return false;
  }
}

// DictionaryAPI entries (one per etymology) merged by type.
export function parseDictionary(entries) {
  const result = { pronunciation: "", audioUrl: "", types: [], meaning: "", example: "", synonyms: {}, antonyms: {} };
  const list = array(entries).filter((entry) => entry && typeof entry === "object");
  const phonetics = list.flatMap((entry) => array(entry.phonetics));
  result.pronunciation = usPronunciation(list, phonetics);
  const audios = phonetics.map((item) => string(item?.audio)).filter(isDictionaryAudio);
  result.audioUrl = audios.find((url) => /-us\.mp3$/i.test(url)) || audios[0] || "";
  const add = (bucket, type, words) => {
    const merged = unique([...(bucket[type] || []), ...array(words).map((word) => cleanSuggestion(word))], 10);
    if (merged.length) bucket[type] = merged;
  };
  for (const meaning of list.flatMap((entry) => array(entry.meanings))) {
    const type = normalizeWordType(meaning?.partOfSpeech);
    if (!type) continue;
    if (!result.types.includes(type)) result.types.push(type);
    const definitions = array(meaning.definitions);
    result.meaning ||= htmlToText(string(definitions.find((item) => string(item?.definition))?.definition));
    result.example ||= htmlToText(string(definitions.find((item) => string(item?.example))?.example), 300);
    add(result.synonyms, type, [...array(meaning.synonyms), ...definitions.flatMap((item) => array(item?.synonyms))]);
    add(result.antonyms, type, [...array(meaning.antonyms), ...definitions.flatMap((item) => array(item?.antonyms))]);
  }
  return result;
}

// US first: text of the -us recording, then text not tied to a UK/AU recording, then the entry phonetic. Only /…/ forms,
// because DictionaryAPI's US text is sometimes a narrow [ɫɐɪ̯ʔ] transcription.
function usPronunciation(entries, phonetics) {
  const text = (item) => string(item?.text).trim();
  const slashed = (value) => /^\/[^/]+\/$/.test(value);
  const audio = (item) => string(item?.audio);
  const candidates = [
    ...phonetics.filter((item) => /-us\.mp3$/i.test(audio(item))).map(text),
    ...phonetics.filter((item) => !/-(uk|au)\.mp3$/i.test(audio(item))).map(text),
    string(entries[0]?.phonetic).trim(),
  ];
  return (candidates.find(slashed) || candidates.find(Boolean) || "").slice(0, 100);
}

// Datamuse `[{word, score, tags}]`; POS tags become word types.
export function parseDatamuse(body) {
  return array(body)
    .map((item) => ({
      word: cleanSuggestion(item?.word),
      score: Number.isFinite(item?.score) ? item.score : 0,
      types: unique(array(item?.tags).map((tag) => DATAMUSE_TAGS[tag] || ""), 4),
    }))
    .filter((item) => item.word)
    .slice(0, 20);
}

// Wiktionary REST definitions: English sections only, HTML reduced to text.
export function parseWiktionary(body) {
  return array(body?.en).slice(0, 12).map((section) => {
    const pos = string(section?.partOfSpeech).trim().toLowerCase().slice(0, 40);
    const raw = array(section?.definitions).slice(0, 20);
    const definitions = raw.map((item) => htmlToText(string(item?.definition))).filter(Boolean).slice(0, 10);
    const examples = unique(raw.flatMap((item) => array(item?.parsedExamples).map((example) => htmlToText(string(example?.example), 300))), 3);
    const prepositions = unique(definitions.flatMap((text) => {
      const usage = text.match(/\[with ([a-z ,]+?)\]/i);
      return usage ? usage[1].split(/\s*(?:,|\bor\b)\s*/).map((word) => word.trim().toLowerCase()).filter((word) => USAGE_PREPOSITIONS.has(word)) : [];
    }), 4);
    return { pos, type: normalizeWordType(pos), definitions, examples, prepositions };
  }).filter((section) => section.definitions.length);
}
