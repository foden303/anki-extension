// Shared by content.js (classic content script) and background.js (module import): no exports, one frozen global.
(() => {
  "use strict";

  // No word limit (user decision 2026-09-15); the character cap keeps the translation request URL safe
  // and stops the overlay from opening when a whole article is selected.
  const MAX_TERM_CHARS = 500;
  const WORD_TYPES = Object.freeze(["noun", "verb", "adjective", "adverb", "pronoun", "preposition", "conjunction", "determiner", "interjection"]);
  const COLLOCATION_TYPES = Object.freeze([
    "adjective + noun", "verb + noun", "noun + noun", "adverb + adjective", "verb + adverb",
    "verb + preposition", "phrasal verb", "noun + of + noun", "idiom / fixed expression", "other",
  ]);

  function normalizeTerm(text) {
    return String(text ?? "")
      .replace(/\s+/g, " ")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .trim();
  }

  // One token is a word (hyphen/apostrophe/slash stay inside the token); two or more tokens are a collocation.
  // Patterns name what follows: "depend on sb/sth", "happy to do sth", "sure that + clause".
  function formatPattern(term, preposition, object = "sb/sth") {
    return `${String(term).toLowerCase()} ${preposition}${object ? ` ${object}` : ""}`.trim();
  }

  function classifyTerm(text) {
    const term = normalizeTerm(text);
    if (!term || term.length > MAX_TERM_CHARS || !/\p{L}/u.test(term)) return null;
    const words = term.split(" ").length;
    return { term, kind: words === 1 ? "word" : "collocation", words };
  }

  globalThis.AnkiVocabularyTerm = Object.freeze({ MAX_TERM_CHARS, WORD_TYPES, COLLOCATION_TYPES, normalizeTerm, classifyTerm, formatPattern });
})();
