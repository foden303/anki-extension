import { modelSpecs, templateStatus } from "./models.js";
import "./term-kind.js";
import { contextPattern, detectWordType } from "./word-type.js";
import { detectCollocation } from "./collocation-type.js";
import { fetchJson, isDictionaryAudio, parseDictionary, parseGtx } from "./sources.js";
import { createCache, createEnricher } from "./enrich.js";

const { classifyTerm, WORD_TYPES, COLLOCATION_TYPES } = globalThis.AnkiVocabularyTerm;
const DEFAULT_SETTINGS = Object.freeze({
  ankiUrl: "http://127.0.0.1:8765",
  ankiApiKey: "",
  targetLanguage: "vi",
  blockedSites: [],
});

const TRANSLATION_HOSTS = ["translate.googleapis.com", "translate.google.com"];
const TRANSLATION_TIMEOUT_MS = 10_000;
// Uncached DictionaryAPI lookups took 19–20 s in the Task 5.1 fixtures, so they run outside Step 1.
const DICTIONARY_TIMEOUT_MS = 25_000;
const GLOSS_TIMEOUT_MS = 6_000;
// DictionaryAPI media hung ~20 s then returned HTTP 522 in the 2026-09-15 trace; downloads run ahead of Add, never inside it.
const AUDIO_TIMEOUT_MS = 30_000;
const audioInFlight = new Map();
const GLOSS_MAX_CHARS = 1_800;
const sessionCache = createCache({ area: chrome.storage.session });
const enrich = createEnricher({ cache: sessionCache });
const dictionaryInFlight = new Map();
const SUPPORTED_LANGUAGE_CODES = new Set([
  "vi", "en", "ja", "ko", "zh-CN", "fr", "de", "es", "th", "ru",
  "pt", "it", "ar", "hi", "id", "tr", "pl", "nl", "sv", "ms",
]);

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "translate-selection", title: "Translate and add %s to Anki", contexts: ["selection"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-selection") return openSelectionFlow(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "translate-selection") return openSelectionFlow(tab);
});

async function openSelectionFlow(tab) {
  const response = await askPage(tab?.id, { type: "open-selection-flow" });
  if (!response?.ok) await notify("Select vocabulary on a normal web page first.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse(fail("UNTRUSTED_SENDER", "Request rejected."));
    return false;
  }
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse(fail(error.code || "UNEXPECTED", messageFor(error), Boolean(error.retryable))));
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "model-status": return optionsOnly(sender, modelStatus);
    case "upgrade-models": return optionsOnly(sender, () => upgradeModels(message));
    case "translate": return translateSelection(message);
    case "list-decks": return { ok: true, decks: await listDecks() };
    case "create-deck": return { ok: true, deck: await createDeck(message.name) };
    case "add-note": return addNote(message.draft);
    case "open-options": await chrome.runtime.openOptionsPage(); return { ok: true };
    case "dictionary": return dictionaryForTerm(message.term);
    case "prepare-audio": return prepareAudio(message.audioUrl);
    case "enrich": return enrichTerm(message);
    case "status": return status();
    case "get-ui-settings": return uiSettings();
    case "block-site": return blockSite(message.host);
    case "save-settings": return saveSettings(message.settings);
    default: return fail("UNKNOWN_MESSAGE", "Unsupported extension request.");
  }
}

