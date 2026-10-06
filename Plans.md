# Anki Add Vocabulary — Plans

Created: 2026-09-13

## Planning validation

- **team_validation_mode:** subagent
- **Reference evidence:** the installed OpenQuiz extension uses `TRANSLATE_SELECTION` in its content script, delegates translation/dictionary work to the MV3 worker, renders a translation result, then opens Preview & Edit and a searchable vocabulary-set chooser. Its service-worker bundle calls `translate.googleapis.com/translate_a/single?client=gtx`, falls back to another Google endpoint and MyMemory, and calls `api.dictionaryapi.dev` only for a single English word.
- **Adopted behavior:** select → automatic translation → explicit Add to Anki → editable preview with Pattern → search/create Anki deck → final explicit add.
- **Deliberate difference:** OpenQuiz writes when a set row is chosen. This extension must never write to Anki before the final Add control.
- **Architecture decision:** clean-room direct MV3 extension. No `vocab_bot` import, local backend, database, token file, template, or background worker dependency.
- **Translation decision:** use the user-specified Google GTX endpoint and DictionaryAPI directly in the extension worker. GTX is undocumented and must have visible error handling; it is not a guaranteed production service.
- **Anki decision:** local AnkiConnect only, using the selected existing deck and `Basic` note type in version one.
- **Spec delta:** `spec.md` records this exact three-step contract.
- **Tool baseline:** no package dependency is necessary. JavaScript syntax checks, manifest validation, browser smoke, endpoint checks, and AnkiConnect manual smoke are mandatory.

---

## Stage 1 — Isolated extension shell

| Task | Content | DoD | Depends | Status |
|---|---|---|---|---|
| 1.1 | [lane:gate] Create clean-room MV3 manifest, worker, content-script, options, popup, local-only settings, and deterministic no-dependency check commands. [tdd:required] | Unpacked extension contains no path, import, runtime call, storage key, or source dependency on `vocab_bot`; syntax and manifest checks pass. | - | cc:WIP |
| 1.2 | [lane:gate] Implement strict message schemas and fixed outbound endpoint/AnkiConnect URL validation. [tdd:required] | Content cannot choose arbitrary worker actions, URLs, request headers, or Anki actions; invalid input fails closed. | 1.1 | cc:TODO |

## Stage 2 — Translate-before-review

| Task | Content | DoD | Depends | Status |
|---|---|---|---|---|
| 2.1 | [lane:gate] Implement automatic selection capture, sensitive-control exclusion, selection generation handling, and isolated anchored loading/result overlay. [tdd:required] | One valid selection causes exactly one translation; rapid reselection/close ignores stale responses; empty, oversized, password, contenteditable, and blocked-site selections make no network call. | 1.2 | cc:TODO |
| 2.2 | [lane:gate] Implement Google GTX translation with Google-host fallback and user-visible categorized failure. [tdd:required] | `How` translates to `Làm sao` in a live endpoint check; HTTP/rate-limit/network/malformed result stays non-addable and exposes no raw response or credentials. | 2.1 | cc:TODO |
| 2.3 | [lane:gate] Implement optional DictionaryAPI enrichment for a single English word. [tdd:required] | Valid dictionary response supplies only available pronunciation/type/example/synonyms; no dictionary response never prevents a translated result. | 2.2 | cc:TODO |

## Stage 3 — Review, deck selection, and Anki write

| Task | Content | DoD | Depends | Status |
|---|---|---|---|---|
| 3.1 | [lane:gate] Implement exact Preview & Edit screen with Word/Collocation, Term, Definition, Pronunciation, Type, Pattern, Example, Synonyms, Context, Back, and Choose Anki deck. [tdd:required] | Edited values become the pending snapshot; blank Term/Definition blocks progress; cancel/Escape/outside dismissal causes zero Anki calls. | 2.3 | cc:TODO |
| 3.2 | [lane:gate] Implement AnkiConnect permission/API-key status, deck search, deck creation, and model/deck validation. [tdd:required] | Existing decks list/search; Create deck returns and selects a deck; deck selection/creation performs no add; missing Anki/permission/key/model/deck is actionable. | 1.2 | cc:TODO |
| 3.3 | [lane:gate] Implement final Add word/collocation action using a reviewed Basic-note snapshot, escaped fields, `canAddNotes`, and `addNote`. [tdd:required] | Final button is the only add mutation; one click creates one note; duplicate is non-destructive; timeout is result-unknown with no blind retry. | 3.1, 3.2 | cc:TODO |

