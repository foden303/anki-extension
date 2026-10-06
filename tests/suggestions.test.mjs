import test from "node:test";
import assert from "node:assert/strict";
import "../suggestions.js";

const { addCustom, createGroups, groupsFor, mergeEnrichment, resetForType, snapshot, toggle } = globalThis.AnkiVocabularySuggestions;

const wordDraft = { kind: "word", term: "resilient", contextPattern: "resilient in", synonyms: ["robust", "tough"] };
const wordEnrichment = {
  kind: "word",
  patterns: [{ text: "resilient to", source: "datamuse" }, { text: "resilient in", source: "datamuse" }],
  collocations: ["material", "people", "system", "surface"].map((noun) => ({ text: `resilient ${noun}`, source: "datamuse" })),
  synonyms: ["robust", "elastic", "bouncy", "springy", "lively", "hardy", "flexible"].map((text) => ({ text, source: "datamuse" })),
  antonyms: [{ text: "brittle", source: "dictionary" }, { text: "fragile", source: "datamuse" }],
  similar: [],
};

test("groups depend on kind", () => {
  assert.deepEqual(groupsFor("word"), ["patterns", "collocations", "synonyms", "antonyms"]);
  assert.deepEqual(groupsFor("collocation"), ["similar"]);
});

test("initial groups: sentence pattern and Step 1 synonyms are ticked", () => {
  const groups = createGroups(wordDraft);
  assert.deepEqual(snapshot(groups), { patterns: ["resilient in"], collocations: [], synonyms: ["robust", "tough"], antonyms: [] });
  assert.equal(groups.patterns.items[0].source, "sentence");
});

test("enrichment defaults: top 5 synonyms, top 3 collocations, top 3 antonyms from any source; data patterns unticked", () => {
  const merged = mergeEnrichment(createGroups(wordDraft), wordEnrichment);
  const picked = snapshot(merged);
  assert.deepEqual(picked.patterns, ["resilient in"], "sentence pattern stays ticked, datamuse duplicate not re-added");
  assert.deepEqual(merged.patterns.items.map((item) => item.text), ["resilient in", "resilient to"]);
  assert.deepEqual(picked.collocations, ["resilient material", "resilient people", "resilient system"]);
  assert.deepEqual(picked.synonyms, ["robust", "tough", "elastic", "bouncy", "springy"], "top 5 overall, Step 1 ticks kept");
  assert.deepEqual(picked.antonyms, ["brittle", "fragile"], "Datamuse antonyms are ticked too: DictionaryAPI rarely answers in time");
});

test("a group the user touched keeps exactly the user's choices when more data arrives", () => {
  let groups = createGroups(wordDraft);
  groups = toggle(groups, "synonyms", "tough");
  groups = mergeEnrichment(groups, wordEnrichment);
  assert.deepEqual(snapshot(groups).synonyms, ["robust"], "no new default ticks in a touched group");
  assert.ok(groups.synonyms.items.some((item) => item.text === "elastic" && !item.selected));
});

test("custom items are validated, deduplicated case-insensitively, and ticked", () => {
  let groups = createGroups(wordDraft);
  groups = addCustom(groups, "patterns", "  resilient   to sb/sth ");
  groups = addCustom(groups, "synonyms", "ROBUST");
  groups = addCustom(groups, "antonyms", "<script>");
  groups = addCustom(groups, "antonyms", "x".repeat(81));
  const picked = snapshot(groups);
  assert.deepEqual(picked.patterns, ["resilient in", "resilient to sb/sth"]);
  assert.equal(groups.patterns.items.at(-1).source, "you");
  assert.deepEqual(picked.synonyms, ["robust", "tough"], "existing item re-ticked instead of duplicated");
  assert.deepEqual(picked.antonyms, []);
});

test("changing type keeps only explicit user choices and the sentence pattern; untouched groups take new defaults", () => {
  let groups = mergeEnrichment(createGroups(wordDraft), wordEnrichment);
  groups = toggle(groups, "collocations", "resilient people");
  groups = addCustom(groups, "collocations", "resilient economy");
  groups = resetForType(groups);
  assert.deepEqual(groups.collocations.items.map((item) => item.text), ["resilient economy"], "default ticks and explicit unticks dropped");
  assert.equal(groups.collocations.touched, true);
  assert.deepEqual(groups.synonyms.items, [], "old-type default synonyms dropped");
  assert.equal(groups.synonyms.touched, false);
  assert.deepEqual(groups.patterns.items.map((item) => item.text), ["resilient in"], "sentence pattern is type-independent");

  groups = mergeEnrichment(groups, { kind: "word", synonyms: [{ text: "hardy", source: "gtx" }], collocations: [{ text: "resilient crops", source: "datamuse" }] });
  assert.deepEqual(snapshot(groups).synonyms, ["hardy"], "untouched group gets new defaults");
  assert.deepEqual(snapshot(groups).collocations, ["resilient economy"], "touched group gets no new ticks");
});

test("collocation: similar expressions start unticked; at most 12 items per group", () => {
  const groups = mergeEnrichment(createGroups({ kind: "collocation", term: "give up" }), {
    kind: "collocation",
    similar: Array.from({ length: 20 }, (_, index) => ({ text: `phrase ${String.fromCharCode(97 + index)}`, source: "datamuse" })),
  });
  assert.equal(groups.similar.items.length, 12);
  assert.deepEqual(snapshot(groups), { similar: [] });
});

test("groups are immutable values", () => {
  const groups = createGroups(wordDraft);
  const next = toggle(groups, "synonyms", "robust");
  assert.notEqual(next, groups);
  assert.deepEqual(snapshot(groups).synonyms, ["robust", "tough"]);
});

test("antonyms from Datamuse alone are ticked (reported: Antonyms missing on the card)", () => {
  const groups = mergeEnrichment(createGroups({ kind: "word", term: "ambitious" }), {
    kind: "word",
    antonyms: ["unambitious", "ambitionless", "lazy", "complacent"].map((text) => ({ text, source: "datamuse" })),
  });
  assert.deepEqual(snapshot(groups).antonyms, ["unambitious", "ambitionless", "lazy"]);
});