async function translateSelection(message) {
  const { term: text, kind } = selectedTerm(message.text, "Selected text");
  const config = await settings();
  const targetLanguage = supportedLanguage(message.targetLanguage || config.targetLanguage);
  const translated = await translate(text, "auto", targetLanguage);
  const sentence = optionalText(message.context, 1000);
  const detection = kind === "word"
    ? detectWordType({ term: text, sentence, candidates: translated.types })
    : collocationDetection(text, sentence);
  const definition = translated.definitions[detection.type]?.[0];
  return {
    ok: true,
    requestId: String(message.requestId || ""),
    draft: {
      kind,
      term: text,
      translation: translated.translation,
      sourceLanguage: translated.detectedLanguage || "auto",
      targetLanguage,
      pronunciation: "",
      audioUrl: "",
      type: detection.type,
      typeDetected: detection.detected,
      meaning: kind === "word" ? definition?.text || "" : "",
      meaningsByType: translated.meanings,
      example: message.context || definition?.example || "",
      synonyms: kind === "word" ? (translated.synonyms[detection.type] || []).slice(0, 5) : [],
      contextPattern: kind === "word" ? contextPattern(text, sentence) : "",
      pattern: detection.pattern || "",
      source: sanitizeSource(message.source),
    },
  };
}

function collocationDetection(term, sentence) {
  const { type, pattern } = detectCollocation({ term, sentence });
  return { type, pattern, detected: [type] };
}

