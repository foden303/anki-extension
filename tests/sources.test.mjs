import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanSuggestion, htmlToText, parseDatamuse, parseDictionary, parseGtx, parseWiktionary } from "../sources.js";

const fixture = async (path) => JSON.parse(await readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8")).body;

test("GTX: translation, POS groups, meanings, filtered synonyms, definitions, examples", async () => {
  const light = parseGtx(await fixture("gtx/light.json"));
  assert.equal(light.translation, "ánh sáng");
  assert.equal(light.detectedLanguage, "en");
  assert.deepEqual(light.types, ["adjective", "adverb", "noun", "verb"]);
  assert.equal(light.meanings.noun[0], "ánh sáng");
  assert.ok(light.meanings.verb.length <= 5);
  assert.equal(light.synonyms.adjective[0], "bright");
  assert.ok(!light.synonyms.verb.includes("enkindle"), "archaic group skipped");
  assert.ok(!light.synonyms.verb.includes("put/set a match to") && !light.synonyms.verb.includes("spark (off)"), "unclean items dropped");
  assert.ok(light.synonyms.verb.includes("ignite"));
  assert.equal(light.definitions.adjective[0].text, "having a considerable or sufficient amount of natural light; not dark.");
  assert.equal(light.definitions.adjective[0].example, "the bedrooms are light and airy");
  assert.equal(light.examples[0], "she planted a light kiss on his cheek");

  const giveUp = parseGtx(await fixture("gtx/give-up.json"));
  assert.equal(giveUp.translation, "bỏ cuộc");
  assert.deepEqual(giveUp.types, ["verb"]);
  assert.deepEqual(giveUp.synonyms, {});
});

test("GTX: synonym senses labelled informal or regional are skipped (reported: oppo, offsider for colleague)", () => {
  const body = [[["đồng nghiệp", "colleague"]], null, "en", null, null, null, null, null, null, null, null, [["noun", [
    [["oppo", "offsider"], "m_en_gbus.1", [["British informal"]]],
    [["mate"], "m_en_gbus.2", [["informal"]]],
    [["cobber"], "m_en_gbus.3", [["Australian", "informal"]]],
    [["fellow worker", "workmate", "co-worker"], "m_en_gbus.4"],
  ], "colleague", 1]]];
  assert.deepEqual(parseGtx(body).synonyms.noun, ["fellow worker", "workmate", "co-worker"]);
});

test("GTX: malformed bodies never throw and yield empty data", () => {
  for (const body of [null, {}, "x", [], [[]], [["x"]], [null, "bad", 5, null, null, null, null, null, null, null, null, "bad", [["noun", "bad"]]]]) {
    const parsed = parseGtx(body);
    assert.equal(parsed.translation, "");
    assert.deepEqual(parsed.types, []);
  }
});

test("DictionaryAPI: merged types, audio, pronunciation, synonyms and antonyms by type", async () => {
  const light = parseDictionary(await fixture("dictionaryapi/light.json"));
  assert.deepEqual(light.types, ["noun", "verb", "adjective", "adverb"]);
  assert.equal(light.audioUrl, "https://api.dictionaryapi.dev/media/pronunciations/en/light-us.mp3", "US recording preferred");
  assert.equal(light.pronunciation, "/lʌɪt/", "US text is a narrow [..] transcription, so the unlabelled /../ one is used, never the UK-audio text");
  const us = parseDictionary([{ phonetic: "/ˈæm.bɪ.ʃəs/", phonetics: [{ text: "/æmˈbɪʃəs/", audio: "https://api.dictionaryapi.dev/media/pronunciations/en/ambitious-uk.mp3" }, { text: "/æmˈbɪʃəs/ US", audio: "" }, { text: "/æmˈbɪʃəs/", audio: "https://api.dictionaryapi.dev/media/pronunciations/en/ambitious-us.mp3" }] }]);
  assert.equal(us.audioUrl, "https://api.dictionaryapi.dev/media/pronunciations/en/ambitious-us.mp3");
  assert.equal(us.pronunciation, "/æmˈbɪʃəs/");
  const ukOnly = parseDictionary([{ phonetics: [{ text: "/ˈlɪtə/", audio: "https://api.dictionaryapi.dev/media/pronunciations/en/liter-uk.mp3" }, { text: "/ˈliːtɚ/", audio: "" }] }]);
  assert.equal(ukOnly.pronunciation, "/ˈliːtɚ/", "text tied to UK audio is skipped when another exists");
  assert.ok(light.antonyms.verb.includes("extinguish"));
  assert.ok(light.antonyms.adjective.includes("heavy"));
  assert.ok(light.synonyms.adjective.includes("gentle"));

  const resilient = parseDictionary(await fixture("dictionaryapi/resilient.json"));
  assert.equal(resilient.pronunciation, "");
  assert.equal(resilient.audioUrl, "https://api.dictionaryapi.dev/media/pronunciations/en/resilient-us.mp3");
  assert.deepEqual(resilient.antonyms.adjective, ["brittle", "fragile"]);

  assert.deepEqual(parseDictionary({ nonJsonBody: "<!DOCTYPE html>" }).types, []);
  assert.equal(parseDictionary([{ phonetics: [{ audio: "https://evil.example/x.mp3" }] }]).audioUrl, "");
});

test("Datamuse: validated items with POS types, at most 20", async () => {
  const syn = parseDatamuse(await fixture("datamuse/light.rel_syn.json"));
  assert.equal(syn[0].word, "frivolous");
  assert.deepEqual(syn[0].types, ["adjective"]);
  assert.ok(syn.every((item) => Number.isFinite(item.score)));

  const noisy = parseDatamuse([
    { word: "<script>alert(1)</script>", score: 1 },
    { word: "a".repeat(80), score: 1 },
    { word: ".", score: 1 },
    { word: "make up one's mind", score: 5, tags: ["v"] },
    { word: 42 },
    ...Array.from({ length: 30 }, (_, index) => ({ word: `word${String.fromCharCode(97 + (index % 26))}`, score: index })),
  ]);
  assert.equal(noisy[0].word, "make up one's mind");
  assert.ok(noisy.length <= 20);
  assert.deepEqual(parseDatamuse({ error: "nope" }), []);
  assert.deepEqual(parseDatamuse([{ word: "from", score: 1, tags: ["N", "prop", "f:2.5"] }])[0].types, [], "only lowercase n/v/adj/adv are POS tags");
  assert.deepEqual(parseDatamuse([{ word: "clear", score: 1, tags: ["adj", "adv", "v", "n"] }])[0].types, ["adjective", "adverb", "verb", "noun"], "order kept: first is primary");
});

test("Wiktionary: English sections as text with usage prepositions", async () => {
  const depend = parseWiktionary(await fixture("wiktionary/depend.json"));
  assert.equal(depend[0].type, "verb");
  assert.ok(depend[0].definitions[0].startsWith("To be contingent or conditioned; to have something as a necessary condition"));
  assert.ok(!depend[0].definitions.join(" ").includes("mw-parser-output"), "style content removed");
  assert.deepEqual(depend[0].prepositions, ["on", "upon"]);
  assert.ok(depend[0].examples[0].includes("it depends on the amount of snow"));

  const light = parseWiktionary(await fixture("wiktionary/light.json"));
  assert.ok(light.every((section) => section.definitions.every((text) => text.length > 0 && text.length <= 500)));
  assert.ok(light.every((section) => section.definitions.length <= 10));

  const giveUp = parseWiktionary(await fixture("wiktionary/give-up.json"));
  assert.equal(giveUp[0].type, "verb");
  assert.deepEqual(parseWiktionary({ fr: [] }), []);
  assert.deepEqual(parseWiktionary(null), []);
  assert.equal(parseWiktionary({ en: [{ partOfSpeech: "Idiom", definitions: [{ definition: "x" }] }] })[0].pos, "idiom");
});

test("HTML to text drops style/script content, decodes entities once, and caps length", () => {
  assert.equal(htmlToText('To be <a href="/wiki/x">contingent</a> <style>.x{color:red}</style>[<i>with</i> <b>on</b>]'), "To be contingent [with on]");
  assert.equal(htmlToText("safe <script>alert('x')</script>text"), "safe text");
  assert.equal(htmlToText("<SCRIPT type=x>bad()</SCRIPT >ok"), "ok");
  assert.equal(htmlToText("before <script>never closed"), "before");
  assert.equal(htmlToText("a &amp; b &lt;b&gt; &#39;q&#39; &#x41;&nbsp;z"), "a & b <b> 'q' A z");
  assert.equal(htmlToText("&amp;lt;"), "&lt;");
  assert.equal(htmlToText("<li>one</li><li>two</li>"), "one two");
  assert.equal(htmlToText("x".repeat(900)).length, 500);
  assert.equal(htmlToText(null), "");
});

test("pattern text may carry placeholders that suggestions may not", async () => {
  const { cleanPattern } = await import("../sources.js");
  assert.equal(cleanPattern("depend on sb/sth"), "depend on sb/sth");
  assert.equal(cleanPattern("sure that + clause"), "sure that + clause");
  assert.equal(cleanSuggestion("depend on sb/sth"), "", "slashes stay out of synonym lists");
  for (const bad of ["<b>", "123", "", "x".repeat(81)]) assert.equal(cleanPattern(bad), "", bad);
});

test("suggestions allow letters, spaces, hyphens, apostrophes only", () => {
  assert.equal(cleanSuggestion("  make   up one’s mind "), "make up one’s mind");
  assert.equal(cleanSuggestion("well-known"), "well-known");
  for (const bad of ["spark (off)", "put/set", "<b>", "123", "", "x".repeat(61), "a.b"]) assert.equal(cleanSuggestion(bad), "", bad);
});