## Stage 4 — Acceptance and cutover

| Task | Content | DoD | Depends | Status |
|---|---|---|---|---|
| 4.1 | [lane:gate] Run browser acceptance over Word and Collocation: translate, edit Pattern, search/create deck, add, duplicate, close/cancel, blocked-site, restricted page, and Anki unavailable paths. [tdd:skip:end-to-end acceptance] | Evidence shows expected UI state and proves no Anki mutation before final Add for every non-success path. | 3.3 | cc:TODO |
| 4.2 | [lane:gate] Review direct public endpoint privacy, worker message boundary, trusted storage access level, Anki HTML escaping, origin permission, and duplicate/result-unknown handling. [tdd:skip:security review] | No critical/major finding remains; risks of unsupported GTX are documented in Options and README. | 4.1 | cc:TODO |
| 4.3 | [lane:release] Document unpacked install, AnkiConnect origin approval, Basic-note behavior, optional API key, public endpoint privacy, and legacy-extension cutover. [tdd:skip:documentation] | Fresh Chrome profile can install the standalone extension without `vocab_bot`; old extension is unloaded before use to prevent double selection flows. | 4.2 | cc:TODO |

## Stage 5 — Auto-detected word/collocation, type, patterns, synonyms, antonyms

Goal: remove the manual Word/Collocation toggle. The extension derives the kind from the selection, proposes a type, and suggests patterns, collocations, synonyms (từ đồng nghĩa), and antonyms (từ trái nghĩa). The user reviews the suggestions before the final add.

### Data sources (decided 2026-09-14)

| Need | Source | Cost / limit | Used at |
|---|---|---|---|
| Meaning, IPA, audio, example, POS candidates | DictionaryAPI.dev | Free | Step 1 (already called) |
| Synonyms / antonyms | Datamuse `rel_syn`, `rel_ant` (+ DictionaryAPI lists) | Free, 100,000 requests/day, no key | Enrich |
| Collocations | **LLM (configurable provider)**; Datamuse `rel_bga`, `rel_bgb`, `rel_jja`, `rel_jjb` as fallback | Free models / local / Datamuse 100,000/day | Enrich |
| Multi-word phrase meaning / similar phrases | Datamuse `ml` + Wiktionary | Free | Enrich |
| Word pattern | **LLM (configurable provider)**; local sentence analysis as fallback | Free models / local | Enrich |
| Fast POS / meaning-per-POS / synonyms / definitions | Google GTX `dt=bd,ss,md,ex` (decided 2026-09-14 after 5.1 latency findings); DictionaryAPI only in the background for single-word MP3/IPA/antonyms | Free, unofficial | Step 1 + Enrich |
| English → Vietnamese | Google GTX (unofficial); self-hosted LibreTranslate is decision D6 | Free, may rate-limit or change | Step 1 |
| Advanced definitions / phrase entries | Wiktionary REST `page/definition/<term>` | Free | Enrich |

### Design

**A. Classification (no toggle)**
- 1 token → **Word**. Hyphenated or apostrophe words count as one token (`well-known`, `don't`).
- 2+ tokens → **Collocation** (no word limit since 2026-09-15, D4).
- The worker derives the kind from the text. Any `kind` sent by the content script is ignored.
- The `translate-collocation` context menu and Alt+S command are removed. Supersedes the selector in Task 3.1.

**B. Type (required dropdown)**
- Word types: noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, interjection.
- Collocation types: adjective + noun, verb + noun, noun + noun, adverb + adjective, verb + adverb, verb + preposition, phrasal verb, noun + of + noun, idiom / fixed expression, other.
- Word type detection:
  1. Tag the selected sentence locally to get the part of speech in context (for example, `light` is a noun in "turn on the light" and a verb in "light a candle").
  2. Get the candidate parts of speech from DictionaryAPI `meanings[].partOfSpeech`.
  3. Choose the context POS if it is a candidate. Otherwise use the first dictionary POS, then the context POS alone. If nothing is found, leave it blank; the user must choose.
  4. Detected types are listed first, marked "✓" (was "(detected)"; shortened so it fits the 320 px panel).
- Collocation type detection: tag each token in the sentence, then map the tag sequence to a rule. Examples: ADJ NOUN → adjective + noun; VERB (DET) NOUN → verb + noun; VERB + particle (up/down/out/off/on/in/away/back/over) → phrasal verb; ADV ADJ → adverb + adjective; anything else → other.

