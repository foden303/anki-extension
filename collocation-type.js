// Collocation type and pattern template from part-of-speech rules (fallback when AI suggestions are off or fail).
import { findTerm, letters, tagTokens } from "./word-type.js";

// Adverbial particles that make a verb phrasal; on/in/for/to… stay prepositions ("depend on").
const STRONG_PARTICLES = new Set(["up", "down", "out", "off", "away", "back", "over", "around", "round", "along", "apart", "aside", "forward", "together", "through"]);
const PERSON_OBJECTS = new Set(["me", "you", "him", "her", "us", "them"]);
const REFLEXIVES = new Set(["myself", "yourself", "himself", "herself", "itself", "ourselves", "yourselves", "themselves", "oneself"]);

// Codes: V verb, P phrasal particle, R preposition, O "of", N noun, A adjective, D adverb, X anything else.
const RULES = [
  [/^V P( [A-Z])*$/, "phrasal verb"],
  [/^V R( N)?$/, "verb + preposition"],
  [/^V N( [RO])?$/, "verb + noun"],
  [/^V D$/, "verb + adverb"],
  [/^D [AV]$/, "adverb + adjective"],
  [/^A N$/, "adjective + noun"],
  [/^N O N$/, "noun + of + noun"],
  [/^N N$/, "noun + noun"],
];
const OPEN_OBJECT_TYPES = new Set(["verb + noun", "verb + preposition", "phrasal verb"]);

export function detectCollocation({ term, sentence = "" }) {
  const tokens = phraseTokens(term, sentence);
  const pieces = tokens.map((token, index) => classify(token, tokens.slice(0, index)));
  const codes = pieces.map((piece) => piece.code).filter(Boolean).join(" ");
  const type = RULES.find(([rule]) => rule.test(codes))?.[1] || "other";
  if (type === "other") return { type, pattern: tokens.map((token) => token.text.toLowerCase()).join(" ") };

  const leadingVerb = codes.startsWith("V");
  let rootUsed = false;
  const words = pieces.map((piece) => {
    if (piece.code === "V" && leadingVerb && !rootUsed) {
      rootUsed = true;
      return piece.token.root || piece.word;
    }
    return piece.word;
  });
  if (OPEN_OBJECT_TYPES.has(type) && ["R", "O"].includes(pieces.at(-1)?.code)) words.push("sb/sth");
  return { type, pattern: words.join(" ") };
}

// Prefer the tokens as tagged inside the page sentence; otherwise tag the phrase alone.
function phraseTokens(term, sentence) {
  if (sentence) {
    const tokens = tagTokens(sentence);
    const range = findTerm(tokens, letters(term));
    if (range) return tokens.slice(range[0], range[1] + 1);
  }
  return tagTokens(term);
}

// Returns the rule code (empty for determiners/pronouns, which only shape the template) and the template word.
function classify(token, before) {
  const word = token.text.toLowerCase();
  const { key, tags } = token;
  if (tags.has("Determiner")) return { token, code: "", word: key === "a" || key === "an" ? "a/the +" : word };
  if (tags.has("Possessive")) return { token, code: "", word: "one's" };
  if (tags.has("Pronoun")) {
    if (REFLEXIVES.has(key)) return { token, code: "", word: "oneself" };
    if (key === "it") return { token, code: "", word: "sth" };
    if (PERSON_OBJECTS.has(key)) return { token, code: "", word: "sb" };
    return { token, code: "X", word };
  }
  if (STRONG_PARTICLES.has(key) && before.some((earlier) => earlier.tags.has("Verb"))) return { token, code: "P", word };
  if (key === "of") return { token, code: "O", word };
  if (tags.has("Preposition") || tags.has("Particle") || key === "to") return { token, code: "R", word };
  if (tags.has("Adverb")) return { token, code: "D", word };
  if (tags.has("Adjective")) return { token, code: "A", word };
  if (tags.has("Verb")) return { token, code: "V", word };
  if (tags.has("Noun") || tags.has("Value")) return { token, code: "N", word };
  return { token, code: "X", word };
}
