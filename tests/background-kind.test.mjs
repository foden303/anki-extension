import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const listeners = {};
const menus = [];
const ankiCalls = [];
const fetched = [];
const sessionStore = new Map();
const ankiOverrides = {};
const fixtureBody = async (path) => JSON.parse(await readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8")).body;

globalThis.chrome = {
  runtime: {
    id: "test-extension",
    getURL: (path) => `chrome-extension://test-extension/${path}`,
    onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
    onMessage: { addListener: (fn) => { listeners.message = fn; } },
  },
  storage: {
    local: { get: async (defaults) => ({ ...defaults }), set: async () => {}, setAccessLevel: async () => {} },
    session: {
      get: async (key) => (sessionStore.has(key) ? { [key]: sessionStore.get(key) } : {}),
      set: async (items) => { for (const [key, value] of Object.entries(items)) sessionStore.set(key, value); },
    },
  },
  contextMenus: { removeAll: (done) => done(), create: (item) => menus.push(item), onClicked: { addListener: (fn) => { listeners.menu = fn; } } },
  commands: { onCommand: { addListener: (fn) => { listeners.command = fn; } } },
  tabs: { sendMessage: async (_tabId, message) => { listeners.pageMessages.push(message); return { ok: true }; } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
};
listeners.pageMessages = [];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  fetched.push(href);
  if (href.startsWith("https://translate.googleapis.com/")) {
    const term = new URL(href).searchParams.get("q");
    if (new URL(href).searchParams.getAll("dt").join() === "t") {
      if (term.includes("FAILGLOSS")) return json({ error: "boom" }, 500);
      const lines = term.split("\n");
      if (term.includes("MISMATCH")) return json([[["VI one line only", term, null, null, 1]], null, "en"]);
      return json([lines.map((line, index) => [`VI ${line}${index < lines.length - 1 ? "\n" : ""}`, `${line}${index < lines.length - 1 ? "\n" : ""}`, null, null, 10]), null, "en"]);
    }
    if (term === "light") return json(await fixtureBody("gtx/light.json"));
    return json([[["bản dịch", term, null, null, 10]], null, "en"]);
  }
  if (href === "https://api.dictionaryapi.dev/api/v2/entries/en/light") return json(await fixtureBody("dictionaryapi/light.json"));
  if (href.startsWith("https://api.dictionaryapi.dev/api/v2/entries/en/slow")) {
    return new Promise((resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  }
  if (href.startsWith("https://api.dictionaryapi.dev/media/pronunciations/en/hang-")) {
    // Reproduces the live trace: the media server hangs ~20 s, then answers 522 HTML.
    return new Promise((resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  }
  if (href.startsWith("https://api.dictionaryapi.dev/media/pronunciations/en/broken-")) return new Response("<!DOCTYPE html>522", { status: 522, headers: { "content-type": "text/html" } });
  if (href.startsWith("https://api.dictionaryapi.dev/media/")) return new Response(new Uint8Array([73, 68, 51, 1]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  if (href.startsWith("https://api.dictionaryapi.dev/")) return json({ title: "No Definitions Found" }, 404);
  if (href.startsWith("https://api.datamuse.com/")) return json([{ word: "final", score: 10, tags: ["adj"] }]);
  if (href.startsWith("https://en.wiktionary.org/")) return json({ status: 404 }, 404);
  if (href === "http://127.0.0.1:8765") {
    const { action, params } = JSON.parse(options.body);
    ankiCalls.push({ action, params });
    if (action in ankiOverrides) return json({ result: ankiOverrides[action](params), error: null });
    const results = {
      requestPermission: { permission: "granted", version: 6, requireApiKey: false },
      deckNames: ["Vocab"],
      modelNames: ["VocabBot Word", "VocabBot Collocation"],
      modelFieldNames: params?.modelName === "VocabBot Collocation"
        ? ["Collocation", "Pattern", "Meaning", "Example", "Synonyms", "Context", "Source", "Audio"]
        : ["Word", "Pronunciation", "Category", "Level", "MeaningVN", "Meaning", "Example", "Patterns", "Synonyms", "Antonyms", "RelatedWords", "Paraphrase", "Collocation", "Context", "Source", "Audio"],
      canAddNotes: [true],
      addNote: 1234,
    };
    return json({ result: results[action], error: null });
  }
  throw new Error(`Unexpected fetch ${href}`);
};

const { modelSpecs } = await import("../models.js");
await import("../background.js");

function send(message, sender = { id: "test-extension", url: "https://news.example.com/page", tab: { id: 7 } }) {
  return new Promise((resolve) => listeners.message(message, sender, resolve));
}
const fromOptions = (message) => send(message, { id: "test-extension", url: "chrome-extension://test-extension/options.html" });

test("translate derives kind from the text and ignores a content-supplied kind", async () => {
  const phrase = await send({ type: "translate", text: "give up", kind: "word", targetLanguage: "vi" });
  assert.equal(phrase.ok, true);
  assert.equal(phrase.draft.kind, "collocation");

  const word = await send({ type: "translate", text: "  resilient, ", kind: "collocation", targetLanguage: "vi" });
  assert.equal(word.draft.kind, "word");
  assert.equal(word.draft.term, "resilient");
});

test("translate accepts long phrases as collocations and rejects only text over 500 characters", async () => {
  const phrase = await send({ type: "translate", text: "one two three four five six seven eight nine ten eleven twelve", targetLanguage: "vi" });
  assert.equal(phrase.ok, true);
  assert.equal(phrase.draft.kind, "collocation");
  const oversized = await send({ type: "translate", text: `${"word ".repeat(101)}`, targetLanguage: "vi" });
  assert.equal(oversized.ok, false);
});

test("add-note chooses the note type from the reviewed term, not the draft kind", async () => {
  ankiCalls.length = 0;
  const response = await send({ type: "add-note", draft: { kind: "word", term: "make a decision", translation: "quyết định", type: "verb + noun", deck: "Vocab" } });
  assert.equal(response.ok, true);
  const note = ankiCalls.find((call) => call.action === "addNote").params.note;
  assert.equal(note.modelName, "VocabBot Collocation");
  assert.equal(note.fields.Collocation, "make a decision");
  assert.deepEqual(note.tags, ["anki-add-vocabulary", "collocation"]);

  ankiCalls.length = 0;
  await send({ type: "add-note", draft: { kind: "collocation", term: "resilient", translation: "kiên cường", type: "adjective", deck: "Vocab" } });
  assert.equal(ankiCalls.find((call) => call.action === "addNote").params.note.modelName, "VocabBot Word");
});

test("translate detects the word type from the page sentence", async () => {
  const verb = await send({ type: "translate", text: "lamp", context: "Please lamp the candles on the table.", targetLanguage: "vi" });
  assert.equal(verb.draft.type, "verb");
  assert.deepEqual(verb.draft.typeDetected, ["verb"]);

  const blank = await send({ type: "translate", text: "lamp", context: "", targetLanguage: "vi" });
  assert.equal(blank.draft.type, "");
  assert.deepEqual(blank.draft.typeDetected, []);

  const phrase = await send({ type: "translate", text: "give up", context: "Never give up on your dreams.", targetLanguage: "vi" });
  assert.equal(phrase.draft.type, "phrasal verb");
});

test("translate detects collocation type and pattern template", async () => {
  const response = await send({ type: "translate", text: "made a decision", context: "He made a decision yesterday.", targetLanguage: "vi" });
  assert.equal(response.draft.kind, "collocation");
  assert.equal(response.draft.type, "verb + noun");
  assert.deepEqual(response.draft.typeDetected, ["verb + noun"]);
  assert.equal(response.draft.pattern, "make a/the + decision");
});

test("add-note requires a known collocation type for a collocation", async () => {
  const draft = { term: "heavy rain", translation: "mưa to", deck: "Vocab" };
  assert.equal((await send({ type: "add-note", draft })).ok, false);
  assert.equal((await send({ type: "add-note", draft: { ...draft, type: "adjective" } })).ok, false);
  assert.equal((await send({ type: "add-note", draft: { ...draft, type: "adjective + noun" } })).ok, true);
});

test("add-note requires a known word type for a word", async () => {
  const draft = { term: "resilient", translation: "kiên cường", deck: "Vocab" };
  assert.equal((await send({ type: "add-note", draft })).ok, false);
  assert.equal((await send({ type: "add-note", draft: { ...draft, type: "banana" } })).ok, false);
  assert.equal((await send({ type: "add-note", draft: { ...draft, type: "adjective" } })).ok, true);
});

test("translate uses one GTX request with dictionary blocks and never waits for DictionaryAPI", async () => {
  fetched.length = 0;
  const response = await send({ type: "translate", text: "light", context: "Please light the candles on the table.", targetLanguage: "vi" });
  assert.equal(response.ok, true);
  assert.deepEqual(fetched.map((href) => new URL(href).hostname), ["translate.googleapis.com"]);
  assert.deepEqual(new URL(fetched[0]).searchParams.getAll("dt"), ["t", "bd", "ss", "md", "ex"]);
  assert.equal(response.draft.type, "verb");
  assert.deepEqual(response.draft.typeDetected, ["verb", "adjective", "adverb", "noun"]);
  assert.equal(response.draft.meaning, "provide with light or lighting; illuminate.");
  assert.equal(response.draft.synonyms[0], "set alight");
  assert.ok(response.draft.synonyms.length <= 5);
  assert.equal(response.draft.meaningsByType.noun[0], "ánh sáng");
  assert.equal(response.draft.audioUrl, "");
});

test("dictionary runs separately for single English words, is cached, and feeds add-note audio", async () => {
  fetched.length = 0;
  const first = await send({ type: "dictionary", term: "light" });
  assert.equal(first.ok, true);
  assert.match(first.dictionary.audioUrl, /light-(uk|us)\.mp3$/);
  assert.ok(first.dictionary.antonyms.adjective.includes("heavy"));
  assert.equal((await send({ type: "dictionary", term: "light" })).ok, true);
  assert.equal(fetched.filter((href) => href.includes("/entries/en/light")).length, 1, "second call served from cache");

  fetched.length = 0;
  const phrase = await send({ type: "dictionary", term: "give up" });
  assert.equal(phrase.ok, false);
  assert.equal(fetched.length, 0, "phrases never reach DictionaryAPI");

  const prepared = await send({ type: "prepare-audio", audioUrl: first.dictionary.audioUrl });
  assert.equal(prepared.ok, true);
  fetched.length = 0;
  ankiCalls.length = 0;
  const added = await send({ type: "add-note", draft: { term: "light", translation: "ánh sáng", type: "noun", deck: "Vocab" } });
  assert.equal(added.audioStored, true);
  assert.match(ankiCalls.find((call) => call.action === "storeMediaFile").params.filename, /^light-(uk|us)\.mp3$/);
  assert.ok(!fetched.some((href) => href.includes("/media/")), "add uses the prepared MP3 without downloading again");
});

test("add-note never waits for an MP3 that is not ready (reported: Request timed out)", async () => {
  ankiCalls.length = 0;
  fetched.length = 0;
  const started = Date.now();
  const added = await send({ type: "add-note", draft: { term: "renowned", translation: "nổi tiếng", type: "adjective", deck: "Vocab", audioUrl: "https://api.dictionaryapi.dev/media/pronunciations/en/hang-renowned-us.mp3" } });
  assert.ok(Date.now() - started < 1000, "no download at add time");
  assert.equal(added.ok, true);
  assert.equal(added.audioStored, false);
  assert.match(added.audioSkipped, /MP3/);
  assert.ok(!fetched.some((href) => href.includes("/media/")));
  assert.equal(ankiCalls.find((call) => call.action === "addNote").params.note.fields.Audio, "");
  assert.ok(!ankiCalls.some((call) => call.action === "storeMediaFile"));
});

test("prepare-audio validates, downloads once, and reports DictionaryAPI failures", async () => {
  assert.equal((await send({ type: "prepare-audio", audioUrl: "https://evil.example/x.mp3" })).error.code, "INVALID_AUDIO_URL");
  const broken = await send({ type: "prepare-audio", audioUrl: "https://api.dictionaryapi.dev/media/pronunciations/en/broken-word-us.mp3" });
  assert.equal(broken.ok, false);
  assert.equal(broken.error.code, "AUDIO_DOWNLOAD_FAILED");

  fetched.length = 0;
  const url = "https://api.dictionaryapi.dev/media/pronunciations/en/ambitious-us.mp3";
  const [one, two] = await Promise.all([send({ type: "prepare-audio", audioUrl: url }), send({ type: "prepare-audio", audioUrl: url })]);
  assert.equal(one.ok && two.ok, true);
  assert.equal((await send({ type: "prepare-audio", audioUrl: url })).filename, "ambitious-us.mp3");
  assert.equal(fetched.filter((href) => href === url).length, 1, "concurrent and repeated calls share one download");

  ankiCalls.length = 0;
  const added = await send({ type: "add-note", draft: { term: "ambitious", translation: "tham vọng", type: "adjective", deck: "Vocab", audioUrl: url } });
  assert.equal(added.audioStored, true);
  assert.equal(added.audioSkipped, "");
  assert.equal(ankiCalls.find((call) => call.action === "addNote").params.note.fields.Audio, "[sound:ambitious-us.mp3]");
});

test("a DictionaryAPI failure is remembered, so the same word never hangs twice (performance)", async () => {
  fetched.length = 0;
  const first = await send({ type: "dictionary", term: "slowword" });
  assert.equal(first.ok, false);
  const second = await send({ type: "dictionary", term: "slowword" });
  assert.equal(second.ok, false);
  assert.match(second.error.message, /did not respond/i);
  assert.equal(fetched.filter((href) => href.includes("/entries/en/slowword")).length, 1, "second lookup served from the failure cache");
});

test("the session cache prunes expired entries instead of growing forever (performance)", async () => {
  const { createCache } = await import("../enrich.js");
  const area = { store: new Map() };
  area.get = async (key) => (key === null ? Object.fromEntries(area.store) : (area.store.has(key) ? { [key]: area.store.get(key) } : {}));
  area.set = async (items) => { for (const [key, value] of Object.entries(items)) area.store.set(key, value); };
  area.remove = async (keys) => { for (const key of [keys].flat()) area.store.delete(key); };
  let now = 0;
  const cache = createCache({ area, ttlMs: 1000, now: () => now, maxEntries: 5 });
  for (let index = 0; index < 5; index += 1) await cache.set(`old:${index}`, { index });
  now = 2000;
  await cache.set("fresh", { index: 99 });
  assert.equal(area.store.size, 1, "expired entries dropped on write");
  assert.deepEqual(await cache.get("fresh"), { index: 99 });

  for (let index = 0; index < 8; index += 1) await cache.set(`live:${index}`, { index });
  assert.ok(area.store.size <= 5, `size ${area.store.size}`);
  assert.deepEqual(await cache.get("live:7"), { index: 7 }, "newest kept");
  assert.equal(await cache.get("live:0"), undefined, "oldest dropped first");
});

test("enrich validates the type for the derived kind and sends only the term", async () => {
  fetched.length = 0;
  const response = await send({ type: "enrich", term: "decision", termType: "noun", context: "a secret sentence" });
  assert.equal(response.ok, true);
  assert.equal(response.enrichment.kind, "word");
  assert.equal(response.enrichment.collocations[0].text, "final decision");
  assert.ok(fetched.length > 0 && fetched.every((href) => !href.includes("secret")));
  assert.equal((await send({ type: "enrich", term: "decision", termType: "phrasal verb" })).ok, false);
  assert.equal((await send({ type: "enrich", term: "give up", termType: "phrasal verb" })).enrichment.kind, "collocation");
});

test("translate returns the sentence pattern for a word; enrich makes no Anki calls", async () => {
  const word = await send({ type: "translate", text: "resilient", context: "The company proved resilient in the downturn.", targetLanguage: "vi" });
  assert.equal(word.draft.contextPattern, "resilient in sb/sth");
  ankiCalls.length = 0;
  await send({ type: "enrich", term: "resilient", termType: "adjective" });
  assert.equal(ankiCalls.length, 0);
});

test("add-note writes the reviewed chip lists into the note fields", async () => {
  ankiCalls.length = 0;
  const response = await send({ type: "add-note", draft: {
    term: "resilient", translation: "kiên cường", type: "adjective", deck: "Vocab",
    patterns: ["resilient in", "resilient to sb/sth"], collocations: ["resilient material"], synonyms: ["robust", "elastic"], antonyms: ["brittle"],
  } });
  assert.equal(response.ok, true);
  const fields = ankiCalls.find((call) => call.action === "addNote").params.note.fields;
  assert.equal(fields.Patterns, "resilient in<br>resilient to sb/sth");
  assert.equal(fields.Collocation, "resilient material");
  assert.equal(fields.Synonyms, "robust<br>elastic");
  assert.equal(fields.Antonyms, "brittle");

  ankiCalls.length = 0;
  await send({ type: "add-note", draft: { term: "give up", translation: "bỏ cuộc", type: "phrasal verb", pattern: "give up sth", deck: "Vocab", similar: ["quit", "abandon"] } });
  const colloc = ankiCalls.find((call) => call.action === "addNote").params.note.fields;
  assert.equal(colloc.Pattern, "give up sth");
  assert.equal(colloc.Synonyms, "quit<br>abandon");

  const oversized = { term: "resilient", translation: "kiên cường", type: "adjective", deck: "Vocab", synonyms: Array.from({ length: 40 }, (_, index) => `word${index}`) };
  ankiCalls.length = 0;
  await send({ type: "add-note", draft: oversized });
  assert.equal(ankiCalls.find((call) => call.action === "addNote").params.note.fields.Synonyms.split("<br>").length, 10);
});

test("note-type status and upgrade are available only to the Options page", async () => {
  const [v1] = modelSpecs.word.previous;
  const cards = (version) => ({ Recognition: { Front: version.front, Back: version.back } });
  let word = v1;
  const collocation = modelSpecs.collocation;
  ankiOverrides.modelTemplates = ({ modelName }) => (modelName === "VocabBot Word" ? cards(word) : cards(collocation));
  ankiOverrides.modelStyling = ({ modelName }) => ({ css: modelName === "VocabBot Word" ? word.css : collocation.css });

  const blocked = await send({ type: "model-status" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "OPTIONS_ONLY");
  assert.equal((await send({ type: "upgrade-models", kinds: ["word"] })).error.code, "OPTIONS_ONLY");

  const status = await fromOptions({ type: "model-status" });
  assert.deepEqual(status.models.map(({ kind, status: value }) => [kind, value]), [["word", "outdated"], ["collocation", "current"]]);

  ankiCalls.length = 0;
  const upgraded = await fromOptions({ type: "upgrade-models", kinds: ["word", "collocation"] });
  assert.equal(upgraded.ok, true);
  const templateUpdates = ankiCalls.filter((call) => call.action === "updateModelTemplates");
  const stylingUpdates = ankiCalls.filter((call) => call.action === "updateModelStyling");
  assert.equal(templateUpdates.length, 1, "current collocation untouched");
  assert.equal(templateUpdates[0].params.model.name, "VocabBot Word");
  assert.equal(templateUpdates[0].params.model.templates.Recognition.Front, modelSpecs.word.front);
  assert.equal(templateUpdates[0].params.model.templates.Recognition.Back, modelSpecs.word.back);
  assert.deepEqual(stylingUpdates.map((call) => call.params.model), [{ name: "VocabBot Word", css: modelSpecs.word.css }], "explicit upgrade also applies the v3 styling");
  assert.ok(!ankiCalls.some((call) => call.action === "createModel" || call.action === "modelFieldAdd"));

  word = { front: "mine", back: "mine", css: "mine" };
  ankiCalls.length = 0;
  const refused = await fromOptions({ type: "upgrade-models", kinds: ["word"] });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "CONFIRMATION_REQUIRED");
  assert.ok(!ankiCalls.some((call) => call.action === "updateModelTemplates" || call.action === "updateModelStyling"));
  assert.equal((await fromOptions({ type: "upgrade-models", kinds: ["word"], confirmCustomized: true })).ok, true);
  assert.equal(ankiCalls.filter((call) => call.action === "updateModelTemplates").length, 1);

  ankiOverrides.modelTemplates = () => ({ A: { Front: "x", Back: "y" }, B: { Front: "x", Back: "y" } });
  ankiCalls.length = 0;
  assert.equal((await fromOptions({ type: "upgrade-models", kinds: ["word"], confirmCustomized: true })).error.code, "UPGRADE_UNSUPPORTED");
  assert.ok(!ankiCalls.some((call) => call.action === "updateModelTemplates" || call.action === "updateModelStyling"));
  delete ankiOverrides.modelTemplates;
  delete ankiOverrides.modelStyling;
});

test("add-note never changes an existing note type and reports antonyms hidden by a template without them", async () => {
  const [v1, v2] = modelSpecs.word.previous;
  ankiOverrides.modelTemplates = () => ({ Recognition: { Front: v1.front, Back: v1.back } });
  ankiCalls.length = 0;
  const draft = { term: "resilient", translation: "kiên cường", type: "adjective", deck: "Vocab", antonyms: ["brittle"] };
  const hidden = await send({ type: "add-note", draft });
  assert.equal(hidden.ok, true);
  assert.equal(hidden.antonymsHidden, true);
  assert.ok(!ankiCalls.some((call) => ["updateModelTemplates", "updateModelStyling", "createModel", "modelFieldAdd"].includes(call.action)));

  ankiOverrides.modelTemplates = () => ({ Recognition: { Front: v2.front, Back: v2.back } });
  assert.equal((await send({ type: "add-note", draft })).antonymsHidden, false, "v2 already shows antonyms");
  ankiOverrides.modelTemplates = () => ({ Recognition: { Front: modelSpecs.word.front, Back: modelSpecs.word.back } });
  assert.equal((await send({ type: "add-note", draft })).antonymsHidden, false);
  assert.equal((await send({ type: "add-note", draft: { ...draft, antonyms: [] } })).antonymsHidden, false);
  delete ankiOverrides.modelTemplates;

  ankiOverrides.modelNames = () => ["Basic"];
  ankiCalls.length = 0;
  await send({ type: "add-note", draft: { term: "give up", translation: "bỏ cuộc", type: "phrasal verb", deck: "Vocab" } });
  const created = ankiCalls.find((call) => call.action === "createModel");
  assert.equal(created.params.modelName, "VocabBot Collocation");
  assert.equal(created.params.cardTemplates[0].Back, modelSpecs.collocation.back, "a missing model is created with the current template");
  assert.equal(created.params.css, modelSpecs.collocation.css);
  delete ankiOverrides.modelNames;
});

test("add-note appends target-language glosses in one GTX request and returns the glossed note", async () => {
  fetched.length = 0;
  ankiCalls.length = 0;
  const response = await send({ type: "add-note", draft: {
    term: "ambitious", translation: "tham vọng", type: "adjective", deck: "Vocab", targetLanguage: "vi",
    example: "She is ambitious.", context: "She is ambitious.",
    patterns: ["be ambitious"], collocations: ["ambitious goals"], synonyms: ["driven", "already (glossed)"], antonyms: ["lazy"],
  } });
  assert.equal(response.ok, true);
  const glossRequests = fetched.filter((href) => href.startsWith("https://translate.googleapis.com/") && new URL(href).searchParams.getAll("dt").join() === "t");
  assert.equal(glossRequests.length, 1);
  assert.deepEqual(new URL(glossRequests[0]).searchParams.get("q").split("\n"), ["be ambitious", "ambitious goals", "driven", "lazy", "She is ambitious."]);
  const fields = ankiCalls.find((call) => call.action === "addNote").params.note.fields;
  assert.equal(fields.Patterns, "be ambitious (VI be ambitious)");
  assert.equal(fields.Collocation, "ambitious goals (VI ambitious goals)");
  assert.equal(fields.Synonyms, "driven (VI driven)<br>already (glossed)");
  assert.equal(fields.Antonyms, "lazy (VI lazy)");
  assert.equal(fields.Example, "She is ambitious. (VI She is ambitious.)");
  assert.equal(fields.Context, "", "context equal to the example is not repeated");
  assert.deepEqual(response.note.synonyms, ["driven (VI driven)", "already (glossed)"]);

  fetched.length = 0;
  ankiCalls.length = 0;
  await send({ type: "add-note", draft: { term: "ambitious", translation: "ambitious", type: "adjective", deck: "Vocab", targetLanguage: "en", synonyms: ["driven"], example: "A sentence here.", context: "A different page sentence." } });
  assert.equal(fetched.filter((href) => href.includes("translate.googleapis.com")).length, 0, "no glosses for an English target");
  const plain = ankiCalls.find((call) => call.action === "addNote").params.note.fields;
  assert.equal(plain.Synonyms, "driven");
  assert.equal(plain.Context, "A different page sentence.");

  ankiCalls.length = 0;
  const longExample = `Plenty of studies have sounded alarm bells about the state of marine debris; in a recent paper published in the journal Ecology, Rochman and her colleagues set out to determine how many of those perceived risks are real ${"and measurable ".repeat(10)}today.`;
  await send({ type: "add-note", draft: { term: "colleagues", translation: "đồng nghiệp", type: "noun", deck: "Vocab", targetLanguage: "vi", example: longExample } });
  const glossedExample = ankiCalls.find((call) => call.action === "addNote").params.note.fields.Example;
  assert.ok(glossedExample.endsWith(`(VI ${longExample})`), "reported bug: the example translation was cut at 200 characters");

  ankiCalls.length = 0;
  const failed = await send({ type: "add-note", draft: { term: "ambitious", translation: "tham vọng", type: "adjective", deck: "Vocab", targetLanguage: "vi", synonyms: ["FAILGLOSS"] } });
  assert.equal(failed.ok, true, "gloss failure never blocks the add");
  assert.equal(ankiCalls.find((call) => call.action === "addNote").params.note.fields.Synonyms, "FAILGLOSS");

  ankiCalls.length = 0;
  await send({ type: "add-note", draft: { term: "ambitious", translation: "tham vọng", type: "adjective", deck: "Vocab", targetLanguage: "vi", synonyms: ["MISMATCH", "driven"] } });
  assert.equal(ankiCalls.find((call) => call.action === "addNote").params.note.fields.Synonyms, "MISMATCH<br>driven", "line count mismatch keeps items unglossed");
});

test("add-note reports whether the note type in Anki is the current design", async () => {
  const [v1] = modelSpecs.word.previous;
  ankiOverrides.modelTemplates = () => ({ Recognition: { Front: v1.front, Back: v1.back } });
  ankiOverrides.modelStyling = () => ({ css: v1.css });
  const draft = { term: "author", translation: "tác giả", type: "noun", deck: "Vocab", collocations: ["first author"] };
  const old = await send({ type: "add-note", draft });
  assert.equal(old.templateStatus, "outdated");

  ankiOverrides.modelTemplates = () => ({ Recognition: { Front: modelSpecs.word.front, Back: modelSpecs.word.back } });
  ankiOverrides.modelStyling = () => ({ css: modelSpecs.word.css });
  assert.equal((await send({ type: "add-note", draft })).templateStatus, "current");
  delete ankiOverrides.modelTemplates;
  delete ankiOverrides.modelStyling;
});

test("open-options opens the settings page", async () => {
  let opened = 0;
  chrome.runtime.openOptionsPage = async () => { opened += 1; };
  assert.equal((await send({ type: "open-options" })).ok, true);
  assert.equal(opened, 1);
});

test("manifest grants the enrichment hosts", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  for (const host of ["https://api.datamuse.com/*", "https://en.wiktionary.org/*", "https://api.dictionaryapi.dev/*", "https://translate.googleapis.com/*"]) {
    assert.ok(manifest.host_permissions.includes(host), host);
  }
});

test("only one context menu and one shortcut start the flow, without a kind", async () => {
  await listeners.installed();
  assert.deepEqual(menus.map((item) => item.id), ["translate-selection"]);

  listeners.pageMessages.length = 0;
  await listeners.menu({ menuItemId: "translate-selection" }, { id: 7 });
  await listeners.command("translate-selection", { id: 7 });
  assert.deepEqual(listeners.pageMessages, [{ type: "open-selection-flow" }, { type: "open-selection-flow" }]);

  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(manifest.commands), ["translate-selection"]);
  assert.deepEqual(manifest.content_scripts[0].js, ["term-kind.js", "suggestions.js", "page-context.js", "content.js"]);
});
