# Implementation journal

What was built, what broke, and what was measured. Newest last. The plan, tasks, and decisions live in `Plans.md`.

### Task 5.1 findings (2026-09-14, details in `tests/fixtures/SOURCES.md`)

- **DictionaryAPI is slow uncached:** 19–20 s per new word; phrases return HTTP 522 HTML after ~20 s. The current 2 s timeout means Step 1 almost never gets dictionary data.
  - Proposed follow-up for 5.5: take POS candidates, per-POS Vietnamese meaning, synonyms, and definitions from GTX `dt=bd,ss,md,ex` (~200 ms).
  - Fetch DictionaryAPI in the background only for single words (MP3, IPA, antonyms) and update the edit screen when it arrives.
  - Never call it for multi-word terms.
- **Datamuse relations were swapped in section C** (now corrected): `rel_jja` = nouns after an adjective, `rel_jjb` = adjectives before a noun.
  - `rel_syn` / `rel_ant` are noisy or empty (resilient antonyms 0, depend synonyms 0).
  - `ml` is good for phrasal verbs and verb + noun, but returns game titles for `heavy rain`. The LLM is needed for adjective + noun.
- **Wiktionary** covers `give up` and `make a decision`, not `heavy rain` (404).
  - HTML includes `<style>` blocks and empty definitions.
  - Usage tags such as `[with on or upon]` are pattern hints.
- **OpenRouter:** 22 price-0 models, but the free filter must require:
  - an id ending in `:free` or equal to `openrouter/free`;
  - text-only output (drops Lyria music models);
  - no past `expiration_date`;
  - not a content-safety model.
  - `openrouter/free` exists and can be the last candidate.
- **Still open for 5.1:**
  - OpenRouter chat fixtures (success, JSON quality, invalid model, real 429) need `OPENROUTER_API_KEY` in the gitignored `.env`.
  - ~~Ollama / LM Studio fixtures~~ skipped by decision 2026-09-14. The provider presets stay in the design but are not fixture-verified.

### Task 5.2 evidence (2026-09-14)

- `term-kind.js` is shared by the content script (loaded before `content.js`) and the worker (`import "./term-kind.js"`). It:
  - normalises whitespace and edge punctuation;
  - classifies 1 token as a word and 2–10 tokens as a collocation;
  - rejects empty, letterless, over-120-character, or over-10-word terms.
- The worker derives `kind` for `translate` and again for `add-note` from the reviewed Term. A page-supplied `kind` is ignored.
- The `translate-collocation` context menu and Alt+S command are removed; one menu item and Alt+A remain.
- The edit screen shows a read-only chip (`Word · auto` / `Collocation · N words · auto`) that updates while Term is edited. An invalid Term blocks "Choose deck".
- `make test` (node:test): 10/10 pass. `tests/term-kind.test.mjs` covers the DoD terms; `tests/background-kind.test.mjs` stubs `chrome` and `fetch` to prove translate and add-note ignore a supplied kind and pick the note type from the term.
- Browser harness screenshots checked: word chip, collocation chip after editing Term, invalid chip, deck step "Add collocation to Anki".
- README, `spec.md` (Step 2 selector line), and the Options keyboard text are updated.

### Task 5.3 evidence (2026-09-15)

- **Vendored tagger (D1):** `vendor/compromise-two.mjs` (compromise 14.17.0, MIT, 295 KB). It is self-contained, runs only in the service worker, and has no `eval`, `new Function`, or network calls. Checksum and update procedure are in `vendor/README.md`.
- **compromise alone was not enough on the fixtures:** "Please light the candles" and "to light the oven" → adjective; "under the table" → adjective; "well-known" not found (split into two tokens). The `three` build gave the same results.
- **`word-type.js` adds three correction rules:**
  - A base form followed by its object, not after a determiner/adjective/possessive or "is/are", is a verb.
  - A closed-list preposition tagged adjective/adverb before an object is a preposition.
  - A multi-token hyphenated selection is an adjective if any part is, else the last part's type.
- **Choice order:** the sentence type if the dictionary agrees or has no candidates, else the first dictionary type, else blank. Detected types (sentence first, then dictionary) are listed first in the dropdown, marked "(detected)".
- **Dictionary candidates:** DictionaryAPI merged across all entries (`exclamation` → interjection, `article` → determiner). Task 5.5 adds GTX `bd`.
- **Worker:**
  - `translate` returns `type` and `typeDetected` for words; collocations stay blank.
  - `add-note` rejects a word without one of the 9 fixed types. Collocation type stays free text until 5.4.
- **Edit screen:**
  - A required Type `<select>` for words, red when empty; "Choose deck" shows "Choose a word type."
  - Editing Term from word to collocation swaps the control to free text (and back).
