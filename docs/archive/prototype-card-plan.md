# Proposed next change — VocabBot card models and Anki audio

Status: **prototype only; do not apply until the UI/card design is approved.**

## What the prototype adopts from `vocab_bot/templates/`

### Word front

`VocabBot Word` fields:

```text
Word · Pronunciation · Audio · Category · Level · Context
```

The Anki front uses the original green/neutral visual system:

- large term;
- pronunciation;
- Anki replay control;
- category/level chips;
- source-sentence hint.

### Word back

```text
MeaningVN · Meaning · Example · Context · Source
Collocation · Patterns · Synonyms · Antonyms · RelatedWords · Paraphrase
```

The card back uses the VocabBot green meaning panel, source-context panel, and labelled sections. The prototype renders MeaningVN, English meaning, Example, Context, Collocations, Word patterns, and Synonyms.

### Collocation mapping

`VocabBot Collocation` fields:

```text
Collocation · Pattern · Meaning · Example · Synonyms · Context · Source · Audio
```

The collocation front/back retain the same VocabBot layout: term, audio, Pattern tag, Vietnamese meaning, example, context, and similar expressions.

## Audio contract

1. A single English word gets `audioUrl` from DictionaryAPI when it supplies an HTTPS MP3 under `api.dictionaryapi.dev`.
2. The edit screen shows the filename, **Play**, **Open MP3**, and **Download MP3** controls.
3. On final confirmation, the service worker downloads the selected/validated MP3 once, enforces audio content-type and a 5 MiB maximum, base64-encodes it, then invokes AnkiConnect:

```text
storeMediaFile(filename, data)
addNote(fields.Audio = [sound:filename])
```

4. For a collocation or an unavailable recording, the extension offers browser speech synthesis in the overlay and leaves Anki's `Audio` blank. The VocabBot template then uses its built-in Anki TTS fallback.
5. A manual MP3 link is optional. It must be an explicit HTTPS URL, displayed to the user before download, bounded by the same size/type validation, and never fetched until the final confirmation.

## Required implementation changes after approval

1. Add a note-model selection/setup screen that validates `VocabBot Word` and `VocabBot Collocation` field lists with `modelFieldNames`.
2. Do not modify a user-edited template automatically. If a model is absent, present a dedicated explicit `Install VocabBot models` action before calling `createModel` / `updateModelTemplates` / `updateModelStyling`.
3. Replace Basic `Front`/`Back` construction with fixed VocabBot field mapping for selected Word or Collocation.
4. Implement bounded download → `storeMediaFile` → `[sound:filename]` flow as above.
5. Test word with Dictionary MP3, collocation with Anki TTS fallback, invalid/manual MP3 URL, 5 MiB rejection, failed media upload, missing model, and final note field mapping.

## Non-negotiable behavior

- Translation, MP3 preview, card preview, deck choice, and deck creation do not mutate a note.
- The final `Add word/collocation to Anki` control is still the only note-creation boundary.
- If media upload fails, the user sees the failure before the note is added; no silent remote link is placed in the Anki field.
