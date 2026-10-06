# Stage 5 data-source fixtures (Task 5.1)

Recorded 2026-09-14 by `node tests/fixtures/probe.mjs`. Each JSON file stores `request` (keys redacted), `status`, rate-limit `headers`, `elapsedMs`, `fetchedAt`, and `body` (or `error`).

```sh
node tests/fixtures/probe.mjs                     # everything public
node tests/fixtures/probe.mjs datamuse wiktionary # only named sources: dictionaryapi datamuse wiktionary gtx openrouter local
PROBE_TIMEOUT_MS=45000 node tests/fixtures/probe.mjs dictionaryapi
node --env-file-if-exists=.env tests/fixtures/probe.mjs openrouter  # OPENROUTER_API_KEY in gitignored .env enables chat fixtures
```

Terms: light (noun/verb/adjective), resilient, happy, depend, decision, give up, make a decision, heavy rain, resilience.

## DictionaryAPI — `api.dictionaryapi.dev/api/v2/entries/en/<term>`

- Shape: `[{ word, phonetic?, phonetics: [{ text?, audio? }], meanings: [{ partOfSpeech, definitions: [{ definition, example?, synonyms, antonyms }], synonyms, antonyms }] }]`.
  - One array entry per etymology, so a POS can repeat: `light` has 5 entries, with noun/verb/adjective each appearing 2–3 times.
  - Merge by `partOfSpeech` before use.
- **Latency is the main finding.**
  - Uncached terms took **19.4–20.0 s** (light, resilient, happy, depend, both recording runs).
  - A recently requested term returned in 92–372 ms (`decision`).
  - The extension's current `DICTIONARY_TIMEOUT_MS = 2_000` therefore almost always misses: no pronunciation, type, synonyms, or MP3.
- Phrases (`give up`, `make a decision`, `heavy rain`) returned **HTTP 522** after ~20 s: a Cloudflare origin timeout with an HTML body, not the documented JSON 404. The worker must treat non-JSON / 5xx as "no entry" and must not call DictionaryAPI for multi-word terms.
- Data quality:
  - `light`: all POS, MP3 (`light-uk.mp3`, `light-us.mp3`), `/lʌɪt/`. Verb antonyms `extinguish, put out`; adjective synonyms `delicate, gentle, soft`, antonyms `heavy, strong`.
  - `resilient`: adjective, `resilient-us.mp3`, **no phonetic text**. Synonyms `bendable, flexible, strong`; antonyms `brittle, fragile`.
  - `happy`: adjective synonyms `cheerful, content, delighted…`. Antonyms are noisy (`inappropriate, inapt, unfelicitous…` come from the "appropriate" sense).
  - `depend`: verb, 4 definitions, 3 examples, no synonyms or antonyms.
  - `decision`: noun + verb, 3 examples, no synonyms or antonyms.
- Synonyms and antonyms appear at both meaning and definition level; collect both.

## Datamuse — `api.datamuse.com/words`

- Shape: `[{ word, score, tags? }]`. With `md=p`, tags hold POS `n | v | adj | adv | prop | N`; `md=f` adds `f:<per-million>`. `ml` results may carry `syn` and `results_type:primary_rel_multi`.
- Latency 280–650 ms. No rate-limit headers (documented limit: 100,000 requests/day, no key).
- `sp=<word>&md=pf&max=1` gives a POS candidate list, ordered by corpus usage: `light → n, adj, v, adv`; `depend → v`.
- **Correction to plan section C:**
  - `rel_jja` returns **nouns following an adjective**: `light → source, brown, years, weight`; `resilient → children, material, people, system`.
  - `rel_jjb` returns **adjectives before a noun**: `decision → final, important, right, difficult`; `light → new, red, white, dim`.
  - So adjective → `rel_jja`, noun → `rel_jjb`.
- `rel_syn` mixes all senses (WordNet) and is often empty:
  - `light`: frivolous, clear, bright, livid…
  - `resilient`: spirited, elastic, bouncy…
  - `depend`: 0; `decision`: 3.
  - It needs a POS filter plus ranking below dictionary synonyms.
- `rel_ant` is sparse: `light` 5, `happy` 4 (sad, unhappy…), `decision` 2, `resilient` 0, `depend` 0.
- `rel_bga` (followers) contains punctuation (`.`), function words, and nouns. Filtered to prepositions it gives usable pattern hints:
  - `depend → on, upon, for`
  - `happy → to, with, about, that`
  - `resilient → to, in, than`