**C. Patterns and collocations** — LLM first (section I); everything below is the fallback when AI is off, fails, or times out
- Word pattern from the page sentence: the word plus the following preposition, `to` + verb, or -ing form. Verbs are lemmatised and objects generalised to `sb/sth` (for example "resilient in", "depend on sb/sth", "interested in doing sth").
- No dictionary API gives reliable patterns, so the page sentence is the primary source. Datamuse `rel_bga` (frequent followers, filtered to prepositions, `to`, `that`) and prepositions in DictionaryAPI / Wiktionary examples are shown only as unticked hints.
- Word → Collocation field, chosen by type (corrected by the 5.1 fixtures):
  - adjective: `rel_jja` (nouns that follow it, e.g. "light source", "resilient material");
  - noun: `rel_jjb` (adjectives before it, e.g. "final decision") and `rel_bgb` (frequent predecessors);
  - verb: `rel_bga` filtered to nouns.
- Collocation → Pattern field: a generalised template such as "make a decision" → "make a/the + decision" or "take care of sb/sth".
- The pattern found in the page sentence is pre-ticked. Data suggestions start unticked (top 3 collocations pre-ticked).

**D. Synonyms (từ đồng nghĩa)**
- Word: DictionaryAPI synonyms for the chosen POS, plus Datamuse `rel_syn&md=p` filtered to the same POS. Deduplicate and keep dictionary results first. The top 5 are pre-ticked.
- Changing the type re-filters cached results without a new request.
- Collocation: Datamuse `ml=<phrase>` (means-like), plus the same structure with a synonym swapped in for the head word. All start unticked because quality is lower.

**H. Phrase and advanced definitions (Wiktionary)**
- Called for multi-word terms, and for single words when DictionaryAPI has no entry or no definition.
- Endpoint: `https://en.wiktionary.org/api/rest_v1/page/definition/<term>`, spaces → `_`; only the `en` language section is read.
- A Wiktionary POS such as "Phrasal verb" or "Idiom" overrides the tag-sequence collocation type.
- Definitions come back as HTML. The service worker has no `DOMParser`, so tags are stripped with a bounded parser, entities decoded, the text length-capped, and the result treated as plain text (HTML-escaped again for Anki).
- Requests send an `Api-User-Agent` header identifying the extension, as Wikimedia asks.
- Word: the definition fills `Meaning` when DictionaryAPI has none. Collocation: the model has no English-meaning field (see D2).

**I. AI suggestions for patterns and collocations (decided 2026-09-14)**

*Providers (Options → "AI suggestions", off by default)*

All providers use the OpenAI-compatible `POST <baseUrl>/chat/completions` format.

| Provider | Default base URL | Key | Model list |
|---|---|---|---|
| Off | — | — | Datamuse / local fallback only |
| OpenRouter | `https://openrouter.ai/api/v1` | Required | "Auto: free models" or a user-ordered list |
| Ollama (local) | `http://localhost:11434/v1` | None | `GET /v1/models` |
| LM Studio (local) | `http://localhost:1234/v1` | None | `GET /v1/models` |
| Custom OpenAI-compatible | User-entered | Optional | User-ordered list |

- URL rules:
  - Local providers: loopback only, explicit port (same validation as AnkiConnect).
  - Custom: HTTPS only. Its origin is granted through `optional_host_permissions` plus `chrome.permissions.request` when the user saves; there is no blanket host permission.
- Manifest adds `https://openrouter.ai/*`. Loopback is already covered.
- Ollama may reject extension origins; Options shows the `OLLAMA_ORIGINS=chrome-extension://<id>` hint. LM Studio needs CORS enabled.
- The API key lives in `chrome.storage.local` (trusted contexts only). It is used only in the service worker and never sent to the content script.
- "Test connection" and "Load models" run only when requested from the Options page (sender URL checked).

*Free-model discovery and rotation (OpenRouter)*

- "Auto: free models" builds the candidate list from `GET /api/v1/models`:
  - keep models whose prompt and completion price are both `0` (usually `:free` ids);
  - prefer models whose `supported_parameters` include `response_format` or `structured_outputs`;
  - require context of at least 8k.
  - The list is cached for 24 h. The user can pin a preferred order and exclude models.