// One GTX request supplies the translation plus POS groups, synonyms, definitions, and examples (dt=bd,ss,md,ex).
async function translate(text, sourceLanguage, targetLanguage) {
  const query = new URLSearchParams({ client: "gtx", sl: sourceLanguage, tl: targetLanguage, q: text });
  for (const dt of ["t", "bd", "ss", "md", "ex"]) query.append("dt", dt);
  let lastError = new Error("Translation service unavailable.");
  for (const host of TRANSLATION_HOSTS) {
    try {
      const response = await timedFetch(`https://${host}/translate_a/single?${query}`, TRANSLATION_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Translation service returned HTTP ${response.status}.`);
      const parsed = parseGtx(await response.json());
      if (!parsed.translation) throw new Error("Translation service returned no translation.");
      await sessionCache.set(`gtx:${text.toLowerCase()}`, parsed);
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw new UserError("TRANSLATION_UNAVAILABLE", messageFor(lastError), true);
}

// Slow source: requested by the page after Step 1 renders; concurrent callers share one request.
async function dictionaryForTerm(rawTerm) {
  const { term, kind } = selectedTerm(rawTerm, "Term");
  if (kind !== "word" || !isSingleEnglishWord(term)) return fail("NOT_SINGLE_WORD", "Dictionary lookup is only available for a single English word.");
  return { ok: true, dictionary: await cachedDictionary(term) };
}

async function cachedDictionary(term) {
  const key = `dictionary:${term.toLowerCase()}`;
  const hit = await sessionCache.get(key);
  if (hit) return hit;
  // DictionaryAPI hangs ~20 s when it is down; remember that so the same word is not retried on every selection.
  const failure = await sessionCache.get(`error:${key}`);
  if (failure) throw new UserError("DICTIONARY_UNAVAILABLE", failure.message, true);
  if (!dictionaryInFlight.has(key)) {
    const pending = fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term.toLowerCase())}`, { signal: AbortSignal.timeout(DICTIONARY_TIMEOUT_MS) })
      .then(async (body) => {
        const parsed = parseDictionary(body);
        await sessionCache.set(key, parsed);
        return parsed;
      })
      .catch(async () => {
        const message = "DictionaryAPI did not respond. Pronunciation and audio are unavailable for now.";
        await sessionCache.set(`error:${key}`, { message });
        throw new UserError("DICTIONARY_UNAVAILABLE", message, true);
      })
      .finally(() => dictionaryInFlight.delete(key));
    dictionaryInFlight.set(key, pending);
  }
  return dictionaryInFlight.get(key);
}

async function enrichTerm(message) {
  const { term, kind } = selectedTerm(message.term, "Term");
  const termType = message.termType ? requiredType(message.termType, kind) : "";
  return { ok: true, enrichment: await enrich({ term, type: termType }) };
}

async function listDecks() {
  const result = await anki("deckNames", {});
  if (!Array.isArray(result)) throw new UserError("ANKI_PROTOCOL", "AnkiConnect returned an invalid deck list.");
  return result.filter((name) => typeof name === "string").sort((left, right) => left.localeCompare(right));
}

async function createDeck(name) {
  const deck = boundedText(name, 100, "Deck name");
  await anki("createDeck", { deck });
  return deck;
}

async function addNote(rawDraft) {
  const draft = await withGlosses(validateDraft(rawDraft));
  const deckNames = await listDecks();
  if (!deckNames.includes(draft.deck)) return fail("DECK_MISSING", `The Anki deck “${draft.deck}” no longer exists.`);
  const spec = await ensureVocabularyModel(draft.kind);
  const cached = draft.kind === "word" ? await sessionCache.get(`dictionary:${draft.term.toLowerCase()}`) : null;
  const audioUrl = draft.audioUrl || cached?.audioUrl || "";
  const media = audioUrl ? await sessionCache.get(`audio:${audioUrl}`) : null;
  const audio = media ? await storeMedia(media) : "";
  const audioSkipped = audioUrl && !media ? "The pronunciation MP3 was not ready (DictionaryAPI is not responding), so Anki TTS will read the word." : "";
  const note = {
    deckName: draft.deck,
    modelName: spec.name,
    fields: buildVocabularyFields(draft, audio),
    tags: ["anki-add-vocabulary", draft.kind],
  };
  const allowed = await anki("canAddNotes", { notes: [note] });
  if (Array.isArray(allowed) && allowed[0] === false) return fail("DUPLICATE", `“${draft.term}” already exists for this note type. Nothing was changed.`);
  const noteId = await anki("addNote", { note });
  if (!Number.isInteger(noteId) || noteId <= 0) return fail("ANKI_PROTOCOL", "AnkiConnect did not return a valid note ID.");
  // Report what the note type in Anki actually shows; Add never changes it.
  const templates = await anki("modelTemplates", { modelName: spec.name });
  const styling = await anki("modelStyling", { modelName: spec.name });
  const cards = Object.values(templates && typeof templates === "object" ? templates : {});
  const antonymsHidden = draft.kind === "word" && draft.antonyms.length > 0 && !String(cards.length === 1 ? cards[0].Back : spec.back).includes("{{Antonyms}}");
  const { patterns, collocations, synonyms, antonyms, similar, example, context } = draft;
  return {
    ok: true, status: "added", noteId, audioStored: Boolean(audio), audioSkipped, antonymsHidden,
    templateStatus: cards.length === 1 && typeof styling?.css === "string" ? templateStatus(spec, templates, styling.css).status : "unknown",
    note: { patterns, collocations, synonyms, antonyms, similar, example, context },
  };
}

// Note-type inspection and template upgrades may change the user's Anki collection, so only the Options page may ask.
function optionsOnly(sender, action) {
  let fromOptions = false;
  try {
    const url = new URL(sender?.url || "");
    fromOptions = !sender.tab && `${url.protocol}//${url.host}${url.pathname}` === chrome.runtime.getURL("options.html");
  } catch { fromOptions = false; }
  return fromOptions ? action() : fail("OPTIONS_ONLY", "This action is only available from the extension settings page.");
}

async function modelStatus() {
  const names = await anki("modelNames", {});
  if (!Array.isArray(names)) throw new UserError("ANKI_PROTOCOL", "AnkiConnect returned an invalid model list.");
  const models = [];
  for (const [kind, spec] of Object.entries(modelSpecs)) {
    if (!names.includes(spec.name)) {
      models.push({ kind, name: spec.name, status: "missing", cardName: "" });
      continue;
    }
    const fields = await anki("modelFieldNames", { modelName: spec.name });
    const missingFields = spec.fields.filter((field) => !Array.isArray(fields) || !fields.includes(field));
    if (missingFields.length) {
      models.push({ kind, name: spec.name, status: "missing-fields", cardName: "", missingFields });
      continue;
    }
    const templates = await anki("modelTemplates", { modelName: spec.name });
    const styling = await anki("modelStyling", { modelName: spec.name });
    models.push({ kind, name: spec.name, ...templateStatus(spec, templates, styling?.css) });
  }
  return { ok: true, models };
}

// Replaces card templates and styling only for outdated models, or customized ones after explicit confirmation. Fields are never touched.
async function upgradeModels(message) {
  const kinds = Array.isArray(message.kinds) ? message.kinds.filter((kind) => kind in modelSpecs) : [];
  const { models } = await modelStatus();
  const targets = models.filter((model) => kinds.includes(model.kind));
  const blocked = targets.find((model) => model.status === "unsupported" || model.status === "missing-fields");
  if (blocked) return fail("UPGRADE_UNSUPPORTED", `“${blocked.name}” cannot be upgraded automatically (${blocked.status === "unsupported" ? "it does not have exactly one card type" : "it is missing required fields"}).`);
  if (targets.some((model) => model.status === "customized") && message.confirmCustomized !== true) {
    return fail("CONFIRMATION_REQUIRED", "Your note type has a customized card template. Upgrading replaces those changes.");
  }
  const upgraded = [];
  for (const model of targets.filter((item) => item.status === "outdated" || item.status === "customized")) {
    const spec = modelSpecs[model.kind];
    await anki("updateModelTemplates", { model: { name: spec.name, templates: { [model.cardName]: { Front: spec.front, Back: spec.back } } } });
    await anki("updateModelStyling", { model: { name: spec.name, css: spec.css } });
    upgraded.push(spec.name);
  }
  return { ok: true, upgraded, models: (await modelStatus()).models };
}

async function ensureVocabularyModel(kind) {
  const spec = modelSpecs[kind];
  const names = await anki("modelNames", {});
  if (!Array.isArray(names)) throw new UserError("ANKI_PROTOCOL", "AnkiConnect returned an invalid model list.");
  if (!names.includes(spec.name)) {
    await anki("createModel", {
      modelName: spec.name,
      inOrderFields: spec.fields,
      css: spec.css,
      isCloze: false,
      cardTemplates: [{ Name: "Recognition", Front: spec.front, Back: spec.back }],
    });
  }
  const fields = await anki("modelFieldNames", { modelName: spec.name });
  if (!Array.isArray(fields) || spec.fields.some((field) => !fields.includes(field))) {
    throw new UserError("MODEL_SCHEMA_MISMATCH", `Anki note type “${spec.name}” is missing required VocabBot fields.`);
  }
  return spec;
}

function buildVocabularyFields(draft, audio) {
  const source = draft.source?.url
    ? `<a href="${escapeAttribute(draft.source.url)}">${escapeHtml(draft.source.title || draft.source.url)}</a>`
    : "";
  if (draft.kind === "collocation") {
    return {
      Collocation: escapeHtml(draft.term),
      Pattern: escapeHtml(draft.pattern),
      Meaning: escapeHtml(draft.translation),
      Example: escapeHtml(draft.example),
      Synonyms: escapeHtml(draft.similar.join("\n")),
      Context: escapeHtml(distinctContext(draft)),
      Source: source,
      Audio: audio,
    };
  }
  return {
    Word: escapeHtml(draft.term),
    Pronunciation: escapeHtml(draft.pronunciation),
    Category: escapeHtml(draft.type),
    Level: "",
    MeaningVN: escapeHtml(draft.translation),
    Meaning: escapeHtml(draft.meaning),
    Example: escapeHtml(draft.example),
    Patterns: escapeHtml(draft.patterns.join("\n")),
    Synonyms: escapeHtml(draft.synonyms.join("\n")),
    Antonyms: escapeHtml(draft.antonyms.join("\n")),
    RelatedWords: "", Paraphrase: "",
    Collocation: escapeHtml(draft.collocations.join("\n")),
    Context: escapeHtml(distinctContext(draft)),
    Source: source,
    Audio: audio,
  };
}

// The Example usage box already shows the page sentence when Example came from it.
function distinctContext(draft) {
  const plain = (value) => String(value || "").replace(/\s*\([^()]*\)\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
  return plain(draft.context) === plain(draft.example) ? "" : draft.context;
}

// Appends "(translation)" to reviewed list items and the example with one GTX request (lines stay aligned).
// Any failure or misalignment keeps the note unglossed; it never blocks the add.
async function withGlosses(draft) {
  if (!SUPPORTED_LANGUAGE_CODES.has(draft.targetLanguage) || draft.targetLanguage === "en") return draft;
  const listFields = draft.kind === "word" ? ["patterns", "collocations", "synonyms", "antonyms"] : ["similar"];
  const targets = [];
  let budget = GLOSS_MAX_CHARS;
  const want = (field, index, text) => {
    if (!text || /\([^()]*\)\s*$/.test(text) || text.length + 1 > budget) return;
    budget -= text.length + 1;
    targets.push({ field, index, text });
  };
  for (const field of listFields) draft[field].forEach((text, index) => want(field, index, text));
  want("example", -1, draft.example);
  if (!targets.length) return draft;
  try {
    const query = new URLSearchParams({ client: "gtx", sl: "en", tl: draft.targetLanguage, dt: "t", q: targets.map((target) => target.text).join("\n") });
    const response = await timedFetch(`https://translate.googleapis.com/translate_a/single?${query}`, GLOSS_TIMEOUT_MS);
    if (!response.ok) return draft;
    const body = await response.json();
    const lines = (Array.isArray(body?.[0]) ? body[0] : []).map((part) => (typeof part?.[0] === "string" ? part[0] : "")).join("").normalize("NFC").split("\n");
    if (lines.length !== targets.length) return draft;
    const glossed = { ...draft, ...Object.fromEntries(listFields.map((field) => [field, [...draft[field]]])) };
    targets.forEach((target, index) => {
      // Never cut a translation mid-word; an implausibly long one is dropped instead.
      const gloss = lines[index].replace(/[()]/g, "").trim();
      if (!gloss || gloss.length > 1200 || gloss.toLowerCase() === target.text.toLowerCase()) return;
      const value = `${target.text} (${gloss})`;
      if (target.field === "example") glossed.example = value;
      else glossed[target.field][target.index] = value;
    });
    return glossed;
  } catch {
    return draft;
  }
}

// Downloads a validated DictionaryAPI MP3 into the session cache; concurrent callers share one request.
async function prepareAudio(value) {
  const audioUrl = String(value || "");
  if (!isDictionaryAudio(audioUrl)) throw new UserError("INVALID_AUDIO_URL", "Only the validated DictionaryAPI recording can be attached.");
  const key = `audio:${audioUrl}`;
  const hit = await sessionCache.get(key);
  if (hit) return { ok: true, filename: hit.filename };
  const failure = await sessionCache.get(`error:${key}`);
  if (failure) throw new UserError("AUDIO_DOWNLOAD_FAILED", failure.message, true);
  if (!audioInFlight.has(key)) {
    const pending = downloadAudio(audioUrl)
      .then(async (media) => { await sessionCache.set(key, media); return media; })
      .catch(async (error) => {
        await sessionCache.set(`error:${key}`, { message: messageFor(error) });
        throw error;
      })
      .finally(() => audioInFlight.delete(key));
    audioInFlight.set(key, pending);
  }
  const media = await audioInFlight.get(key);
  return { ok: true, filename: media.filename };
}

async function downloadAudio(audioUrl) {
  let response;
  try {
    response = await timedFetch(audioUrl, AUDIO_TIMEOUT_MS);
  } catch {
    throw new UserError("AUDIO_DOWNLOAD_FAILED", "DictionaryAPI did not return the MP3 in time.", true);
  }
  if (!response.ok || !String(response.headers.get("content-type") || "").startsWith("audio/")) {
    throw new UserError("AUDIO_DOWNLOAD_FAILED", `DictionaryAPI did not return the MP3 (HTTP ${response.status}).`, true);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new UserError("AUDIO_TOO_LARGE", "MP3 must be between 1 byte and 5 MiB.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { filename: new URL(audioUrl).pathname.split("/").pop().replace(/[^A-Za-z0-9._-]/g, "_"), data: btoa(binary) };
}

async function storeMedia({ filename, data }) {
  await anki("storeMediaFile", { filename, data });
  return `[sound:${filename}]`;
}

async function anki(action, params) {
  const config = await settings();
  validateAnkiUrl(config.ankiUrl);
  const permission = await requestAnkiPermission(config);
  const response = await timedFetch(config.ankiUrl, 10_000, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: permission.version, params, ...(permission.requireApiKey ? { key: requiredApiKey(config) } : {}) }),
  });
  if (!response.ok) throw new UserError("ANKI_UNAVAILABLE", `AnkiConnect returned HTTP ${response.status}.`, true);
  const body = await response.json();
  if (body?.error) throw new UserError("ANKI_ERROR", String(body.error));
  return body?.result;
}

async function requestAnkiPermission(config) {
  validateAnkiUrl(config.ankiUrl);
  let response;
  try {
    response = await timedFetch(config.ankiUrl, 10_000, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "requestPermission", version: 6, params: { origin: chrome.runtime.getURL("") } }),
    });
  } catch {
    throw new UserError("ANKI_UNAVAILABLE", `Cannot reach AnkiConnect at ${config.ankiUrl}.`, true);
  }
  if (!response.ok) throw new UserError("ANKI_UNAVAILABLE", `AnkiConnect returned HTTP ${response.status}.`, true);
  const body = await response.json();
  if (body?.error) throw new UserError("ANKI_PERMISSION", String(body.error));
  const permission = body?.result;
  if (!permission || permission.permission !== "granted") throw new UserError("ANKI_PERMISSION", "Allow AnkiConnect access for this extension, then try again.");
  return { version: Number(permission.version) || 6, requireApiKey: permission.requireApiKey === true };
}