- **Tests:** `make test` 18/18 pass. `tests/word-type.test.mjs` covers the DoD `light` fixture sentences (noun/verb/adjective, with and without dictionary candidates), 14 extra context cases, blank-when-no-signal, and dictionary fallback. The worker tests cover detection and the required-type validation.
- **Browser harness:** screenshots checked for detected preselection, blank type blocking "Choose deck", and the collocation swap. Option order verified: `Choose type… | verb (detected) | noun (detected) | adjective | …`.

### Task 5.4 evidence (2026-09-15)

- **Shared helpers:** `word-type.js` now exports `tagTokens` (compromise tags plus base form via `compute("root")`), `findTerm`, and `letters`. The worker is the only importer.
- **`collocation-type.js`:**
  - **Token source:** tokens as tagged in the page sentence when the phrase is found there, otherwise the phrase tagged alone.
  - **Codes:** each token maps to V/P/R/O/N/A/D/X. Determiners, possessives, and object pronouns only shape the template.
  - **Rules:**
    - `V P…` → phrasal verb
    - `V R (N)` → verb + preposition
    - `V N (R|O)` → verb + noun
    - `V D` → verb + adverb
    - `D A|V` → adverb + adjective
    - `A N` → adjective + noun
    - `N O N` → noun + of + noun
    - `N N` → noun + noun
    - anything else → other
  - **Phrasal particles:** a fixed list (up/down/out/off/away/back/over/around/round/along/apart/aside/forward/together/through). compromise's own `PhrasalVerb` tag was inconsistent ("rely on" is a phrasal verb alone but a preposition in "They rely on him"). `on/in/for/to…` stay prepositions.
  - **Template:**
    - the leading verb in base form ("gave up" → "give up", "made a decision" → "make a/the + decision");
    - `a/an` → `a/the +`; `the` stays literal ("break the ice");
    - possessive → `one's`; him/her/me/us/them → `sb`; `it` → `sth`; reflexive → `oneself`;
    - a trailing preposition on verb types gets `sb/sth` ("take care of sb/sth", "run out of sb/sth").
  - **Idioms:** "idiom / fixed expression" is never produced by rules; it is left to Wiktionary/LLM (5.5/5.12).
- **Shared type list:** `COLLOCATION_TYPES` (10 fixed values) in `term-kind.js`.
- **Worker:**
  - `translate` returns collocation `type`, `typeDetected`, and `pattern`.
  - `add-note` requires a type from the list matching the derived kind.
- **Edit screen:**
  - Type is a required dropdown for collocations too.
  - For collocations, Pronunciation is hidden (the Collocation note type has no such field) and Type takes the full row.
  - Editing Term back to the original kind restores the detected type.
  - The "✓" marker replaces "(detected)", which was truncated in the half-width word column.
- **Not in 5.4:** the single-word pattern from the page sentence ("resilient in"). It belongs to the fallback suggestions merged in 5.12 and shown as chips in 5.6.
- **Tests:** `make test` 25/25 pass. `tests/collocation-type.test.mjs` covers the DoD (give up, make a decision, heavy rain, unmatched → other), one case per rule, inflected sentence forms, phrase-not-in-sentence, and type-list membership. The worker tests cover translate detection and required collocation type.
- **Browser harness:** screenshots checked for the detected collocation (full-width Type, template Pattern), swap to collocation (10 types listed), swap back to word (detected type restored), and the longest word type fitting.

### Task 5.5 evidence (2026-09-15)

- **`sources.js`:** pure parsers that never throw on untrusted JSON; output text is NFC-normalized (GTX returned decomposed Vietnamese).
  - `parseGtx` reads the positional `dt=t,bd,ss,md,ex` response. Synonym groups labelled archaic/rare/dated… are skipped.
  - `parseDictionary` merges all etymology entries by type.
  - `parseDatamuse` keeps only exact lowercase `n/v/adj/adv` tags; `N`, `prop`, `f:` are not POS. At most 20 items.
  - `parseWiktionary` reads `en` sections only, at most 10 definitions of at most 500 chars, and extracts usage prepositions such as `[with on or upon]`.
  - `htmlToText` drops `<style>`/`<script>` with content (including unterminated), removes tags, decodes entities once, and caps length.
  - `cleanSuggestion` allows letters, spaces, hyphens, and apostrophes only.
  - `fetchJson` rejects HTTP errors, bodies over 300,000 chars, and invalid JSON; 404 means "no entry".
