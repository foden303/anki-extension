import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { contextPattern, contextWordType, detectWordType } from "../word-type.js";

const { parseDictionary } = await import("../sources.js");
const lightEntries = JSON.parse(await readFile(new URL("./fixtures/dictionaryapi/light.json", import.meta.url), "utf8")).body;
const lightCandidates = parseDictionary(lightEntries).types;

const LIGHT = [
  ["Turn on the light before you leave.", "noun"],
  ["Please light the candles on the table.", "verb"],
  ["She carried a light bag to the airport.", "adjective"],
];

test("dictionary candidates are merged across entries in first-seen order", () => {
  assert.deepEqual(lightCandidates, ["noun", "verb", "adjective", "adverb"]);
});

test("light is a noun, verb, or adjective depending on the fixture sentence", () => {
  for (const [sentence, expected] of LIGHT) {
    assert.equal(detectWordType({ term: "light", sentence, candidates: lightCandidates }).type, expected, sentence);
    assert.equal(detectWordType({ term: "light", sentence, candidates: [] }).type, expected, `${sentence} (no dictionary)`);
  }
});

test("context rules correct the tagger for verbs, prepositions, and hyphenated words", () => {
  const cases = [
    ["light", "Can you light the fire?", "verb"],
    ["light", "Don't forget to light the oven.", "verb"],
    ["fast", "He runs fast.", "adverb"],
    ["fast", "They fast during Ramadan.", "verb"],
    ["fast", "She drives a fast car.", "adjective"],
    ["under", "The cat is under the table.", "preposition"],
    ["well-known", "She is a well-known author.", "adjective"],
    ["resilient", "The company proved resilient in the downturn.", "adjective"],
    ["depend", "You can depend on me.", "verb"],
    ["but", "I tried, but I failed.", "conjunction"],
    ["wow", "Wow, that was great!", "interjection"],
    ["they", "They left early.", "pronoun"],
    ["this", "This book is great.", "determiner"],
    ["Light", "Light travels faster than sound.", "noun"],
  ];
  for (const [term, sentence, expected] of cases) {
    assert.equal(contextWordType(term, sentence), expected, `${term}: ${sentence}`);
  }
});

test("no sentence and no dictionary candidates leaves the type blank", () => {
  assert.deepEqual(detectWordType({ term: "light", sentence: "", candidates: [] }), { type: "", contextType: "", detected: [] });
  assert.equal(detectWordType({ term: "light", sentence: "A sentence without the selected word.", candidates: [] }).type, "");
});

test("dictionary candidates decide when the sentence gives no usable signal", () => {
  assert.equal(detectWordType({ term: "light", sentence: "", candidates: ["noun", "verb"] }).type, "noun");
  assert.equal(detectWordType({ term: "light", sentence: "Please light the candles on the table.", candidates: ["noun"] }).type, "noun");
});

test("detected types list the context type first, then dictionary candidates", () => {
  assert.deepEqual(
    detectWordType({ term: "light", sentence: "Please light the candles on the table.", candidates: lightCandidates }),
    { type: "verb", contextType: "verb", detected: ["verb", "noun", "adjective", "adverb"] },
  );
});

test("the page sentence gives a word pattern with its object placeholder", () => {
  assert.equal(contextPattern("resilient", "The company proved resilient in the downturn."), "resilient in sb/sth");
  assert.equal(contextPattern("depend", "You can depend on me."), "depend on sb/sth");
  assert.equal(contextPattern("happy", "I am happy to help."), "happy to do sth");
  assert.equal(contextPattern("interested", "She is interested in learning Spanish."), "interested in doing sth");
  assert.equal(contextPattern("depends", "It depends on the weather."), "depends on sb/sth");
  assert.equal(contextPattern("sure", "I am sure that he will come."), "sure that + clause");
  assert.equal(contextPattern("light", "Turn on the light before you leave."), "");
  assert.equal(contextPattern("light", ""), "");
  assert.equal(contextPattern("missing", "No such word here."), "");
});