- `rel_bgb` (predecessors) is dominated by determiners and auxiliaries; only a few content words help (`decision → final`).
- `ml=<phrase>`:
  - good for phrasal verbs and verb + noun: `give up → part with, relinquish, quit, abandon`; `make a decision → decide, make up one's mind, choose, settle on`;
  - **unusable for adjective + noun**: `heavy rain` returns video-game titles.
  - Phrase suggestions therefore need the LLM, with `ml` only for verb-type collocations.

## Wiktionary — `en.wiktionary.org/api/rest_v1/page/definition/<term_with_underscores>`

- Shape: `{ <lang>: [{ partOfSpeech, language, definitions: [{ definition, parsedExamples?, examples? }] }] }`. Only the `en` key is used. A POS can repeat across etymologies (`light` has two Adjective sections).
- Latency 50–830 ms. Missing entry → HTTP 404 `{"status":404,"type":"Internal error"}` (`heavy rain`).
- Entries exist for `give up` (Verb, 11 definitions) and `make a decision` (Verb: "To decide.").
- `definition` is Parsoid HTML and needs careful cleanup:
  - Some definitions are empty strings (`light` Noun #1, #3). Skip them.
  - `<style>` blocks leak CSS text (`.mw-parser-output .object-usage-tag{…}`). Drop `<style>` elements **with their content** before removing tags.
  - Wiki links, `<span about=…>`, and `<i>` markup. Decode entities after stripping.
- Usage tags are pattern hints: `depend` → `[with on or upon]`.
- `parsedExamples[].example` holds examples with `<b>` around the term.

## Google GTX — `translate.googleapis.com/translate_a/single?client=gtx&dt=t&dt=bd&dt=ss&dt=at&dt=md&dt=ex`

Undocumented; positional arrays; latency 80–220 ms.

| Index | `dt` | Content (`light`) |
|---|---|---|
| 0 | t | `[["ánh sáng","light",…]]` |
| 1 | bd | POS-grouped Vietnamese: `adjective → nhẹ, sáng sủa…`, `adverb …`, `noun …`, `verb …` |
| 2 | — | detected source `en` |
| 5 | at | alternative translations (`ánh sáng, soi rọi, đèn`) |
| 11 | ss | English synonyms grouped by POS and sense |
| 12 | md | English definitions per POS with an example |
| 13 | ex | example sentences with `<b>` around the term |

- `give up` returns `bd` only for `verb` (`từ chối`), with no `ss`/`md`/`ex`.
- **Finding:** GTX `bd` + `ss` + `md` provide POS candidates, a Vietnamese meaning per POS, synonyms, and definitions in ~200 ms. That makes GTX a fast fallback while DictionaryAPI is slow. Its positional format can change without notice, so parsing must be defensive and fixture-tested.

## OpenRouter — `openrouter.ai/api/v1`

- `GET /models` needs no key; returns `{ data: [...] }`. 447 models, 22 with prompt and completion price `"0"`.
- Useful fields: `id`, `context_length`, `architecture.{input,output}_modalities`, `pricing`, `top_provider.max_completion_tokens`, `supported_parameters`, `expiration_date`.
- **Free-candidate filter** (price 0 alone is not enough):
  - id ends with `:free`, or is `openrouter/free`. The price-0 `google/lyria-3-*` are music models with `output_modalities: ["text","audio"]`.
  - `output_modalities` is exactly `["text"]`.
  - `expiration_date` is null or in the future (`dots-studio/dots-3-note-preview:free` expires 2026-09-30).
  - Exclude moderation models (`nvidia/nemotron-3.5-content-safety:free`).
  - Prefer `supported_parameters` containing `response_format` / `structured_outputs`: nex-n2.5-mini/pro, dots-3-note-preview, lfm-2.5-2.6b, gemma-4-26b/31b, nemotron-3-super-120b, `openrouter/free`.
- **`openrouter/free` exists** as a router model id. It can be the last candidate in the rotation.
- Bad key → HTTP 401 `{"error":{"message":"Missing Authentication header","code":401}}`, no rate-limit headers.
- Documented free limits (docs 2026-09-14): 20 requests/min; 50/day without purchased credits, 1,000/day with ≥10 credits. 429 body `{"error":{"code":429,"message":"Rate limit exceeded","metadata":{"error_type":"rate_limit_exceeded"}}}` with `X-RateLimit-Limit/Remaining/Reset`.
- **Not yet recorded:** successful free-model chat, JSON quality, invalid-model error, real 429. These need `OPENROUTER_API_KEY` (see commands above).

## Local providers

- Ollama `http://localhost:11434/v1/models` and LM Studio `http://localhost:1234/v1/models`: `ECONNREFUSED` (not running on this machine). Re-run `probe.mjs local` with them started.