- **`enrich.js`:**
  - **Requests:** Datamuse + Wiktionary + GTX in parallel, plus DictionaryAPI data if already cached. They share a 2.5 s AbortController deadline; per-source status is `ok | error | timeout | skipped`.
  - **Word merge:**
    - synonyms: GTX → DictionaryAPI → Datamuse
    - antonyms: DictionaryAPI → Datamuse
    - patterns: Wiktionary usage → Datamuse `rel_bga` prepositions scoring ≥ 20% of the strongest
    - collocations by type: adjective `rel_jja`, noun `rel_jjb`, verb noun followers; function words and determiners excluded
    - definitions: GTX → Wiktionary
  - **Datamuse POS filter:** uses the **primary (first) tag**. With "any tag", `heavy` became an antonym of the verb `light`.
  - **Collocation merge:** Datamuse `ml` similar expressions only for verb-type collocations (unusable for `heavy rain`), Wiktionary definitions, and an "idiom / fixed expression" hint from Idiom/Phrase/Proverb sections.
  - **Cache:** `chrome.storage.session` for 30 minutes, keyed by kind + type + term. Only complete results (no error/timeout) are cached.
- **Worker:**
  - **Step 1 (`translate`):** one GTX request with `dt=t,bd,ss,md,ex`. GTX types are the dictionary candidates for word-type detection; the draft gets the English meaning and example for the detected type, up to 5 synonyms, and `meaningsByType`. The parsed GTX data is cached for enrich. DictionaryAPI is no longer called.
  - **`dictionary` action:** single English words only; phrases are rejected with no request. 25 s timeout, in-flight dedupe, session cache.
  - **`add-note`:** takes the MP3 from the cached dictionary result, with no blocking lookup.
  - **`enrich` action:** validates `termType` against the derived kind and sends only the term.
  - **Manifest:** adds `https://api.datamuse.com/*` and `https://en.wiktionary.org/*`.
- **Content:** after Step 1 renders, a word triggers `dictionary`. When it answers (same request, not closed):
  - pronunciation fills if empty, the MP3 is attached, and dictionary types are merged into `typeDetected`;
  - the translate screen re-renders; on the edit screen the pronunciation input, the ✓ marks in the Type dropdown (current choice kept), and the audio card update in place.
  - Enrichment display is Task 5.6.
- **Fixture quality check** (printed merged output, not only assertions):
  - `resilient` patterns `to, in`; `happy` `to, in, with`; `depend` `on, upon`;
  - `decision` collocations `final/important/right…`; `light` (adjective) collocations `light source/brown/years`;
  - `give up` similar `part with, relinquish, resign, surrender, quit`.
  - Remaining weak spots: `light` (verb) patterns `light of/on` come from POS-agnostic `rel_bga`; Datamuse `rel_syn` is sense-mixed (`resilient` → spirited, bouncy). The LLM (5.12) is expected to rank above these.
- **Tests:** `make test` 44/44 pass.
  - `tests/sources.test.mjs`: fixtures, malformed bodies, `<script>`/entity/unterminated cases.
  - `tests/enrich.test.mjs`: merge and filter, primary-POS and threshold rules, failing source, slow source (150 ms budget with a 5 s response returns under 1 s), oversized and malformed rejected, only fixed HTTPS hosts and no sentence or page URL in requests, the Wikimedia header, 30-minute cache and no caching of partial results, GTX cache reuse.
  - Worker tests: one GTX request and no DictionaryAPI in `translate`, the dictionary action and its cache, phrase rejection, add-note audio from cache, enrich type validation, manifest hosts.
- **Browser harness:** before the dictionary answers the edit screen shows blank pronunciation, "No recording", `✓ verb`; after, `/laɪt/`, `light-uk.mp3`, `✓ verb | ✓ noun`.
- **Docs:** README and `spec.md` privacy text list GTX, DictionaryAPI (background), Datamuse, and Wiktionary, and state that the page sentence is never sent.

### Task 5.6 evidence — non-AI part (2026-09-15; AI loading state, "Try another model", and quota/key errors wait for 5.12)

