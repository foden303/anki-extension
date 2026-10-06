// Sentence and pronunciation around a selection, from the text of its block (content script global; no DOM).
(() => {
  "use strict";

  const MAX_SENTENCE_CHARS = 300;
  // A punctuated sentence needs 3 words ("Light travels fast."); an unpunctuated fragment needs 4.
  const MIN_WORDS = { punctuated: 3, fragment: 4 };
  const PRONUNCIATION_DISTANCE = 120;
  // Characters that only occur in phonetic transcriptions, so "/usr/bin/" or "and/or" never match.
  const IPA_CHARS = /[ɪəʊˈˌæʌɔθðʃʒŋːɑɒɛɜɐɚɝɹɾʔʤʧɫ]/u;
  const TRANSCRIPTION = /\/([^/\s][^/\n]{0,40}?)\/|\[([^\]\s][^\]\n]{0,40}?)\]/gu;
  const ABBREVIATION_END = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|e\.g|i\.e|No|Fig|approx)\.\s*$/i;

  function extractContext(text, term, offset) {
    const source = String(text ?? "");
    const needle = String(term ?? "").trim();
    if (!needle) return { sentence: "", pronunciation: "" };
    const position = Number.isInteger(offset) && offset >= 0 && source.slice(offset, offset + needle.length).toLowerCase() === needle.toLowerCase()
      ? offset
      : findWord(source, needle);
    if (position < 0) return { sentence: "", pronunciation: "" };
    return { sentence: sentenceAt(source, needle, position), pronunciation: pronunciationNear(source, position) };
  }

  function findWord(source, needle) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").exec(source);
    return match ? match.index : -1;
  }

  function sentenceAt(source, needle, position) {
    const segment = segments(source).find(({ start, end }) => position >= start && position < end);
    if (!segment) return "";
    const raw = source.slice(segment.start, segment.end);
    const hasEnding = /[.!?…]["'”’)]?\s*$/.test(raw);
    const cleaned = raw.replace(TRANSCRIPTION, (match, slash, bracket) => (IPA_CHARS.test(slash ?? bracket ?? "") ? " " : match));
    const sentence = cleaned.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
    const words = sentence.split(" ").filter((word) => /\p{L}/u.test(word));
    if (words.length < MIN_WORDS[hasEnding ? "punctuated" : "fragment"] || !sentence.toLowerCase().includes(needle.toLowerCase())) return "";
    // A long run with no sentence ending is navigation or a list, not a sentence.
    if (!hasEnding && sentence.length > MAX_SENTENCE_CHARS) return "";
    return sentence.length > MAX_SENTENCE_CHARS ? trimAround(sentence, needle) : sentence;
  }

  function segments(source) {
    const parts = [];
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      for (const { segment, index } of new Intl.Segmenter("en", { granularity: "sentence" }).segment(source)) {
        parts.push({ start: index, end: index + segment.length });
      }
    } else {
      const pattern = /[^.!?]+(?:[.!?]+|$)\s*/g;
      for (let match = pattern.exec(source); match && match[0]; match = pattern.exec(source)) parts.push({ start: match.index, end: match.index + match[0].length });
    }
    const merged = [];
    for (const part of parts) {
      const previous = merged.at(-1);
      if (previous && ABBREVIATION_END.test(source.slice(previous.start, previous.end))) previous.end = part.end;
      else merged.push({ ...part });
    }
    return merged;
  }

  function trimAround(sentence, needle) {
    const index = sentence.toLowerCase().indexOf(needle.toLowerCase());
    const half = Math.floor((MAX_SENTENCE_CHARS - needle.length) / 2);
    let start = Math.max(0, index - half);
    let end = Math.min(sentence.length, index + needle.length + half);
    if (start > 0) start = sentence.indexOf(" ", start) + 1 || start;
    if (end < sentence.length) end = sentence.lastIndexOf(" ", end) > index + needle.length ? sentence.lastIndexOf(" ", end) : end;
    return `${start > 0 ? "…" : ""}${sentence.slice(start, end).trim()}${end < sentence.length ? "…" : ""}`;
  }

  // Nearby IPA; a transcription labelled "US" wins over UK or unlabelled ones.
  function pronunciationNear(source, position) {
    const nearby = [...source.matchAll(TRANSCRIPTION)]
      .map((match) => ({ body: (match[1] ?? match[2] ?? "").trim(), index: match.index }))
      .filter(({ body, index }) => IPA_CHARS.test(body) && Math.abs(index - position) <= PRONUNCIATION_DISTANCE);
    // "US" (Cambridge) or "NAmE"/"AmE" (Oxford) followed only by spacing/punctuation up to the transcription.
    const us = nearby.find(({ index }) => /\b(?:US|NAmE|AmE)\b[^\p{L}/[]*$/iu.test(source.slice(Math.max(0, index - 24), index)));
    const chosen = us || nearby[0];
    return chosen ? `/${chosen.body}/` : "";
  }

  globalThis.AnkiVocabularyPageContext = Object.freeze({ extractContext });
})();