- Documented free limits (checked 2026-09-14): 20 requests/min, 50/day without purchased credits, 1,000/day with at least 10 credits. A limit returns HTTP 429 with `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.
- Per request, try candidates in order:
  - **429:** cool the model down until `X-RateLimit-Reset` (default 60 s), then try the next one.
  - **Account quota:** if two different free models return 429 with remaining `0` and a reset more than 10 minutes away, treat it as the account-wide daily quota. Stop rotating, show "Free AI quota reached, resets at HH:MM", and use the fallback. (The docs do not say whether the daily cap is shared across free models.)
  - **5xx, timeout, 404 / model unavailable:** next model. A 404 removes the model from the cache.
  - **Invalid JSON or schema failure:** next model; no second try on the same model.
  - **401 / 402 / 403:** stop immediately and show a key or credit error; do not rotate.
  - **Budget:** at most 3 models and 15 s total per suggestion. The edit screen shows "Asking <model>…" and a "Try another model" button.
- Local and custom providers use the same loop over the user's ordered list. Cooldowns only apply to 429.
- Whether OpenRouter's server-side model fallback can replace part of this loop is checked in 5.1. The client loop stays as the source of truth.

*Prompt and output contract*

- Input:
  - term, derived kind, detected or chosen type;
  - page sentence (at most 500 chars; never the URL or title);
  - target language, used only for the language of the explanation;
  - `temperature` 0.2, `max_tokens` about 500;
  - `response_format` JSON when the model supports it.
- Word output:

  ```json
  {"inContextPattern":"resilient in sth","patterns":[{"text":"resilient to sth","example":"…"}],"collocations":[{"text":"resilient economy","example":"…"}]}
  ```

- Collocation output:

  ```json
  {"collocationType":"verb + noun","pattern":"make a/the + decision","similar":[{"text":"reach a decision"}]}
  ```

- Validation, in the worker, before the UI sees anything:
  - strict JSON (fenced JSON is also accepted);
  - at most 5 items per list, 120 chars per text, 200 per example;
  - each pattern or collocation must contain the term or its lemma;
  - `collocationType` must be one of the fixed type list, otherwise `other`.
- The page sentence is untrusted (prompt-injection risk). Model output is data only: rendered with `textContent`, ticked by the user before it enters the snapshot, and HTML-escaped for Anki.
- Cache per (term, sentence hash, type, provider) in `chrome.storage.session` for 30 minutes.
- Privacy: enabling AI requires ticking "Send the selected text and its sentence to <provider>". README and Options state which provider receives what.

**E. Antonyms (từ trái nghĩa)**
- Word: DictionaryAPI antonyms for the chosen POS plus Datamuse `rel_ant`, filtered by POS. Often empty; the card section is then hidden.
- The current `VocabBot Word` back template has an `Antonyms` field but does not render it. An Antonyms section is required.
- `VocabBot Collocation` has no `Antonyms` field (open decision D2).

**F. Data flow, privacy, performance**
- Step 1 stays fast: GTX plus DictionaryAPI only.
- Enrichment starts only when **Add to Anki** is clicked. A new fixed worker action, `enrich`, runs Datamuse and Wiktionary requests in parallel with a 2.5 s total budget (about 4–6 Datamuse requests per term, far below 100,000/day).
- Each source failure is non-fatal. Results are cached per term for 30 minutes.
- POS tagging and pattern extraction run locally. Datamuse and Wiktionary receive only the selected word or phrase, never the page sentence or URL.
- Manifest adds `https://api.datamuse.com/*` and `https://en.wiktionary.org/*`.
- Datamuse responses are schema-checked: arrays of `{word, score, tags}`, bounded lengths, letters/space/hyphen/apostrophe only, at most 20 items.
- Wiktionary responses are checked the same way: at most 10 definitions, each at most 500 characters.
- A non-English source language skips English enrichment; the type dropdown stays manual.

**G. Edit screen**
- Read-only chip replaces the toggle: `Word · auto` or `Collocation · 3 words`.
- Type dropdown is required.
- Pattern, Collocations, Synonyms, and Antonyms are tickable chip lists with a "+ add" input. They show a loading state, then "No suggestions" if empty.
- Anki mapping:
  - Word: `Category` = type, `Patterns`, `Collocation`, `Synonyms`, `Antonyms`.
  - Collocation: `Pattern` = type + template, `Synonyms`.

### Open decisions

