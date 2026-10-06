// Word type (part of speech) for a selected word, from its page sentence plus dictionary candidates.
import nlp from "./vendor/compromise-two.mjs";
import "./term-kind.js";

const { WORD_TYPES, formatPattern } = globalThis.AnkiVocabularyTerm;

// Most specific compromise tag first: pronouns are also Noun, auxiliaries are also Verb.
const TAG_TYPES = [
  ["Pronoun", "pronoun"], ["Determiner", "determiner"], ["Preposition", "preposition"],
  ["Conjunction", "conjunction"], ["Expression", "interjection"], ["Adverb", "adverb"],
  ["Adjective", "adjective"], ["Verb", "verb"], ["Noun", "noun"],
];

const PREPOSITIONS = new Set([
  "about", "above", "across", "against", "along", "among", "around", "behind", "below", "beneath", "beside",
  "between", "beyond", "despite", "inside", "into", "near", "onto", "outside", "over", "through", "toward",
  "towards", "under", "underneath", "upon", "within", "without",
]);
const OBJECT_PRONOUNS = new Set(["me", "him", "her", "us", "them", "it"]);
const PATTERN_PREPOSITIONS = new Set(["about", "against", "at", "by", "for", "from", "in", "into", "of", "on", "over", "to", "upon", "with", "that"]);


// Order: the sentence type when the dictionary agrees, else the first dictionary type, else the sentence type alone.
export function detectWordType({ term, sentence, candidates = [] }) {
  const contextType = sentence ? contextWordType(term, sentence) : "";
  const known = candidates.filter((type) => WORD_TYPES.includes(type));
  const type = contextType && (known.length === 0 || known.includes(contextType)) ? contextType : known[0] || "";
  const detected = [...new Set([contextType, ...known].filter(Boolean))];
  return { type, contextType, detected };
}

// Tagged tokens with base forms ("gave" → root "give"); shared with collocation-type.js.
export function tagTokens(text) {
  const doc = nlp(String(text).slice(0, 1000));
  doc.compute("root");
  return doc.json({ root: true })
    .flatMap((part) => part.terms)
    .filter((token) => token.text)
    .map((token) => ({ text: token.text, key: letters(token.text), tags: new Set(token.tags), root: token.root || "" }));
}

export function contextWordType(term, sentence) {
  const tokens = tagTokens(sentence);
  const range = findTerm(tokens, letters(term));
  if (!range) return "";
  const [start, end] = range;
  if (end > start) {
    const parts = tokens.slice(start, end + 1).map((token) => tagType(token.tags));
    return parts.includes("adjective") ? "adjective" : parts.at(-1) || "";
  }
  return correctedType(tokens, start);
}

// "proved resilient in the downturn" → "resilient in"; "interested in learning" → "interested in doing sth".
export function contextPattern(term, sentence) {
  if (!sentence) return "";
  const tokens = tagTokens(sentence);
  const range = findTerm(tokens, letters(term));
  if (!range) return "";
  const next = tokens[range[1] + 1];
  if (!next || !PATTERN_PREPOSITIONS.has(next.key)) return "";
  const after = tokens[range[1] + 2];
  if (next.key === "that") return formatPattern(term, "that", "+ clause");
  if (after?.tags.has("Gerund")) return formatPattern(term, next.key, "doing sth");
  if (next.key === "to" && after?.tags.has("Infinitive")) return formatPattern(term, "to", "do sth");
  return formatPattern(term, next.key);
}

// Small rules for tagger mistakes seen in the Task 5.3 fixtures.
function correctedType(tokens, index) {
  const token = tokens[index];
  const type = tagType(token.tags);
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  const nextStartsObject = next && (next.tags.has("Determiner") || next.tags.has("Possessive") || OBJECT_PRONOUNS.has(next.key));
  const previousModifies = previous && ["Determiner", "Adjective", "Possessive", "Value"].some((tag) => previous.tags.has(tag));

  // "under the table": a preposition tagged as adjective/adverb because of its object.
  if (PREPOSITIONS.has(token.key)) {
    const hasObject = next && ["Determiner", "Noun", "Pronoun", "Possessive", "Value"].some((tag) => next.tags.has(tag));
    return (type === "adjective" || type === "adverb") && hasObject ? "preposition" : type;
  }
  // "Please light the candles", "to light the oven": base form followed by its object (not after "is/are").
  if ((type === "adjective" || type === "noun") && nextStartsObject && !previousModifies && !previous?.tags.has("Copula")) return "verb";
  return type;
}

function tagType(tags) {
  return TAG_TYPES.find(([tag]) => tags.has(tag))?.[1] || "";
}

// A selection like "well-known" spans several tagger tokens; compare letters and digits only.
export function findTerm(tokens, target) {
  if (!target) return null;
  for (let start = 0; start < tokens.length; start += 1) {
    let joined = "";
    for (let end = start; end < tokens.length; end += 1) {
      joined += tokens[end].key;
      if (joined === target) return [start, end];
      if (!target.startsWith(joined)) break;
    }
  }
  return null;
}

export function letters(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