async function status() {
  try {
    const decks = await listDecks();
    return { ok: true, ankiConnected: true, deckCount: decks.length };
  } catch (error) {
    return { ok: false, ankiConnected: false, error: messageFor(error) };
  }
}

async function saveSettings(patch) {
  const current = await settings();
  const next = { ...current };
  if (typeof patch?.ankiUrl === "string") next.ankiUrl = patch.ankiUrl.trim();
  if (typeof patch?.ankiApiKey === "string") next.ankiApiKey = patch.ankiApiKey.trim();
  if (typeof patch?.targetLanguage === "string") next.targetLanguage = supportedLanguage(patch.targetLanguage);
  validateAnkiUrl(next.ankiUrl);
  await chrome.storage.local.set(next);
  return { ok: true };
}

async function uiSettings() {
  const config = await settings();
  return { ok: true, blockedSites: config.blockedSites, targetLanguage: config.targetLanguage };
}

async function blockSite(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) {
    throw new UserError("INVALID_SITE", "Cannot block this site.");
  }
  const config = await settings();
  const blockedSites = [...new Set([...config.blockedSites, host])];
  await chrome.storage.local.set({ blockedSites });
  return { ok: true, blockedSites };
}

async function settings() {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
}

async function askPage(tabId, message) {
  if (!tabId) return null;
  try { return await chrome.tabs.sendMessage(tabId, message); } catch { return null; }
}