- **D1** Accepted 2026-09-14: vendor the `compromise` library (MIT, packaged in the extension, no remote code) for offline POS in context and the fallback pattern.
- **D2** Accepted 2026-09-14: skip collocation `Antonyms` and English meaning in v1. A later upgrade must be an explicit "Upgrade VocabBot note types" action (`modelFieldAdd` + `updateModelTemplates`), never automatic.
- **D3** ~~Approve Datamuse~~ — decided 2026-09-14: Datamuse and Wiktionary adopted (see Data sources). Live responses still unverified; this session's sandbox blocked outbound calls.
- **D5** Decided 2026-09-14: word patterns and collocations use a configurable LLM (OpenRouter free models with rotation, Ollama, LM Studio, custom OpenAI-compatible), off by default, with local and Datamuse fallback (section I). Requires the `spec.md` change in Task 5.9.
- **D6** Accepted 2026-09-14: keep GTX as default. Self-hosted LibreTranslate conflicts with the "no local backend" rule; it could later be an optional user-configured loopback/HTTPS endpoint under the same URL validation as AnkiConnect.
- **D4** Decided 2026-09-14: 2–10 words. **Changed 2026-09-15 (user):** no word limit, any selection with more than one word is a collocation. `MAX_TERM_WORDS` removed; only a 500-character safety cap remains (was 120) for the translation request URL and accidental whole-article selections. Translation bounds raised from 500 to 1000 characters.

### Tasks

| Task | Content | DoD | Depends | Status |
|---|---|---|---|---|
| 5.1 | [lane:gate] Probe live Datamuse (`rel_syn`, `rel_ant`, `rel_bga`, `rel_bgb`, `rel_jja`, `rel_jjb`, `ml`, `md=p`), DictionaryAPI, and Wiktionary REST for fixture terms; save the responses as test fixtures. [tdd:skip:research] | `tests/fixtures/` covers light, resilient, happy, depend, decision, give up, make a decision, heavy rain; response shapes and rate limits documented; D1, D2, D4, D5, D6 decided. | - | cc:WIP |
| 5.2 | [lane:gate] Derive kind from token count; remove Word/Collocation toggle, collocation context menu, and Alt+S; worker ignores content-supplied kind. [tdd:required] | Unit tests: `resilient`, `well-known`, `don't` → word; `give up`, `make a decision` → collocation; whitespace normalised. | 5.1 | cc:done |
| 5.3 | [lane:gate] Local POS tagging of the page sentence and required word-type dropdown with dictionary candidates. [tdd:required] | `light` → noun / verb / adjective in the three fixture sentences; no signal → blank dropdown blocks "Choose deck". | 5.2 | cc:done |
| 5.4 | [lane:gate] Collocation type rules and pattern templates. [tdd:required] | give up → phrasal verb; make a decision → verb + noun, "make a/the + decision"; heavy rain → adjective + noun; unmatched → other. | 5.3 | cc:done |
| 5.5 | [lane:gate] Step 1 uses GTX `dt=t,bd,ss,md,ex` (defensive positional parser, fixture-tested) for type candidates and meaning per type; DictionaryAPI moves to a background single-word fetch (MP3, IPA, antonyms), never for phrases. Worker `enrich` action: Datamuse + DictionaryAPI + Wiktionary + GTX merge, POS filter, dedupe, ranking, Wiktionary HTML-to-text, validation, 2.5 s budget, 30-min cache; add host permissions. [tdd:required] | Fixture tests for merge/filter and HTML stripping (including `<script>`/entity cases); a failing or slow source still returns the others; oversized or malformed responses rejected; only the term is sent. | 5.1 | cc:done |
| 5.6 | [lane:gate] Edit screen: auto kind chip, type dropdown, tickable chips + add input for Pattern / Collocations / Synonyms / Antonyms; AI loading state ("Asking <model>…"), "Try another model", quota/key errors, fallback label; changing type re-filters from cache. [tdd:required] | Ticked chips become the exact submitted snapshot; enrichment and AI make zero Anki calls; AI failure still shows fallback suggestions; harness screenshots match the compact prototype style. | 5.3, 5.4, 5.5, 5.12 | cc:WIP |
| 5.7 | [lane:gate] Field mapping for Category / Patterns / Collocation / Synonyms / Antonyms; Word back template gains Antonyms section; model upgrade follows D2. [tdd:required] | Note fields match the snapshot; existing user models are never changed without the explicit upgrade action; card preview renders the same sections. | 5.6 | cc:done |
| 5.8 | [lane:gate] Browser acceptance: word with multiple POS, word with antonyms, word missing from DictionaryAPI (Wiktionary fallback), phrasal verb, verb + noun collocation, non-English source, Datamuse and Wiktionary offline; AI off, OpenRouter free model, forced 429 rotation, daily quota, invalid key, Ollama local, malformed model JSON. [tdd:skip:end-to-end acceptance] | Evidence for each path; no Anki mutation before final Add; API key never appears in content script, page, or logs. | 5.7, 5.11 | cc:TODO |
| 5.9 | [lane:gate] Update `spec.md` and README: optional AI provider (off by default), what is sent to which provider, free-quota behaviour, local model setup (`OLLAMA_ORIGINS`, LM Studio CORS). [tdd:skip:documentation] | Spec no longer contradicts D5; privacy section lists Datamuse, Wiktionary, and every AI provider. | - | cc:TODO |
| 5.10 | [lane:gate] Worker provider layer: OpenAI-compatible client, provider presets, URL validation, optional host permission for custom HTTPS, OpenRouter free-model discovery (24 h cache), rotation with 429 cooldown via `X-RateLimit-Reset`, daily-quota detection, 3-model / 15 s budget. [tdd:required] | Fixture tests with a fake fetch: 429 → next model; two 429s with remaining 0 and a far reset → quota stop; 401/402 → stop without rotation; 5xx/timeout/404 → next model; key never leaves the worker. | 5.1, 5.9 | cc:TODO |
| 5.11 | [lane:gate] Options "AI suggestions": provider select, base URL, API key, Auto free models vs ordered list, exclude models, Load models, Test connection, privacy consent tick. [tdd:required] | Consent unticked → no AI request; Test and Load accepted only from the Options page; custom origin permission requested only on save. | 5.10 | cc:TODO |
| 5.12 | [lane:gate] `ai-suggest` action: prompt builder, JSON / fenced-JSON parsing, schema validation (limits, term/lemma containment, fixed type list), 30-min session cache, merge with Datamuse / local fallback. [tdd:required] | Fixture tests: valid word and collocation outputs; injection text in sentence yields only validated data; hallucinated item without the term dropped; invalid JSON → next model; all models fail → fallback suggestions labelled. | 5.10 | cc:TODO |

