import test from "node:test";
import assert from "node:assert/strict";
import "../page-context.js";

const { extractContext } = globalThis.AnkiVocabularyPageContext;
const at = (text, needle, from = 0) => text.indexOf(needle, from);

test("dictionary headword line: no sentence, IPA goes to pronunciation (reported bug)", () => {
  const text = "renowned adjective /rɪˈnaʊnd/ /rɪˈnaʊnd/";
  assert.deepEqual(extractContext(text, "renowned", 0), { sentence: "", pronunciation: "/rɪˈnaʊnd/" });
  const spaced = "\n  renowned\n  adjective\n  UK  /rɪˈnaʊnd/  US  /rɪˈnaʊnd/\n";
  assert.deepEqual(extractContext(spaced, "renowned", at(spaced, "renowned")), { sentence: "", pronunciation: "/rɪˈnaʊnd/" });
});

test("the sentence containing the selection is returned, including the first sentence of a block", () => {
  const text = "The company proved resilient in the downturn. Analysts expect growth to continue next year.";
  assert.equal(extractContext(text, "resilient", at(text, "resilient")).sentence, "The company proved resilient in the downturn.");
  const later = "Markets fell sharply. The company proved resilient in the downturn. Analysts expect growth.";
  assert.equal(extractContext(later, "resilient", at(later, "resilient")).sentence, "The company proved resilient in the downturn.");
});

test("the selected occurrence decides the sentence when the term appears twice", () => {
  const text = "Light travels fast. Please light the candles before dinner.";
  assert.equal(extractContext(text, "light", at(text, "light")).sentence, "Please light the candles before dinner.");
  assert.equal(extractContext(text, "Light", 0).sentence, "Light travels fast.");
  assert.equal(extractContext(text, "light", -1).sentence, "Light travels fast.", "unknown offset falls back to the first occurrence");
});

test("IPA inside a real sentence is moved out of the sentence", () => {
  const text = "Renowned /rɪˈnaʊnd/ means known and admired by many people.";
  assert.deepEqual(extractContext(text, "Renowned", 0), { sentence: "Renowned means known and admired by many people.", pronunciation: "/rɪˈnaʊnd/" });
});

test("fragments, menus, and text without the term are not sentences", () => {
  assert.equal(extractContext("a renowned author", "renowned", 2).sentence, "", "under four words");
  const menu = `Home News Sport ${"Culture Travel Weather ".repeat(20)}renowned Business ${"Video Audio ".repeat(20)}`;
  assert.equal(extractContext(menu, "renowned", at(menu, "renowned")).sentence, "", "long run without sentence punctuation");
  assert.equal(extractContext("She is a renowned scholar of Chinese history", "renowned", 9).sentence, "She is a renowned scholar of Chinese history", "a short example without a period is fine");
  assert.equal(extractContext("Nothing relevant here at all today.", "renowned", 0).sentence, "");
});

test("paths and non-IPA slashes are not pronunciations", () => {
  assert.equal(extractContext("Open /usr/bin/ to find the renowned tool quickly.", "renowned", 27).pronunciation, "");
  assert.equal(extractContext("renowned and/or famous /x/", "renowned", 0).pronunciation, "");
  assert.equal(extractContext("renowned [rɪˈnaʊnd] adjective", "renowned", 0).pronunciation, "/rɪˈnaʊnd/");
  const far = `renowned ${"filler words ".repeat(20)}/rɪˈnaʊnd/`;
  assert.equal(extractContext(far, "renowned", 0).pronunciation, "", "IPA far from the selection is ignored");
});

test("long sentences are trimmed around the term", () => {
  const text = `${"Some context words ".repeat(20)}the renowned professor spoke ${"and more words follow ".repeat(20)}today.`;
  const { sentence } = extractContext(text, "renowned", at(text, "renowned"));
  assert.ok(sentence.length <= 301, String(sentence.length));
  assert.ok(sentence.includes("the renowned professor spoke"));
  assert.ok(sentence.startsWith("…") && sentence.endsWith("…"));
});

test("common abbreviations do not end a sentence", () => {
  const text = "Markets fell. Dr. Smith is a renowned surgeon in Boston. Others agree.";
  assert.equal(extractContext(text, "renowned", at(text, "renowned")).sentence, "Dr. Smith is a renowned surgeon in Boston.");
});

test("the US transcription is preferred when a page shows UK and US", () => {
  const text = "ambitious adjective UK /æmˈbɪʃ.əs/ US /æmˈbɪʃ.əs/ having a strong desire for success";
  assert.equal(extractContext(text, "ambitious", 0).pronunciation, "/æmˈbɪʃ.əs/");
  const different = "schedule noun UK /ˈʃedʒ.uːl/ US /ˈskedʒ.uːl/";
  assert.equal(extractContext(different, "schedule", 0).pronunciation, "/ˈskedʒ.uːl/");
  const usFirst = "schedule US: /ˈskedʒ.uːl/ | UK: /ˈʃedʒ.uːl/";
  assert.equal(extractContext(usFirst, "schedule", 0).pronunciation, "/ˈskedʒ.uːl/");
  assert.equal(extractContext("schedule /ˈʃedʒ.uːl/ noun", "schedule", 0).pronunciation, "/ˈʃedʒ.uːl/", "unlabelled transcription still used");
});

test("Oxford-style BrE/NAmE labels: the North American transcription is used (reported: /ˈɔːθə(r)/)", () => {
  const oxford = "author noun BrE /ˈɔːθə(r)/ NAmE /ˈɔːθər/";
  assert.equal(extractContext(oxford, "author", 0).pronunciation, "/ˈɔːθər/");
  const spaced = "author\n  noun\n  BrE\n   /ˈɔːθə(r)/\n  NAmE\n    /ˈɔːθər/\n";
  assert.equal(extractContext(spaced, "author", spaced.indexOf("author")).pronunciation, "/ˈɔːθər/");
  assert.equal(extractContext("x US /ˈaɪ/ UK /ˈiː/", "x", 0).pronunciation, "/ˈaɪ/", "a UK label between US and the transcription does not count");
});