async function notify(message) {
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
  await chrome.action.setTitle({ title: `Anki Add Vocabulary — ${message}` });
}

function validateDraft(raw) {
  const { term, kind } = selectedTerm(raw?.term, "Term");
  const audioUrl = isDictionaryAudio(raw?.audioUrl) ? String(raw.audioUrl) : "";
  const translation = boundedText(raw?.translation, 1000, "Translation");
  const deck = boundedText(raw?.deck, 100, "Anki deck");
  return {
    term, translation, deck, kind,
    targetLanguage: SUPPORTED_LANGUAGE_CODES.has(raw?.targetLanguage) ? raw.targetLanguage : "",
    pronunciation: optionalText(raw?.pronunciation, 100),
    type: requiredType(raw?.type, kind),
    meaning: optionalText(raw?.meaning, 500),
    pattern: optionalText(raw?.pattern, 300),
    example: optionalText(raw?.example, 800),
    context: optionalText(raw?.context, 1000),
    synonyms: textList(raw?.synonyms, 80),
    antonyms: textList(raw?.antonyms, 80),
    patterns: textList(raw?.patterns, 120),
    collocations: textList(raw?.collocations, 80),
    similar: textList(raw?.similar, 80),
    audioUrl,
    source: sanitizeSource(raw?.source),
  };
}

