# Anki Add Vocabulary

A standalone Chrome MV3 extension for turning text selected on a web page into an Anki vocabulary card.

## What it does

1. Select a word or collocation on a normal HTTP(S) web page.
2. The extension detects the source language and translates it to the selected target language.
3. Review and edit the card. Word cards can include pronunciation, pattern, example, synonyms, and an MP3 recording.
4. Search the Anki deck tree or create a new deck.
5. Click the final **Add word to Anki** or **Add collocation to Anki** button. The note is added immediately; a short confirmation closes itself, and stays only when something needs attention (MP3 not ready, or an older note type).

Nothing is written to Anki before the final add button.

## Requirements

- Google Chrome or Chromium with Developer mode enabled.
- Anki Desktop running.
- [AnkiConnect](https://ankiweb.net/shared/info/2055492159) installed in Anki.
- AnkiConnect available on a loopback URL, normally `http://127.0.0.1:8765`.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `anki-extension/` directory.
5. Open **Details → Extension options**.
6. Enter the local AnkiConnect URL and optional AnkiConnect API key.
7. Click **Test Anki connection**.
8. When AnkiConnect asks for permission, allow only this extension origin.

Disable the previous `Vocab → Anki` extension before enabling this one. Otherwise both extensions can react to the same selection.

## Usage

### Step 1 — Translate

Select text. The compact overlay automatically detects its source language.

- Choose a target language from the target selector.
- For a single English word, DictionaryAPI can supply pronunciation, type, synonyms, example, and an MP3 recording.
- Use **Listen** to preview pronunciation.
- Click **Add to Anki** to open the editable review.

The selected source sentence is intentionally not shown in this compact first step. It is preserved for the review and final Anki card.

### Step 2 — Preview and edit

The kind is detected from the term: one word is a **Word**, two or more words are a **Collocation** (no word limit; selections over 500 characters are ignored). A chip shows the detected kind and updates while you edit Term. Review:

- Term
- Translation
- Pronunciation
- Type or collocation type
- Pattern
- Example
- Synonyms
- Source sentence

For a word with a DictionaryAPI recording, the audio card shows the filename and offers **Play**, **Open**, and **Download**. On final add, the extension stores that file in Anki media and writes `[sound:filename.mp3]` to the card.

### Step 3 — Choose an Anki deck

- Search existing decks.
- Expand parent decks and select a child deck.
- Create a new deck when needed.
- Deck selection and deck creation do not create a note.

The final add button is the only note-creation action.

## Anki card models

The extension creates these models only when they do not already exist:

- `VocabBot Word`
- `VocabBot Collocation`

Template v3 (2026-09-15) uses a centered white card:
- **Front:** word, `US: /IPA/`, replay button, part-of-speech pill.
- **Back:**
  - level badge (when Level is filled), US pronunciation, and the Vietnamese meaning in a blue box;
  - English meaning, and an Example usage box with its source;
  - "Gặp khi đọc", only when the page sentence differs from the example;
  - word patterns, collocations;
  - a lighter group for synonyms, antonyms, and related words, hidden when empty.
- The Collocation card uses the same design (Pattern pill, similar expressions).

When the target language is not English, the final Add appends a translation in parentheses to each reviewed pattern, collocation, synonym, antonym, similar expression, and the example, using one Google Translate request. Items are translated out of context, so single words can get the wrong sense. If the request fails, the note is added without translations.

Pronunciation prefers US: the DictionaryAPI US recording and transcription, and a transcription labelled "US" on dictionary pages.

### Word fields

```text
Word, Pronunciation, Category, Level, MeaningVN, Meaning, Example,
Patterns, Synonyms, Antonyms, RelatedWords, Paraphrase, Collocation,
Context, Source, Audio
```

### Collocation fields

```text
Collocation, Pattern, Meaning, Example, Synonyms, Context, Source, Audio
```

Existing VocabBot models are validated before use. Adding a note never changes an existing model: no template, styling, or field changes.

Settings → **Note types** → **Check note types** reports each model as up to date, not created yet, older template, customized template, cannot upgrade (not exactly one card type), or missing fields.
- **Upgrade card templates** replaces the card template and styling of an older model (v1, v2 → v3).
- A customized template or styling is replaced only after a confirmation dialog. Notes and fields are kept.
- If you add antonyms while your Word template is older, the note stores them and the success message tells you the card will not show them until you upgrade.

## Audio behavior

- **Word:** use the validated DictionaryAPI MP3 when available.
  - The MP3 downloads in the background as soon as DictionaryAPI provides it (30 s limit, 5 MiB max). The edit screen shows "Downloading MP3…", "MP3 ready", or "MP3 unavailable".
  - Add never waits for it. A ready MP3 is uploaded with AnkiConnect `storeMediaFile` and attached. Otherwise the note is added without audio (the card uses Anki TTS) and the success message says so.
  - DictionaryAPI media hung ~20 s and returned HTTP 522 in the 2026-09-15 trace, which previously made Add fail with "Request timed out."
- **Collocation or unavailable recording:** the overlay uses browser speech synthesis. The Anki template falls back to Anki TTS when its `Audio` field is empty.
- If audio download or media upload fails, the add operation reports the failure instead of silently creating a card without the requested audio.

## Privacy

The extension sends only the selected word or phrase (never the page sentence) to public services:

- `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dt=bd&dt=ss&dt=md&dt=ex…`: translation, word types, synonyms, definitions (Step 1).
- `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`: pronunciation, MP3, antonyms, for a single English word only. It runs in the background after Step 1 because uncached lookups can take ~20 s.
- `https://api.datamuse.com/words`: synonyms, antonyms, collocations, pattern hints, similar phrases (edit screen enrichment).
- `https://en.wiktionary.org/api/rest_v1/page/definition/<term>`: definitions and phrase entries (edit screen enrichment).

It does not send page HTML, cookies, page title, or source URL to those services. The Google `client=gtx` endpoint is undocumented and may rate-limit or change.

## Keyboard shortcuts

- `Alt+A` — translate the current selection (word or collocation is detected automatically).

## Development

```bash
make check      # syntax check every script and the manifest
make test       # node:test suite (no dependencies)
make fixtures   # re-record the API fixtures in tests/fixtures (network)
make prototype  # serve docs/archive on http://127.0.0.1:4173
```

| Path | What it is |
|---|---|
| `manifest.json`, `background.js` | MV3 worker: messages, translation, enrichment, AnkiConnect |
| `content.js` + `term-kind.js`, `suggestions.js`, `page-context.js` | page overlay and the logic shared with the worker |
| `word-type.js`, `collocation-type.js`, `sources.js`, `enrich.js`, `models.js` | detection, API parsers, suggestion merge, Anki note types |
| `options.*`, `popup.*` | settings and status pages |
| `vendor/` | vendored compromise tagger (MIT), see `vendor/README.md` |
| `tests/`, `tests/fixtures/` | node tests and recorded API responses (`SOURCES.md` documents them) |
| `Plans.md`, `docs/journal.md`, `ARCHITECTURE.md`, `spec.md` | plan and decisions, implementation journal, architecture, product spec |
| `docs/archive/` | superseded prototypes, kept for reference |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries, trust boundaries, API calls, Anki model installation, and the final add sequence.
