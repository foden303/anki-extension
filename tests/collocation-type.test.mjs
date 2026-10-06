import test from "node:test";
import assert from "node:assert/strict";
import "../term-kind.js";
import { detectCollocation } from "../collocation-type.js";

const { COLLOCATION_TYPES } = globalThis.AnkiVocabularyTerm;

test("Task 5.4 DoD fixtures", () => {
  assert.deepEqual(detectCollocation({ term: "give up" }), { type: "phrasal verb", pattern: "give up" });
  assert.deepEqual(detectCollocation({ term: "make a decision" }), { type: "verb + noun", pattern: "make a/the + decision" });
  assert.deepEqual(detectCollocation({ term: "heavy rain" }), { type: "adjective + noun", pattern: "heavy rain" });
  assert.deepEqual(detectCollocation({ term: "as soon as possible" }), { type: "other", pattern: "as soon as possible" });
});

test("each rule type from the fixed list", () => {
  const cases = [
    ["depend on", "verb + preposition", "depend on sb/sth"],
    ["traffic jam", "noun + noun", "traffic jam"],
    ["highly effective", "adverb + adjective", "highly effective"],
    ["deeply concerned", "adverb + adjective", "deeply concerned"],
    ["work hard", "verb + adverb", "work hard"],
    ["speak fluently", "verb + adverb", "speak fluently"],
    ["sense of humour", "noun + of + noun", "sense of humour"],
    ["take care of", "verb + noun", "take care of sb/sth"],
    ["make up my mind", "phrasal verb", "make up one's mind"],
    ["turn it off", "phrasal verb", "turn sth off"],
    ["strong coffee", "adjective + noun", "strong coffee"],
    ["break the ice", "verb + noun", "break the ice"],
  ];
  for (const [term, type, pattern] of cases) {
    assert.deepEqual(detectCollocation({ term }), { type, pattern }, term);
  }
});

test("the page sentence supplies inflected forms, which become base-form templates", () => {
  assert.deepEqual(detectCollocation({ term: "gave up", sentence: "She gave up smoking last year." }), { type: "phrasal verb", pattern: "give up" });
  assert.deepEqual(detectCollocation({ term: "made a decision", sentence: "He made a decision yesterday." }), { type: "verb + noun", pattern: "make a/the + decision" });
  assert.deepEqual(detectCollocation({ term: "rely on him", sentence: "They rely on him." }), { type: "verb + preposition", pattern: "rely on sb" });
  assert.deepEqual(detectCollocation({ term: "ran out of", sentence: "We ran out of time." }), { type: "phrasal verb", pattern: "run out of sb/sth" });
});

test("a phrase missing from the sentence is tagged on its own", () => {
  assert.deepEqual(detectCollocation({ term: "heavy rain", sentence: "Nothing relevant here." }), { type: "adjective + noun", pattern: "heavy rain" });
});

test("every detected type belongs to the fixed collocation type list", () => {
  assert.equal(COLLOCATION_TYPES.length, 10);
  for (const term of ["give up", "make a decision", "heavy rain", "as soon as possible", "the more the merrier", "fall in love"]) {
    assert.ok(COLLOCATION_TYPES.includes(detectCollocation({ term }).type), term);
  }
});