function sanitizeSource(value) {
  const title = optionalText(value?.title, 300);
  const url = optionalText(value?.url, 2000);
  if (!url) return title ? { title, url: "" } : null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return { title, url: parsed.href };
  } catch { return null; }
}

// Kind is always derived from the text; a kind supplied by the page is ignored.
function selectedTerm(value, label) {
  const classified = classifyTerm(value);
  if (!classified) throw new UserError("INVALID_INPUT", `${label} must contain a letter and be at most 500 characters.`);
  return classified;
}

function requiredType(value, kind) {
  const type = String(value || "").trim().toLowerCase();
  const allowed = kind === "word" ? WORD_TYPES : COLLOCATION_TYPES;
  if (!allowed.includes(type)) throw new UserError("INVALID_INPUT", kind === "word" ? "Choose a word type." : "Choose a collocation type.");
  return type;
}

function boundedText(value, maximum, label) {
  const text = String(value || "").trim();
  if (!text) throw new UserError("INVALID_INPUT", `${label} is required.`);
  if (text.length > maximum) throw new UserError("INVALID_INPUT", `${label} is too long.`);
  return text;
}

// Reviewed chip lists: at most 10 non-empty, length-bounded, case-insensitively unique entries.
function textList(value, maximum) {
  const items = Array.isArray(value) ? value : String(value || "").split(";");
  const seen = new Set();
  return items.map((item) => optionalText(item, maximum)).filter((item) => item && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase())).slice(0, 10);
}