## Implementation journal

Task evidence, bug-fix traces, and measurements moved to [`docs/journal.md`](docs/journal.md).

## Current implementation evidence

- `prototype.html` implements interactive representations of all three candidate flows; the user-selected contract is now represented by Variant A plus the requested deck/create step.
- `background.js` implements fixed Google GTX, DictionaryAPI, and narrow AnkiConnect actions.
- `content.js` implements the requested three screen states and final explicit add gate.
- Live browser check: Google GTX returned `Làm sao` for `How` with HTTP 200.
- Language picker and audio: source is auto-detected; the result supports the requested 20 target languages; DictionaryAPI MP3 is preferred for a word and browser speech synthesis is the collocation/missing-audio fallback.
- Live DictionaryAPI check: `resilient` supplies `https://api.dictionaryapi.dev/media/pronunciations/en/resilient-us.mp3`.
- DictionaryAPI response for `how` contains phonetic, meanings, type, definitions, examples, and synonyms.

## Pre-approval

- Item: Send selected text to `translate.googleapis.com`, `translate.google.com`, and optional DictionaryAPI during translation testing.
  Reason: Required to validate user-selected direct translation and enrichment behavior.
  scope: Stage 2 / Tasks 2.2, 2.3
- Item: Send loopback requests to the configured AnkiConnect port for permission, deck list/create, duplicate preflight, and final note add.
  Reason: Required to verify the three-step Anki workflow.
  scope: Stages 3–4 / Tasks 3.2, 3.3, 4.1
- Item: Disable/unload the legacy `Vocab → Anki` extension during cutover smoke testing.
  Reason: Prevent duplicate selection triggers or accidental duplicate adds.
  scope: Stage 4 / Task 4.3
- Item: Send the selected word or phrase (never the page sentence or URL) to `api.datamuse.com` and `en.wiktionary.org` for synonym, antonym, collocation, phrase, and definition suggestions.
  Reason: Data sources decided 2026-09-14; live verification needs outbound network approval (the probe was blocked in the sandbox).
  scope: Stage 5 / Tasks 5.1, 5.5, 5.8
- Item: With a user-supplied key, send the selected term, type, and page sentence (never URL or title) to OpenRouter free models, and to a local Ollama / LM Studio instance.
  Reason: Verify AI pattern/collocation suggestions, free-model rotation, and quota handling.
  scope: Stage 5 / Tasks 5.1, 5.10, 5.12, 5.8