- **`suggestions.js`** (content-script global, node-tested) holds immutable chip groups: word → patterns/collocations/synonyms/antonyms; collocation → similar expressions.
  - **Defaults while a group is untouched:** sentence pattern and Step 1 GTX synonyms ticked; top 5 synonyms and top 3 collocations; antonyms from DictionaryAPI only; data patterns and similar expressions unticked.
  - **When more data arrives:** a group you already touched keeps exactly your choices.
  - **Custom items:** validated (≤ 80 chars, a letter, no `<>{}\`), deduplicated case-insensitively (re-ticks the existing item), dashed border.
  - **Size:** at most 12 items per group.
  - **Type or committed Term change:** keeps only explicitly ticked or custom items plus the type-independent sentence pattern; untouched groups take new defaults. An explicit untick is forgotten for the new type.
- **Sentence pattern:** `word-type.js` `contextPattern` takes the word plus the following preposition from the page sentence ("resilient in", "depend on"); gerund → "interested in doing sth"; `to` + infinitive → "happy to do sth". `translate` returns it as `contextPattern` for words.
- **Edit screen:**
  - Chip groups replace the Synonyms text field and the word Pattern field. Collocations keep the single Pattern template input.
  - **States:** "Loading…", "N selected", "No suggestions", "Choose a type first" (word without type), plus a footer for unavailable sources (e.g. "Unavailable: Wiktionary (timeout)").
  - **Requests:** `enrich` runs on screen open, on Type change, and on committed Term change (blur). Answers for an older term/type are ignored. Going back from the deck step restores chips without refetching.
  - **Dictionary arrival:** antonyms merge into the Antonyms group.
- **Snapshot and fields:**
  - `readReview` writes the ticked chips into `patterns`, `collocations`, `synonyms`, `antonyms`, `similar`.
  - Worker `textList` bounds each list (≤ 10, length-capped, case-insensitive unique).
  - Note fields: Word `Patterns`, `Collocation`, `Synonyms`, `Antonyms`; Collocation `Synonyms` ← similar expressions.
  - The Word back template still does not render Antonyms (Task 5.7).
  - The card preview shows Collocations, Word patterns, and Synonyms/Similar expressions.
- **Deviation from DoD wording:** "changing type re-filters from cache" is implemented as a new `enrich` call per type. The worker session cache serves repeats; a first visit to a new type makes new Datamuse `rel_jja`/`rel_jjb` requests, because those relations differ by type.
- **Tests:** `make test` 55/55 pass. They cover `tests/suggestions.test.mjs` (defaults, touched groups, custom validation/dedupe, type reset, limits, immutability), `contextPattern` cases, worker `contextPattern`, enrich making zero Anki calls, chip lists written to note fields, and list bounding.
- **Browser harness (stubbed extension API):**
  - loading state; loaded chips with defaults and an unavailable-source footer;
  - end-to-end snapshot: after ticking "resilient to", unticking "robust" and "resilient people", adding "weak" and "ELASTIC", the submitted draft was exactly `patterns [resilient in, resilient to]`, `collocations [resilient material, resilient system]`, `synonyms [adaptable, elastic, bouncy, springy]`, `antonyms [brittle, weak]`;
  - card back lists; type change with no JS errors (loading shows only the sentence pattern and the custom item).

### Task 5.7 evidence (2026-09-15)

- **Templates (`models.js`):** the Word back template v2 adds `{{#Antonyms}}…{{/Antonyms}}` after Synonyms, using the existing list styling (no CSS change). v1 is kept in `modelSpecs.word.previous`. The collocation template is unchanged (D2: no collocation antonyms).
- **`templateStatus(spec, modelTemplates)`:** ignores whitespace.
  - `current`: matches the current template;
  - `outdated`: matches a known previous version;
  - `customized`: anything else;
  - `unsupported`: not exactly one card type (any card name accepted, e.g. "Card 1").
- **Worker:**
  - `model-status` and `upgrade-models` are accepted only from `chrome-extension://<id>/options.html` without a tab; content scripts get `OPTIONS_ONLY`. The URL is compared as protocol+host+path, because `URL.origin` is `"null"` for non-special schemes in Node.
  - `model-status` also reports `missing` and `missing-fields`.
  - `upgrade-models` calls `updateModelTemplates` only for outdated models, and for customized ones only with `confirmCustomized: true` (otherwise `CONFIRMATION_REQUIRED`). Unsupported or missing-fields models fail with `UPGRADE_UNSUPPORTED`. It never calls `updateModelStyling`, `createModel`, or `modelFieldAdd`.
  - `add-note` never modifies an existing model; a missing model is still created with the current template. When a word has antonyms, it reads `modelTemplates` and returns `antonymsHidden` if the template is not current.
- **Field mapping (5.6 + 5.7):** Word `Category` = type, `Patterns`, `Collocation`, `Synonyms`, `Antonyms` from the reviewed chips; Collocation `Pattern` template, `Synonyms` ← similar expressions.
- **UI:**
  - **Options:** a new "Note types" section (check → per-model state and hint → "Upgrade card templates"; customized requires a `confirm()` dialog).
  - **Options cleanup:** removed the stale `Basic` note-type input and text (and the dead `ankiModel` setting in the worker); updated the lede and privacy text.
  - **Card preview:** an Antonyms row.
  - **After Add:** the success notice explains when antonyms are saved but hidden by an older template.
- **Tests:** `make test` 59/59 pass. `tests/models.test.mjs` covers the template section and all statuses. Worker tests cover options-only rejection, outdated → one `updateModelTemplates`, customized refused without confirmation then allowed, unsupported refused, no styling/create/field calls, add-note never changing an existing model, `antonymsHidden` true/false, no template read without antonyms, and a missing model created with the current template.
- **Browser checks (stubbed extension API):** Options rendered with "Customized template" and "Not created yet" hints and the Upgrade button, then after upgrade "Up to date" and "Upgraded: VocabBot Word." The card back shows Antonyms `brittle, weak`; the front shows the hidden-antonyms notice.
  - The Options scratch copy loaded `options.js` as a classic script over `file://` (module scripts are blocked on `file://`; a loopback HTTP server was blocked by the sandbox).
- **Not verified:** a live AnkiConnect `updateModelTemplates` against real Anki.

### Bug fix — wrong Example / empty Pronunciation on dictionary pages (2026-09-15, user report)

- **Symptom:** selecting the headword on a dictionary page (Cambridge-style markup) filled Example with `renowned adjective /rɪˈnaʊnd/ /rɪˈnaʊnd/` and left Pronunciation empty.
- **Root cause:** the old `sentenceAround` in `content.js`:
  - took the nearest block's `innerText` and cut only at ". ", so a heading with no period became the whole "sentence" (up to 500 chars);
  - returned the block's first 500 chars when the term was not found;
  - used the first occurrence of the word, not the selected one.
  - The worker then used that text as Example, and the content script also copied the dictionary example into Context when no sentence existed.
- **Fix:** new `page-context.js` (content-script global, node-tested) with `extractContext(text, term, offset)`.
  - Sentences are split with `Intl.Segmenter` (regex fallback) and common abbreviations (Dr., e.g., …) are merged; the segment containing the **selection offset** is used.
  - IPA transcriptions (`/…/` or `[…]` containing IPA-only characters) are removed from the sentence and returned as the pronunciation when within 120 chars of the selection.
  - A sentence is rejected with fewer than 3 words (punctuated) or 4 (fragment), without the term, or as a run over 300 chars with no sentence ending; long real sentences are trimmed around the term with "…".
- **Content script:**
  - The nearest block (p/li/dd/…/div) text with the offset from a DOM Range is used; blocks over 4000 chars are windowed.
  - If that block has no IPA, up to 3 short ancestors (≤ 1000 chars) are searched, because dictionary sites put the IPA in sibling elements.
  - `context` is now only a real page sentence (no dictionary-example fallback). Page IPA prefills Pronunciation, and DictionaryAPI still fills it only if empty.
  - The manifest loads `page-context.js` before `content.js`.
- **Tests:** `make test` 67/67 pass. `tests/page-context.test.mjs` covers the reported headword line (plain and UK/US spaced), first/later sentence, selected vs first occurrence, IPA inside a sentence, fragments/menus/missing term, non-IPA slashes and brackets, distant IPA ignored, trimming, and abbreviations.
- **Browser harness** (Cambridge-like headword + POS + UK/US IPA + examples):
  - headword selection → Pronunciation `/rɪˈnaʊnd/`, Example falls back to the dictionary example "a renowned author";
  - selection inside the example paragraph → Example is that sentence;
  - news-page harness unchanged ("The company proved resilient in the downturn.").
- **Not verified:** live on cambridge.org or other real dictionary sites (their markup may differ).

### Card template v3, US pronunciation, Vietnamese glosses (2026-09-15, user request with reference screenshots)

- **Templates (`models.js`)**, Word and Collocation, with new CSS:
  - **Front:** centered white card; word, `US: {{Pronunciation}}`, replay (DictionaryAPI MP3 or Anki TTS fallback), part-of-speech (or Pattern) pill. The context hint is no longer on the front.
  - **Back:** `{{#Level}}` yellow badge, word, italic US pronunciation, gradient divider, replay, `.meaning-vn` blue box, English meaning, an "Example usage" box with blue left border and Source, a "Gặp khi đọc" box with `{{^Example}}` source fallback, Word patterns, Collocations, Paraphrase.
  - **Minor group:** a dashed-top `.minor` group (Synonyms, Antonyms, Related words; similar expressions for collocations) with no whitespace inside, so `.minor:empty` hides it.
  - **Mobile:** `@media (max-width:480px)` scales down.
  - **Versions:** v1 (front/back/css) and v2 (antonyms back) are kept as `previous`.
- **Status and upgrade:** status now compares styling too (`modelStyling`); explicit upgrade calls `updateModelTemplates` **and** `updateModelStyling`. `antonymsHidden` now checks whether the card Back contains `{{Antonyms}}`, so v2 is not flagged.
- **US pronunciation:**
  - `parseDictionary` prefers `-us.mp3` audio and its `/…/` text, then text not tied to UK/AU audio, then the entry phonetic; narrow `[…]` forms are skipped.
  - `page-context.js` prefers a transcription labelled "US".
  - The edit label reads "US pronunciation".
- **Glosses:** `withGlosses` in `add-note` runs one GTX `dt=t` request for patterns, collocations, synonyms, antonyms, similar expressions, and the example, joined by newlines (live probe 2026-09-15: 9 lines in, 9 aligned lines out).
  - **Skipped** when the target is English or unsupported, when an item already ends in `(…)`, or beyond a 1,800-char budget.
  - **On failure** (timeout 6 s, HTTP error, or line-count mismatch) the note stays unglossed and the add is never blocked.
  - **Quality:** single words translate out of context ("driven" → "điều khiển"). Type framing ("be X", "X person", "(adjective) X") was probed and rejected because it added artifacts. The LLM (5.12) is the planned improvement.
- **Context:** the Context field is written only when it differs from Example (ignoring a trailing gloss), so the Example usage box does not repeat.
- **Preview:** `renderTemplate` (sections innermost-first, inverted sections, fields, `{{tts}}`/`[sound:]` → replay button). `add-note` returns `note` (glossed lists) and `preview` {front, back, css}. The content script shows the real template in a nested closed shadow root scaled to 0.58, with links opening in a new tab and replay using the page voice/MP3. The old hand-built preview and its CSS were removed.
- **Tests:** `make test` 72/72 pass. They cover v3 structure and order, styling-aware status, v1/v2 outdated, US preference (DictionaryAPI and page), upgrade applying styling, glosses (single request, alignment, skip rules, English target, failure, mismatch), Context dedupe, renderer behaviour, and the preview in the add response.
- **Visual check:** the real templates rendered with the `ambitious` data from the user's screenshots (front 1066 px, back 560 px, collocation back, sparse variant) match the reference layout. The extension panel front/back preview was checked in the harness.
- **Not verified:** live Anki desktop/mobile rendering (the replay button styling depends on Anki's own CSS), and the upgrade against the user's existing (likely customized) VocabBot note type.

### Bug fix — Antonyms missing on added cards (2026-09-15, user report)

- **Cause:** `suggestions.js` ticked antonyms by default only when they came from DictionaryAPI. DictionaryAPI is usually slow or unavailable (it failed again in the live check), so Datamuse antonyms appeared as unticked chips, were not submitted, and the card's Antonyms section stayed hidden.
- **Fix:** antonyms now tick the top 3 from any source, like synonyms (top 5) and collocations (top 3). A group the user touched still keeps only the user's choices.
- **Live check (2026-09-15, real Datamuse/Wiktionary/GTX through `enrich` + default ticks):**
  - `ambitious` → antonyms `unambitious, ambitionless`, collocations `ambitious man/project/men`;
  - `decision` → antonyms `indecision, indecisiveness`, collocations `final/important/right decision`;
  - `quickly` → antonyms `tardily, slowly`, no collocations (adverb);
  - `achieve` → collocation `achieve success`, no antonyms;
  - `renowned` and `resilient` → no antonyms in any free source.
- **Collocations:** data was present and default-ticked for adjectives and nouns; the report about missing collocations needs the exact word and screen (edit screen vs Anki card before or after template upgrade) to reproduce.
- **Tests:** `make test` 73/73 pass. The updated default test and a new Datamuse-only antonyms test failed before the fix.

### Bug fix — preview differed from the card in Anki (2026-09-15, user report)

- **Diagnosis:** read-only AnkiConnect inspection of the user's collection.
  - `VocabBot Word` status `outdated`: unmodified v1 template and CSS (no `meaning-vn`, no `US:`, no `{{Antonyms}}`). `VocabBot Collocation` not created yet.
  - The latest note (`author`) had correct fields: MeaningVN, Meaning, glossed Example, glossed Synonyms, glossed Collocation, Source.
  - **Cause:** `add-note` rendered the preview with the v3 spec, while Anki renders notes with the note type's own template, which Add never changes.
  - **Second finding:** Pronunciation `/ˈɔːθə(r)/` was British; Oxford Learner's labels transcriptions `BrE`/`NAmE`, not `UK`/`US`.
- **Fix:**
  - `add-note` now reads `modelTemplates` + `modelStyling` after adding and renders the preview from them; it uses the spec only if the note type has more than one card or no styling. It returns `templateStatus`, and `antonymsHidden` is decided from the actual card Back.
  - The card screen says "This is how Anki shows it: your note type still uses an older card design…" and shows an "Open Settings → Note types" button (new `open-options` message → `chrome.runtime.openOptionsPage()`). Upgrading still happens only from Settings.
  - `page-context.js` treats `NAmE`/`AmE` as US labels (24-char look-back; a UK/BrE label in between blocks the match).
- **Tests:** `make test` 76/76 pass. Added: the preview uses v1 template/CSS when Anki has v1 (`templateStatus` outdated), the preview equals the current template when upgraded, open-options, and Oxford BrE/NAmE plain and spaced.
- **Harness:** the card back renders the v1 design with the user's `author` fields, the upgrade notice, and the Settings button.
- **Pending user action:** upgrade `VocabBot Word` from Settings. It is `outdated` (unmodified v1), so no confirmation dialog is needed and existing notes switch design immediately.

### User's Anki upgraded to template v3; example gloss truncation and slang synonyms (2026-09-15, user report)

- **Why the user saw the old design:** the `VocabBot Word` note type in the user's Anki was still v1. Add never modifies a note type, and the preview (since the previous fix) mirrors the real note type.
- **Upgrade, performed at the user's request through AnkiConnect:**
  - status `outdated` (unmodified v1) was confirmed first;
  - the previous templates and CSS were backed up to `/private/tmp/claude-501/-Users-foden-Documents-workspace-fd-anki-extension/c6bca204-8867-434c-910d-191103679b2a/scratchpad/vocabbot-word-backup-1789486882636.json` (session scratchpad);
  - `updateModelTemplates` + `updateModelStyling` were applied → status `current`.
  - `cardsInfo` for the latest note (`colleagues`) returned Anki-rendered HTML containing `US: `, `meaning-vn`, and the `minor` group; the screenshot shows the v3 design with the user's real fields.
  - `VocabBot Collocation` does not exist yet; it will be created with v3 on the first collocation add.
- **Issues visible on that real card, now fixed:**
  - The example translation was cut mid-word at 200 characters ("…xác định có b)"). Glosses are no longer truncated; a gloss over 1200 characters is dropped instead.
  - The GTX synonyms "oppo", "offsider" came from senses labelled British/Australian informal; the filter skipped only archaic/rare/dated. GTX senses labelled informal, slang, humorous, dialect, British, Australian, North American, Scottish, Irish, or US are now skipped too.
- **Existing notes** keep their stored fields: `colleagues` still has the truncated gloss and slang synonyms until edited or re-added.
- **Still open:** the stored pronunciation `/ˈkɒliːgz/` is British. The page (DOL English) had no US/NAmE label, and DictionaryAPI's US data did not arrive, so US preference could not apply.
- **Tests:** `make test` 78/78 pass, including a regional/informal synonym filter test and a long-example gloss test (both failed before the fix).

### Template v3.1 — typography matched to the reference at 2x (2026-09-15, user report "ý tôi là template này")

- **Cause of the mismatch:** the reference screenshots (1066×532 front, 1034×1940 back) are 2× device-pixel images, but v3 sizes were taken as 1×, so v3 was about 25–35% larger (word 44px vs about 34px, meaning box 30px vs about 25px, labels 13px vs 11px) with looser spacing.
- **Checked source:** `../vocab_bot/templates` holds the older green design (the same as extension v1), not the reference, so v3 remains a re-creation.
- **Method:** rendered v3 with the reference's `ambitious` data at `--force-device-scale-factor=2` in 533- and 517-px windows (identical pixel sizes to the screenshots), measured element positions against the reference, adjusted, and re-rendered three times.
  - Final offsets are within about 4–6 px (2× pixels) per section on both sides.
- **v3.1** (CSS only; markup unchanged):
  - **Type sizes:** word 34px (front 32px); US pronunciation 17px italic on the back, 21px on the front; meaning box 25px/700; labels 11px; English meaning 16.5px; example and lists 17px; minor lists 14.5px.
  - **Level badge:** 11px.
  - **Spacing:** tightened section, example, and divider spacing.
  - **Version list:** v3 CSS added to `previous` for Word and Collocation.
- **User's Anki:** upgraded again from v3 (`outdated`) to v3.1 (`current`), with a backup in the session scratchpad. `cardsInfo` renders the new design for the latest note.
- **Tests:** `make test` 79/79 pass. Added a typography test for the measured sizes, a check that v3.1 changes styling only, and the version counts.

### Bug fix — Add failed with "Request timed out." (2026-09-15, user report)

- **Trace** (live, from this machine, timing each network step of `add-note`):
  - AnkiConnect `requestPermission`, `version`, `deckNames`, `modelNames`, `modelFieldNames`, `modelTemplates`, `modelStyling`: 20–52 ms each;
  - GTX gloss request: 1.35 s;
  - **DictionaryAPI MP3** (`colleague`, `ambitious`, `renowned`, `author` `-us.mp3`): **19.7–20.1 s, then HTTP 522 HTML**.
- **Cause:** `add-note` downloaded the MP3 inline with a 10 s `timedFetch`. The abort was not caught, so the whole Add failed with the generic "Request timed out." although Anki was responsive.
- **Fix:**
  - New `prepare-audio` action: DictionaryAPI URL validated, 30 s timeout, audio content-type and 5 MiB checks, base64 cached in the session under `audio:<url>`, in-flight dedupe; errors → `AUDIO_DOWNLOAD_FAILED`.
  - The content script starts it as soon as the dictionary result supplies `audioUrl`; the audio card shows loading, ready, or failed.
  - `add-note` only uses a prepared MP3 (`storeMediaFile`). It never downloads; otherwise it adds without audio and returns `audioSkipped`, shown in the success notice.
  - This replaces the earlier "media failure is shown before the note is added" rule: the failure is visible on the edit screen before Add, and the add is no longer blocked.
- **Tests:** `make test` 81/81 pass.
  - A hanging-media add test reproduced the bug (failed at 10,003 ms) and now passes in under 1 s with Audio empty and no media request.
  - `prepare-audio` is tested for URL validation, 522 failure, shared single download, and use at Add.
  - The dictionary flow now prepares before adding.
- **Harness:** audio card states verified (downloading / ready / unavailable) and the added-without-MP3 notice.
- **Not verified:** a live Add into the user's Anki (not run, to avoid creating a note without the user's go-ahead).

### Word patterns with objects; card review screens removed (2026-09-18, user request)

- **Patterns now name what follows** (`formatPattern` in `term-kind.js`, shared by the sentence and data paths):
  - from the page sentence: "resilient in sb/sth", "depend on sb/sth", "happy to do sth" (to + infinitive), "interested in doing sth" (gerund), "sure that + clause";
  - from Datamuse/Wiktionary, where no object is visible: "depend on sb/sth", "decision to sb/sth", and "that + clause".
  - `sources.js` gained `cleanPattern`, which allows `/` and `+` (placeholders) while synonym lists keep the stricter rule that drops items such as "put/set a match to".
  - "that" is still subject to the 20%-of-top-preposition threshold, so it rarely appears (14% for `decision`).
- **Add no longer opens the two card review screens.** `Add word/collocation to Anki` now:
  - shows a compact confirmation ("✓ Added "term" to deck") that closes itself after 2.5 s when there is nothing to report;
  - keeps the panel open with Done only when there are notices: MP3 not ready, or the note type still uses an older/customized design (with the "Open Settings → Note types" button).
- **Removed:** the front/back preview screens in `content.js`, their scaled shadow-root frame, the `preview` payload from `add-note`, and `renderTemplate` in `models.js` (now unused) with its test. `add-note` still reports `templateStatus` and `antonymsHidden` for the notices.
- **Tests:** `make test` 81/81 pass (83 before removing the two preview tests). Pattern expectations updated across word-type, enrich, and worker tests; a new `cleanPattern` test documents the placeholder rule.
- **Harness:** confirmation auto-closes (panel gone after 4 s) and the notice variant stays with both buttons.

### Performance review and repo cleanup (2026-09-18, user request)

- **Measured:** worker cold start 66–71 ms (the vendored compromise tagger dominates), first tag call 16 ms then under 1 ms; content scripts 57 KB per page; AnkiConnect 20–52 ms per call; GTX 1.3 s; DictionaryAPI ~20 s and its media ~20 s before failing.
- **Optimised:**
  - **DictionaryAPI and MP3 failures are cached** per term/URL, so a word that hangs once is not retried on every later selection. A test that looked up the same failing word twice took 50 s before the fix.
  - **Session cache pruning:** `createCache` now drops expired entries and the oldest overflow (200 entries) on every write, so a long session cannot fill `chrome.storage.session` (MP3s are cached there as base64).
  - The compromise import stays static: dynamic import is unreliable in MV3 service workers, and 70 ms per cold start is small next to the network calls.
- **Dead code removed:** `dictionaryWordTypes` (superseded by `parseDictionary().types`), `renderTemplate` (card preview removed earlier), and the exports `WORD_MODEL`, `COLLOCATION_MODEL`, `normalizeWordType`, `MAX_RESPONSE_CHARS`, `gtxUrl`, `ENRICH_BUDGET_MS`, `CACHE_TTL_MS`, which were only used inside their own modules.
- **Repo:** prototypes and the unused selection fixture moved to `docs/archive/`; the 15 evidence entries moved from `Plans.md` (574 → 256 lines) into this journal; `ARCHITECTURE.md` updated to the current message list, flow, sources, field mapping, note-type upgrade, and audio pipeline; README gained a development and file-map section; `make test` and `make fixtures` targets; `.gitignore` covers `out/` and logs.
- **Tests:** `make test` 83/83 pass (two new performance tests: failure caching and cache pruning).
