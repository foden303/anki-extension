import test from "node:test";
import assert from "node:assert/strict";
import "../term-kind.js";

const { classifyTerm, normalizeTerm, MAX_TERM_CHARS } = globalThis.AnkiVocabularyTerm;

test("a single token is a word, including hyphens and apostrophes", () => {
  for (const term of ["resilient", "well-known", "don't", "don’t", "and/or"]) {
    assert.deepEqual(classifyTerm(term), { term, kind: "word", words: 1 }, term);
  }
});

test("two or more tokens are a collocation", () => {
  assert.deepEqual(classifyTerm("give up"), { term: "give up", kind: "collocation", words: 2 });
  assert.deepEqual(classifyTerm("make a decision"), { term: "make a decision", kind: "collocation", words: 3 });
});

test("whitespace is normalised before counting", () => {
  assert.equal(normalizeTerm("  give \n\t up  "), "give up");
  assert.equal(normalizeTerm("make a  decision"), "make a decision");
  assert.deepEqual(classifyTerm(" \n resilient \t"), { term: "resilient", kind: "word", words: 1 });
  assert.deepEqual(classifyTerm("heavy\n\nrain"), { term: "heavy rain", kind: "collocation", words: 2 });
});

test("selection punctuation at the edges is dropped", () => {
  assert.deepEqual(classifyTerm("resilient,"), { term: "resilient", kind: "word", words: 1 });
  assert.deepEqual(classifyTerm("“give up.”"), { term: "give up", kind: "collocation", words: 2 });
  assert.deepEqual(classifyTerm("(don't)"), { term: "don't", kind: "word", words: 1 });
});

test("any selection with more than one word is a collocation; there is no word limit (user decision 2026-09-15)", () => {
  const eleven = "the more you practise the better you get at speaking a language";
  assert.deepEqual(classifyTerm(eleven), { term: eleven, kind: "collocation", words: 12 });
  const long = Array.from({ length: 60 }, (_, index) => `w${String.fromCharCode(97 + (index % 26))}`).join(" ");
  assert.equal(classifyTerm(long)?.kind, "collocation");
  assert.equal(classifyTerm(long)?.words, 60);
});

test("only a character safety cap remains (translation request URL)", () => {
  assert.equal(MAX_TERM_CHARS, 500);
  assert.equal(classifyTerm(`${"a".repeat(250)} ${"b".repeat(249)}`)?.kind, "collocation");
  assert.equal(classifyTerm(`${"a".repeat(250)} ${"b".repeat(250)}`), null);
});

test("empty, letterless, and oversized selections are rejected", () => {
  for (const text of ["", "   ", "123", "... !!", "a".repeat(501), null, undefined]) {
    assert.equal(classifyTerm(text), null, String(text).slice(0, 20));
  }
});
