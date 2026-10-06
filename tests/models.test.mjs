import test from "node:test";
import assert from "node:assert/strict";
import { modelSpecs, templateStatus } from "../models.js";

const word = modelSpecs.word;
const collocation = modelSpecs.collocation;
const templatesOf = (version, name = "Recognition") => ({ [name]: { Front: version.front, Back: version.back } });

test("v3 Word front: term, US pronunciation, replay, part-of-speech pill", () => {
  assert.match(word.front, /<div class="term">\{\{Word\}\}<\/div>/);
  assert.match(word.front, /\{\{#Pronunciation\}\}<div class="pron">US: \{\{Pronunciation\}\}<\/div>\{\{\/Pronunciation\}\}/);
  assert.match(word.front, /\{\{#Audio\}\}\{\{Audio\}\}\{\{\/Audio\}\}\{\{\^Audio\}\}\{\{tts en_US:Word\}\}\{\{\/Audio\}\}/);
  assert.match(word.front, /\{\{#Category\}\}<div class="tags"><span class="tag">\{\{Category\}\}<\/span><\/div>\{\{\/Category\}\}/);
  assert.ok(!word.front.includes("UK"));
});

test("v3 Word back: level badge, VN meaning box, example usage, patterns before collocations, minor lists", () => {
  const order = ["{{#Level}}", "{{Word}}", "US: {{Pronunciation}}", "class=\"divider\"", "{{MeaningVN}}", "{{#Meaning}}", "{{#Example}}", "{{#Context}}", "{{#Patterns}}", "{{#Collocation}}", "class=\"minor\"", "{{#Synonyms}}", "{{#Antonyms}}", "{{#RelatedWords}}"];
  const positions = order.map((token) => word.back.indexOf(token));
  assert.ok(positions.every((position) => position >= 0), order.filter((_, index) => positions[index] < 0).join(", "));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "sections in the designed order");
  assert.match(word.back, /<div class="meaning-vn">\{\{MeaningVN\}\}<\/div>/);
  assert.match(word.back, /<div class="label">Example usage<\/div>/);
  assert.match(word.back, /<div class="minor">\{\{#Synonyms\}\}/, "no whitespace inside .minor so :empty hides it");
  assert.match(word.css, /\.minor:empty\{display:none\}/);
  assert.match(word.css, /\.meaning-vn\{[^}]*background:#eff6ff/);
  assert.match(word.css, /\.level\{[^}]*background:#fde68a/);
});

test("v3 Collocation uses the same design with Pattern pill and similar expressions", () => {
  assert.match(collocation.front, /\{\{#Pattern\}\}<div class="tags"><span class="tag">\{\{Pattern\}\}<\/span><\/div>\{\{\/Pattern\}\}/);
  assert.match(collocation.back, /<div class="meaning-vn">\{\{Meaning\}\}<\/div>/);
  assert.match(collocation.back, /<div class="minor">\{\{#Synonyms\}\}<div class="section"><div class="label">Similar expressions<\/div>/);
  assert.equal(collocation.css, word.css);
});

test("status compares templates and styling; earlier versions are outdated", () => {
  assert.deepEqual(templateStatus(word, templatesOf(word), word.css), { status: "current", cardName: "Recognition" });
  assert.equal(word.previous.length, 3, "v1, v2 (antonyms), and v3 (first design CSS) Word versions");
  for (const version of word.previous) {
    assert.deepEqual(templateStatus(word, templatesOf(version, "Card 1"), version.css), { status: "outdated", cardName: "Card 1" });
  }
  assert.ok(word.previous[1].back.includes("{{Antonyms}}") && !word.previous[0].back.includes("{{Antonyms}}"));
  assert.deepEqual(templateStatus(word, templatesOf(word), `${word.css}.mine{}`), { status: "customized", cardName: "Recognition" }, "styling edits count as customization");
  assert.deepEqual(templateStatus(word, templatesOf(word.previous[0]), word.css), { status: "customized", cardName: "Recognition" }, "old template with new css is not a known version");
  assert.deepEqual(templateStatus(word, { Recognition: { Front: word.front, Back: `  ${word.back.replace(/></g, ">\n<")}` } }, `\n${word.css}\n`), { status: "current", cardName: "Recognition" }, "whitespace ignored");
  assert.deepEqual(templateStatus(word, { A: templatesOf(word).Recognition, B: templatesOf(word).Recognition }, word.css), { status: "unsupported", cardName: "" });
  assert.deepEqual(templateStatus(collocation, templatesOf(collocation.previous[0]), collocation.previous[0].css), { status: "outdated", cardName: "Recognition" });
  assert.equal(collocation.previous.length, 2);
});

