# Anki Add Vocabulary — Product Specification

## Purpose

A clean-room Chrome MV3 extension for vocabulary captured while browsing. It does not import, call, share storage with, or reuse runtime code from `vocab_bot`.

## Required three-step flow

```text
Select English word or collocation
  → 1. automatically translate and show result
  → click Add to Anki
  → 2. preview and edit the card, including Pattern
  → 3. search/create an Anki deck and explicitly add the chosen word/collocation
```

No Anki mutation occurs during selection, translation, dictionary enrichment, card editing, deck search, or deck creation. The only note-writing transition is the final **Add word/collocation to Anki** control.

### Step 1 — Translate

A valid selection immediately opens an isolated Shadow DOM panel.

- Source: auto-detected by Google Translate. The result shows the detected source-language code.
- Target: user-selected; Vietnamese is the default. Supported target choices match the OpenQuiz-style picker: VI, EN, JA, KO, ZH, FR, DE, ES, TH, RU, PT, IT, AR, HI, ID, TR, PL, NL, SV, and MS.
- Translation: `translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=<target>&dt=t&q=<term>`.
- Single English word enrichment: `api.dictionaryapi.dev/api/v2/entries/en/<word>`, including pronunciation, example, synonyms, and its recorded MP3 when returned.
- Visible fields: detected source, target-language picker, term, translation, optional pronunciation/type, **Listen**, selected sentence context, Close, and **Add to Anki**.
- Listen plays the DictionaryAPI recording for a word; it falls back to local browser speech synthesis for a collocation or missing recording.
- Dictionary failure is non-fatal. Translation error never produces an add-ready card.
- The UI can block automatic translation on the current site.

### Step 2 — Preview and edit

Clicking **Add to Anki** opens exactly the editable review screen requested:

- Detected kind chip (read-only): one token is a Word, two or more tokens are a Collocation (no word limit; 500-character cap). The worker re-derives the kind from the reviewed Term; a kind sent by the page is ignored.
- Term.
- Vietnamese definition.
- Pronunciation.
- Type / collocation type.
- **Pattern**.
- Example.
- Semicolon-separated synonyms.
- Selected source sentence.
- Back and **Choose Anki deck**.

Required Term and Definition are validated before deck selection. Values shown in review are the exact values submitted later.

### Step 3 — Choose Anki deck and add

- Read actual deck names from local AnkiConnect.
- Search decks locally.
- Create a deck through AnkiConnect when no suitable deck exists.
- Choosing or creating a deck only changes the pending review state.
- The final button says **Add word to Anki** or **Add collocation to Anki**.
- Duplicate, schema, permission, and connectivity errors preserve the draft and never overwrite an existing note.

## Direct extension architecture

- `content.js`: selection/context extraction and the isolated three-step UI. It has no privileged credentials or arbitrary network capability.
- `background.js`: owns all fixed public API and AnkiConnect calls. It accepts only `translate`, `list-decks`, `create-deck`, `add-note`, `status`, and `save-settings` messages.
- `options.*`: configures and tests only local AnkiConnect URL, optional AnkiConnect API key, and note type.
- `popup.*`: displays AnkiConnect availability.

No local backend, LLM key, queue database, token file, provider model, Telegram integration, audio scraper, or old template is required.

## Anki contract

The default target is Anki's existing `Basic` note model in the selected deck.

- Front: reviewed Term.
- Back: escaped Translation, Pronunciation, Type, Pattern, Example, Synonyms, Context, and Source link.
- Tags: `anki-add-vocabulary` and `word` or `collocation`.

Before a final add, the worker requests AnkiConnect permission, validates the selected deck and the configured note type, uses `canAddNotes`, then calls `addNote`. It does not fall back to Anki's Default deck or overwrite duplicates.

## Privacy and known service limitations

- The extension sends only the selected word or phrase to Google Translate (GTX) and, for enrichment, Datamuse and Wiktionary. A single English word also reaches DictionaryAPI in the background. It does not send the page sentence, page HTML, cookies, page title, or source URL to those public endpoints.
- Google `client=gtx` is an undocumented public endpoint. The OpenQuiz reference extension uses it with Google-host fallbacks, but it may rate-limit or change. Translation failure is visible and cannot auto-add a card.
- Public endpoint responses and selected page text are untrusted. UI uses DOM text/value properties; Anki text is HTML-escaped.
- AnkiConnect URL is restricted to an explicit `http://127.0.0.1:<port>` or `http://localhost:<port>` address. The default is port 8765; a different local port is supported when another application occupies it. Optional AnkiConnect API key is kept in `chrome.storage.local` with trusted-context access restriction.
- Password fields, content-editable controls, empty selection, and selection above the size limit never trigger translation.
- Version one does not persist drafts or retry a final add after a timeout; the result is treated as unknown rather than risking a duplicate note.

## Explicit non-goals

- No OpenQuiz login, Firebase, remote vocabulary sets, or copied OpenQuiz code.
- No OpenQuiz auto-write when a set/deck is selected.
- No automatic Anki note creation, duplicate overwrite, or old `vocab_bot` dependency.
- No undocumented service guarantee beyond visible error handling for Google Translate GTX.