function optionalText(value, maximum) { return String(value || "").trim().slice(0, maximum); }
function isSingleEnglishWord(value) { return /^[A-Za-z][A-Za-z'-]*$/.test(value.trim()); }

function supportedLanguage(value) {
  const code = String(value || "").trim();
  if (!SUPPORTED_LANGUAGE_CODES.has(code)) throw new UserError("UNSUPPORTED_LANGUAGE", "Choose a supported translation language.");
  return code;
}
function validateAnkiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new UserError("INVALID_ANKI_URL", "Enter an AnkiConnect loopback URL with an explicit port."); }
  const port = Number(url.port);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !Number.isInteger(port) || port < 1 || port > 65535 || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new UserError("INVALID_ANKI_URL", "AnkiConnect URL must use http://127.0.0.1 or http://localhost with an explicit local port.");
  }
}
function requiredApiKey(config) {
  if (!config.ankiApiKey) throw new UserError("ANKI_API_KEY_REQUIRED", "AnkiConnect requires an API key. Add it in Settings.");
  return config.ankiApiKey;
}
function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "<br>"); }
function escapeAttribute(value) { return escapeHtml(value).replace(/<br>/g, ""); }
function fail(code, message, retryable = false) { return { ok: false, error: { code, message, retryable } }; }
function messageFor(error) { return error instanceof UserError ? error.message : error?.name === "AbortError" ? "Request timed out." : "Unexpected request failure."; }
function timedFetch(url, timeout, options = {}) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout); return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer)); }
class UserError extends Error { constructor(code, message, retryable = false) { super(message); this.code = code; this.retryable = retryable; } }
