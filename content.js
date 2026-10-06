(() => {
  "use strict";

  const { classifyTerm, WORD_TYPES, COLLOCATION_TYPES } = globalThis.AnkiVocabularyTerm;
  const typesFor = (kind) => (kind === "word" ? WORD_TYPES : COLLOCATION_TYPES);
  const Suggestions = globalThis.AnkiVocabularySuggestions;
  const { extractContext } = globalThis.AnkiVocabularyPageContext;
  const CONTEXT_BLOCKS = "p,li,dd,dt,blockquote,td,th,figcaption,caption,h1,h2,h3,h4,h5,h6,pre,article,section,div";
  const MAX_BLOCK_CHARS = 4000;
  const GROUP_LABELS = { patterns: "Patterns", collocations: "Collocations", synonyms: "Synonyms", antonyms: "Antonyms", similar: "Similar expressions" };
  const SOURCE_LABELS = { datamuse: "Datamuse", wiktionary: "Wiktionary", gtx: "Google" };
  const VIEWPORT_MARGIN = 8;
  const state = {
    requestId: "", draft: null, lastRequest: null, decks: [], expandedDecks: new Set(), blockedSites: [],
    host: null, root: null, panel: null, screen: "", anchor: null, pinned: false, debounce: null,
  };

  const LANGUAGES = [
    ["vi", "🇻🇳", "VI"], ["en", "🇺🇸", "EN"], ["ja", "🇯🇵", "JA"],
    ["ko", "🇰🇷", "KO"], ["zh-CN", "🇨🇳", "ZH"], ["fr", "🇫🇷", "FR"],
    ["de", "🇩🇪", "DE"], ["es", "🇪🇸", "ES"], ["th", "🇹🇭", "TH"],
    ["ru", "🇷🇺", "RU"], ["pt", "🇧🇷", "PT"], ["it", "🇮🇹", "IT"],
    ["ar", "🇸🇦", "AR"], ["hi", "🇮🇳", "HI"], ["id", "🇮🇩", "ID"],
    ["tr", "🇹🇷", "TR"], ["pl", "🇵🇱", "PL"], ["nl", "🇳🇱", "NL"],
    ["sv", "🇸🇪", "SV"], ["ms", "🇲🇾", "MS"],
  ];

  const SPEAKER_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';

  // Screens that hold unsaved edits ignore outside clicks and new page selections.
  const EDITING_SCREENS = new Set(["edit", "deck"]);

  // Mirrors prototype-card.html: 320px desktop / 304px mobile overlay, 13px working text.
  const STYLES = `
    :host { all: initial; } * { box-sizing: border-box; }
    .panel { position:fixed; top:0; left:0; width:320px; max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); overflow:auto; border:1px solid #d6dce5; border-radius:15px; background:#fff; color:#162033; box-shadow:0 18px 45px rgba(15,23,42,.21); pointer-events:auto; font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; text-align:left; }
    button, input, select, textarea { font-family:inherit; }
    p { margin:0; }
    .head { display:flex; align-items:center; justify-content:space-between; min-height:36px; padding:6px 10px; border-bottom:1px solid #edf0f4; }
    .head h2 { margin:0; color:#5a6678; font-size:11px; font-weight:700; letter-spacing:.09em; }
    .close { border:0; background:transparent; color:#667085; font-size:21px; line-height:1; cursor:pointer; }
    .body { padding:11px; }
    .panel.translate .body { padding:10px; }
    .panel.edit .body { padding:8px 10px; }

    .language-row { display:grid; grid-template-columns:90px 10px 90px 26px 26px 26px; gap:4px; align-items:center; }
    .lang { width:100%; min-width:0; padding:6px 5px; border:1px solid #cfd6e0; border-radius:8px; background:#f4f6f9; color:#263249; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    select.lang { cursor:pointer; }
    .arrow { text-align:center; color:#a3adbc; }
    .top-icon { display:grid; place-items:center; width:26px; height:28px; padding:0; border:0; border-radius:6px; background:transparent; color:#667085; font-size:17px; line-height:1; cursor:pointer; }
    .top-icon:hover { background:#f2f4f7; } .top-icon.active { color:#3562df; }
    .term { margin-top:11px; color:#657184; font-size:12px; }
    .translation { margin-top:2px; font-size:13px; font-weight:800; letter-spacing:-.025em; }
    .meta { margin-top:2px; color:#69768a; font-size:12px; }
    .compact-add { display:flex; align-items:center; justify-content:space-between; margin-top:8px; padding-top:7px; border-top:1px solid #e7ebf0; color:#98a2b3; font-size:11px; font-weight:750; }
    .compact-add .button { flex:0 0 auto; min-height:31px; padding:5px 10px; }
    .site { display:flex; gap:6px; align-items:center; margin-top:9px; padding-top:8px; border-top:1px solid #e7ebf0; color:#667085; font-size:10px; }
    .site input { width:14px; height:14px; margin:0; accent-color:#3562df; }
    .loading { display:flex; align-items:center; gap:8px; margin:12px 0 4px; color:#667085; font-size:12px; }
    .spinner { width:14px; height:14px; border:2px solid #d7e0fa; border-top-color:#3562df; border-radius:50%; animation:spin .65s linear infinite; } @keyframes spin { to { transform:rotate(360deg); } }

    .actions { display:flex; gap:6px; margin-top:10px; }
    .button { flex:1; min-height:30px; padding:5px 8px; border:1px solid #ccd4df; border-radius:7px; background:#fff; color:#536077; font-size:12px; cursor:pointer; }
    .panel.edit .button, .panel.deck .button { font-size:13px; }
    .actions .button { min-height:31px; } .actions .button.primary { flex:1.45; white-space:nowrap; }
    .button.primary { border-color:#111827; background:#111827; color:#fff; } .button.primary:hover { background:#29354c; }
    .button.blue { border-color:#3562df; background:#3562df; color:#fff; }
    .button:disabled { opacity:.55; cursor:default; }

    .kind-chip { display:inline-flex; align-items:center; gap:4px; margin:5px 0 6px; padding:3px 9px; border-radius:999px; background:#edf2ff; color:#274fb8; font-size:12px; font-weight:800; }
    .kind-chip.invalid { background:#fff0f0; color:#a52e2e; }
    .kind-chip small { color:#6b7fae; font-size:11px; font-weight:600; }
    .form { padding:9px; border-radius:10px; background:#f1f3f6; }
    .form label { display:block; margin-bottom:6px; color:#596579; font-size:13px; font-weight:750; }
    .form label:last-child, .split label { margin-bottom:0; }
    .split { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:6px; }
    .split.collocation { grid-template-columns:1fr; } .split.collocation .pronunciation { display:none; }
    .form input, .form textarea, .form select { display:block; width:100%; margin-top:3px; padding:6px 7px; border:1px solid #cad2de; border-radius:7px; background:#fff; color:#172033; font-size:13px; font-weight:400; }
    .form textarea { min-height:42px; resize:vertical; }
    .form select { height:31px; cursor:pointer; } .form select.missing { border-color:#e3a3a3; background:#fff8f8; }
    .form input:focus, .form textarea:focus, .form select:focus, .deck-search input:focus, .new-deck input:focus { outline:3px solid rgba(53,98,223,.15); border-color:#3562df; }

    .form.word .pattern-field { display:none; }
    .suggestions { margin-top:8px; padding-top:7px; border-top:1px solid #dde3ea; }
    .chip-group + .chip-group { margin-top:7px; }
    .chip-head { display:flex; align-items:baseline; justify-content:space-between; gap:6px; color:#596579; font-size:13px; font-weight:750; }
    .chip-state { color:#98a2b3; font-size:11px; font-weight:600; }
    .chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
    .chip { max-width:100%; padding:2px 8px; border:1px solid #cad2de; border-radius:999px; background:#fff; color:#536077; font-size:12px; line-height:1.45; text-align:left; overflow-wrap:anywhere; cursor:pointer; }
    .chip:hover { border-color:#9fb0c8; }
    .chip[aria-pressed="true"] { border-color:#3562df; background:#edf2ff; color:#274fb8; font-weight:650; }
    .chip[aria-pressed="true"]::before { content:"✓ "; }
    .chip.custom { border-style:dashed; }
    .chip-add { display:flex; gap:4px; margin-top:4px; }
    .form .chip-add input { height:26px; margin:0; padding:3px 7px; font-size:12px; }
    .chip-add button { flex:0 0 26px; height:26px; padding:0; border:1px solid #ccd4df; border-radius:6px; background:#fff; color:#536077; font-size:15px; line-height:1; cursor:pointer; }
    .chip-note { margin-top:6px; color:#98a2b3; font-size:11px; }
    .audio-card { display:grid; grid-template-columns:auto 1fr; gap:8px; align-items:center; margin-top:9px; padding:9px; border:1px solid #d9e4dd; border-radius:10px; background:linear-gradient(135deg,#f7fbf8,#fff); }
    .audio-play { display:grid; width:31px; height:31px; place-items:center; border:0; border-radius:50%; background:#e3efe7; color:#2e6b4c; cursor:pointer; }
    .audio-info { min-width:0; }
    .audio-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#29372e; font-size:13px; font-weight:800; }
    .audio-note { margin-top:1px; color:#718077; font-size:13px; }
    .audio-links { grid-column:2; display:flex; gap:5px; align-items:center; }
    .audio-link { padding:3px 0; border:0; background:none; color:#2e6b4c; font-size:13px; font-weight:700; text-decoration:none; cursor:pointer; }
    .audio-link + .audio-link { padding-left:7px; border-left:1px solid #d6e0d9; }

    .deck-search { display:flex; gap:6px; margin:8px 0; }
    .deck-search input, .new-deck input { flex:1; min-width:0; height:30px; padding:6px 8px; border:1px solid #cbd3df; border-radius:7px; color:#172033; font-size:13px; }
    .deck-search .button { flex:0 0 30px; width:30px; height:30px; min-height:30px; padding:0; font-size:16px; line-height:1; }
    .tree { max-height:190px; overflow:auto; padding:4px; border:1px solid #e2e7ee; border-radius:9px; background:#fbfcfe; }
    .tree-row { display:flex; align-items:center; gap:5px; min-height:25px; padding:0 5px; border-radius:6px; }
    .tree-row:hover { background:#f0f4fb; } .tree-row.selected { background:#eaf0ff; }
    .twist { flex:0 0 17px; width:17px; padding:0; border:0; background:transparent; color:#667085; text-align:center; cursor:pointer; }
    .twist:disabled { cursor:default; }
    .deck-pick { display:flex; align-items:center; gap:5px; flex:1; min-width:0; padding:3px 0; border:0; background:transparent; color:#162033; text-align:left; cursor:pointer; }
    .folder { color:#3562df; }
    .deck-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; font-weight:700; }
    .tree-empty { margin:6px; color:#69768a; font-size:13px; }
    .new-deck { display:flex; gap:7px; margin-top:8px; } .new-deck .button { flex:0 0 auto; }
    .status { margin-top:6px; padding:7px; border-radius:7px; background:#ecfdf3; color:#176741; font-size:13px; }
    .status.hint { background:#f2f4f7; color:#667085; }
    .status.error { background:#fff0f0; color:#a52e2e; }


    @media (max-width:720px) { .panel { width:304px; } }
    @media (max-width:390px) { .split { grid-template-columns:1fr; } }
  `;

  chrome.runtime.sendMessage({ type: "get-ui-settings" }, (response) => {
    if (response?.ok) state.blockedSites = response.blockedSites || [];
  });

  function ensureUI() {
    if (state.root) return;
    state.host = document.createElement("div");
    state.host.id = "anki-add-vocabulary-host";
    Object.assign(state.host.style, { all: "initial", position: "fixed", inset: "0", zIndex: "2147483647", pointerEvents: "none" });
    state.root = state.host.attachShadow({ mode: "closed" });
    state.root.append(el("style", { text: STYLES }));
    (document.body || document.documentElement).append(state.host);
  }

  function show(screen, panel) {
    ensureUI();
    panel.classList.add(screen);
    state.panel?.remove();
    state.panel = panel;
    state.screen = screen;
    state.root.append(panel);
    place();
  }

  function close() {
    state.panel?.remove();
    state.panel = null;
    state.screen = "";
    state.requestId = "";
    state.draft = null;
    state.lastRequest = null;
    state.pinned = false;
  }

  // Anchor below the selection, flip above when there is no room, and always stay inside the viewport.
  function place() {
    const panel = state.panel;
    if (!panel) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const anchor = state.anchor;
    let left = anchor ? anchor.left : (window.innerWidth - width) / 2;
    let top = anchor ? anchor.bottom + VIEWPORT_MARGIN : (window.innerHeight - height) / 2;
    if (anchor && top + height > window.innerHeight - VIEWPORT_MARGIN && anchor.top - VIEWPORT_MARGIN - height >= VIEWPORT_MARGIN) {
      top = anchor.top - VIEWPORT_MARGIN - height;
    }
    panel.style.left = `${clamp(left, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)}px`;
    panel.style.top = `${clamp(top, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)}px`;
  }

  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(value, maximum)); }

  function panel(title, ...children) {
    const node = el("section", { className: "panel", role: "dialog", ariaLabel: title });
    if (title) node.append(el("header", { className: "head" }, el("h2", { text: title }), iconButton("×", "close", "Close", close)));
    node.append(el("div", { className: "body" }, ...children));
    return node;
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === undefined) continue;
      if (name === "text") node.textContent = value;
      else if (name === "className") node.className = value;
      else if (name.startsWith("aria")) node.setAttribute(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value);
      else node[name] = value;
    }
    node.append(...children.filter(Boolean));
    return node;
  }

  function button(text, className, action) { const node = el("button", { type: "button", className, text }); node.addEventListener("click", action); return node; }
  function iconButton(text, className, label, action) { const node = button(text, className, action); node.title = label; node.setAttribute("aria-label", label); return node; }
  function speakerButton(className, label, draft) { const node = iconButton("", className, label, () => speak(draft)); node.innerHTML = SPEAKER_ICON; return node; }
  // Words and collocations each need one of their fixed types; detected ones are listed first.
  function typeField(kind, value, detected = []) {
    const types = typesFor(kind);
    const found = detected.filter((type) => types.includes(type));
    const select = el("select", { name: "type", ariaLabel: kind === "word" ? "Word type" : "Collocation type", title: "✓ = detected from the page sentence or dictionary", required: true });
    select.append(el("option", { value: "", text: "Choose type…" }));
    for (const type of [...found, ...types.filter((type) => !found.includes(type))]) {
      select.append(el("option", { value: type, text: found.includes(type) ? `✓ ${type}` : type }));
    }
    select.value = types.includes(value) ? value : "";
    const mark = () => select.classList.toggle("missing", !select.value);
    select.addEventListener("change", mark);
    mark();
    return el("label", {}, document.createTextNode("Type"), select);
  }

  function field(labelText, name, value, multiline = false) { const input = el(multiline ? "textarea" : "input", { name, value: value || "" }); return el("label", {}, document.createTextNode(labelText), input); }

  function languageCode(code) { const entry = LANGUAGES.find(([value]) => value === code); return entry ? entry[2] : code && code !== "auto" ? code.toUpperCase() : "AUTO"; }
  function languageLabel(code, detected = false) {
    const entry = LANGUAGES.find(([value]) => value === code);
    return `${detected ? "✓ " : ""}${entry ? entry[1] : "🌐"} ${languageCode(code)}`;
  }

  function languageSelector(selected, onChange) {
    const select = el("select", { className: "lang", ariaLabel: "Translation target language" });
    for (const [value, flag, label] of LANGUAGES) select.append(el("option", { value, text: `${flag} ${label}` }));
    select.value = LANGUAGES.some(([value]) => value === selected) ? selected : "vi";
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  function speak(draft) {
    const fallback = () => {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(draft.term);
      utterance.lang = voiceLocale(draft.sourceLanguage);
      window.speechSynthesis.speak(utterance);
    };
    if (!draft.audioUrl) {
      fallback();
      return;
    }
    const audio = new Audio(draft.audioUrl);
    audio.addEventListener("error", fallback, { once: true });
    audio.play().catch(fallback);
  }

  function voiceLocale(language) {
    return {
      en: "en-US", ja: "ja-JP", ko: "ko-KR", "zh-CN": "zh-CN",
      fr: "fr-FR", de: "de-DE", es: "es-ES", th: "th-TH", ru: "ru-RU",
      pt: "pt-BR", it: "it-IT", ar: "ar-SA", hi: "hi-IN", id: "id-ID",
      tr: "tr-TR", pl: "pl-PL", nl: "nl-NL", sv: "sv-SE", ms: "ms-MY",
    }[language] || "en-US";
  }

  function currentHostBlocked() { const host = location.hostname.toLowerCase(); return state.blockedSites.some((site) => host === site || host.endsWith(`.${site}`)); }
  function startFromSelection() {
    if (currentHostBlocked()) return { ok: false };
    const selection = window.getSelection();
    const term = classifyTerm(selection?.toString())?.term;
    if (!term) return { ok: false };
    state.anchor = selectionAnchor(selection);
    const { sentence: context, pronunciation } = selectionContext(selection, term);
    startTranslation({ term, context, pronunciation, source: { title: document.title.slice(0, 300), url: location.href } });
    return { ok: true };
  }

  function selectionAnchor(selection) {
    try {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      return rect.width || rect.height ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null;
    } catch { return null; }
  }

  function startTranslation({ term, context, pronunciation = "", source, targetLanguage = "" }) {
    const requestId = crypto.randomUUID();
    state.requestId = requestId;
    state.lastRequest = { term, context, pronunciation, source, targetLanguage };
    showLoading(term, targetLanguage);
    chrome.runtime.sendMessage({ type: "translate", requestId, text: term, context, source, targetLanguage }, (response) => {
      if (chrome.runtime.lastError || state.requestId !== requestId) return;
      if (!response?.ok) {
        showTranslationError(term, response?.error?.message || "Translation failed.");
        return;
      }
      // Context is only a real page sentence; IPA printed next to the word (dictionary pages) prefills Pronunciation.
      state.draft = { ...response.draft, context, pronunciation: response.draft.pronunciation || pronunciation, deck: state.draft?.deck || "" };
      showTranslationResult();
      if (state.draft.kind === "word") loadDictionary(requestId);
    });
  }

  // DictionaryAPI can take ~20 s uncached: fill pronunciation, MP3, and extra types in place when it answers.
  async function loadDictionary(requestId) {
    const response = await message({ type: "dictionary", term: state.draft.term });
    const draft = state.draft;
    if (!response.ok || state.requestId !== requestId || !draft) return;
    const { pronunciation, audioUrl, types, antonyms } = response.dictionary;
    draft.pronunciation ||= pronunciation;
    draft.audioUrl ||= audioUrl;
    if (draft.audioUrl) prepareAudio(draft);
    draft.typeDetected = [...new Set([...(draft.typeDetected || []), ...types])];
    draft.dictionaryAntonyms = antonyms;
    if (state.screen === "translate") {
      showTranslationResult();
    } else if (state.screen === "edit") {
      const input = state.panel.querySelector('[name="pronunciation"]');
      if (input && !input.value) input.value = draft.pronunciation;
      const control = state.panel.querySelector('[name="type"]');
      if (control && classifyTerm(state.panel.querySelector('[name="term"]').value)?.kind === draft.kind) {
        control.closest("label").replaceWith(typeField(draft.kind, control.value, draft.typeDetected));
      }
      state.panel.querySelector(".audio-card")?.replaceWith(audioCard(draft));
      const type = state.panel.querySelector('[name="type"]')?.value;
      if (draft.suggestions?.antonyms && antonyms?.[type]) {
        draft.suggestions = Suggestions.mergeEnrichment(draft.suggestions, { antonyms: antonyms[type].map((text) => ({ text, source: "dictionary" })) });
        state.renderChips?.();
      }
    }
  }

  // Download the MP3 ahead of Add so a slow DictionaryAPI can never make Add time out.
  async function prepareAudio(draft) {
    if (draft.audioState) return;
    draft.audioState = "loading";
    refreshAudioCard(draft);
    const response = await message({ type: "prepare-audio", audioUrl: draft.audioUrl });
    draft.audioState = response.ok ? "ready" : "failed";
    refreshAudioCard(draft);
  }

  function refreshAudioCard(draft) {
    if (state.draft === draft && state.screen === "edit") state.panel.querySelector(".audio-card")?.replaceWith(audioCard(draft));
  }

  function pinButton() {
    const pin = iconButton(state.pinned ? "⚑" : "⚐", `top-icon ${state.pinned ? "active" : ""}`, state.pinned ? "Unpin preview" : "Pin preview", () => {
      state.pinned = !state.pinned;
      pin.textContent = state.pinned ? "⚑" : "⚐";
      pin.title = state.pinned ? "Unpin preview" : "Pin preview";
      pin.classList.toggle("active", state.pinned);
    });
    return pin;
  }

  function showLoading(term, targetLanguage) {
    show("translate", panel("",
      el("div", { className: "language-row" }, el("span", { className: "lang", text: "🌐 AUTO" }), el("span", { className: "arrow", text: "→" }), el("span", { className: "lang", text: languageLabel(targetLanguage || state.draft?.targetLanguage || "vi") }), el("span"), pinButton(), iconButton("×", "top-icon", "Close", close)),
      el("p", { className: "term", text: term }),
      el("div", { className: "loading", ariaLive: "polite" }, el("span", { className: "spinner" }), el("span", { text: "Translating…" })),
    ));
  }

  function showTranslationError(term, message) {
    show("translate", panel("",
      el("p", { className: "term", text: term }),
      el("p", { className: "status error", text: message }),
      el("div", { className: "actions" }, button("Close", "button", close), button("Retry", "button blue", () => startTranslation(state.lastRequest))),
    ));
  }

  function showTranslationResult() {
    const draft = state.draft;
    const blockSite = el("input", { type: "checkbox" });
    blockSite.addEventListener("change", async () => {
      if (!blockSite.checked) return;
      const response = await message({ type: "block-site", host: location.hostname });
      if (response.ok) state.blockedSites = response.blockedSites;
      close();
    });
    const targetSelector = languageSelector(draft.targetLanguage, async (targetLanguage) => {
      await message({ type: "save-settings", settings: { targetLanguage } });
      startTranslation({ ...state.lastRequest, targetLanguage });
    });
    show("translate", panel("",
      el("div", { className: "language-row" },
        el("span", { className: "lang", text: languageLabel(draft.sourceLanguage, true) }),
        el("span", { className: "arrow", text: "→" }),
        targetSelector,
        speakerButton("top-icon", "Listen", draft),
        pinButton(),
        iconButton("×", "top-icon", "Close", close)),
      el("p", { className: "term", text: draft.term }),
      el("p", { className: "translation", text: draft.translation }),
      el("p", { className: "meta", text: [draft.pronunciation, draft.type].filter(Boolean).join(" · ") }),
      el("div", { className: "compact-add" }, el("span", { text: languageCode(draft.sourceLanguage) }), button("Add to Anki", "button primary", showReview)),
      el("label", { className: "site" }, blockSite, document.createTextNode("Don’t auto-translate this site")),
    ));
  }

  function audioCard(draft) {
    if (!draft.audioUrl) {
      return el("div", { className: "audio-card" },
        speakerButton("audio-play", "Preview pronunciation", draft),
        el("div", { className: "audio-info" }, el("div", { className: "audio-name", text: "No recording" }), el("div", { className: "audio-note", text: "Browser voice now · Anki TTS on review" })));
    }
    const url = draft.audioUrl;
    const filename = new URL(url).pathname.split("/").pop();
    return el("div", { className: "audio-card" },
      speakerButton("audio-play", "Preview MP3", draft),
      el("div", { className: "audio-info" }, el("div", { className: "audio-name", text: filename }), el("div", { className: "audio-note", text: {
        loading: "Downloading MP3… you can add now; Anki TTS is used if it is not ready",
        ready: "MP3 ready · saved to Anki media on Add",
        failed: "MP3 unavailable (DictionaryAPI not responding) · Anki TTS will read the word",
      }[draft.audioState] || "Dictionary MP3 · saved to Anki media on Add" })),
      el("div", { className: "audio-links" },
        el("a", { className: "audio-link", href: url, target: "_blank", rel: "noreferrer", text: "Open" }),
        el("a", { className: "audio-link", href: url, download: filename, target: "_blank", rel: "noreferrer", text: "Download" })));
  }

  function showReview() {
    const draft = state.draft;
    if (!draft.suggestions || draft.suggestionsKind !== draft.kind) {
      draft.suggestions = Suggestions.createGroups(draft);
      draft.suggestionsKind = draft.kind;
      draft.suggestionsKey = "";
    }
    const form = el("div", { className: `form ${draft.kind}` },
      field("Term", "term", draft.term),
      field(draft.targetLanguage === "vi" ? "Meaning VN" : `Meaning ${languageCode(draft.targetLanguage)}`, "translation", draft.translation),
      el("div", { className: `split ${draft.kind === "collocation" ? "collocation" : ""}` }, Object.assign(field("US pronunciation", "pronunciation", draft.pronunciation), { className: "pronunciation" }), typeField(draft.kind, draft.type, draft.typeDetected)),
      Object.assign(field("Pattern", "pattern", draft.pattern), { className: "pattern-field" }),
      field("Example", "example", draft.example, true));
    const chipArea = el("div", { className: "suggestions", ariaLive: "polite" });
    form.append(chipArea);
    const current = () => {
      const classified = classifyTerm(form.querySelector('[name="term"]').value);
      return { term: classified?.term || "", kind: classified?.kind || "", type: form.querySelector('[name="type"]').value };
    };
    const renderChips = () => renderSuggestions(chipArea, current());
    state.renderChips = renderChips;

    const chip = el("p", { className: "kind-chip", ariaLive: "polite" });
    let shownKind = draft.kind;
    const updateChip = () => {
      const classified = classifyTerm(form.querySelector('[name="term"]').value);
      chip.classList.toggle("invalid", !classified);
      if (classified && classified.kind !== shownKind) {
        const control = form.querySelector('[name="type"]');
        const value = classified.kind === draft.kind ? draft.type : control.value;
        control.closest("label").replaceWith(typeField(classified.kind, value, classified.kind === draft.kind ? draft.typeDetected : []));
        form.querySelector(".split").classList.toggle("collocation", classified.kind === "collocation");
        form.classList.toggle("word", classified.kind === "word");
        form.classList.toggle("collocation", classified.kind === "collocation");
        state.draft.suggestions = Suggestions.createGroups({ kind: classified.kind, contextPattern: "" });
        state.draft.suggestionsKind = classified.kind;
        state.draft.suggestionsKey = "";
        shownKind = classified.kind;
        renderChips();
      }
      if (!classified) { chip.replaceChildren("Term needs a letter (max 500 characters)"); return; }
      chip.replaceChildren(classified.kind === "word" ? "Word" : `Collocation · ${classified.words} words`, el("small", { text: "· auto" }));
    };
    form.querySelector('[name="term"]').addEventListener("input", updateChip);
    // Type and (committed) Term edits invalidate default picks and reload suggestions for the new combination.
    form.addEventListener("change", (event) => {
      if (event.target.name !== "type" && event.target.name !== "term") return;
      state.draft.suggestions = Suggestions.resetForType(state.draft.suggestions);
      requestEnrichment(current());
    });
    updateChip();
    const status = el("p", { className: "status error", hidden: true });
    const choose = button("Choose deck", "button primary", () => {
      readReview(form);
      const problem = !state.draft.kind ? "Term must contain a letter and be at most 500 characters."
        : !state.draft.translation ? "Meaning is required."
          : !typesFor(state.draft.kind).includes(state.draft.type) ? `Choose a ${state.draft.kind === "word" ? "word" : "collocation"} type.` : "";
      if (problem) {
        status.textContent = problem;
        status.hidden = false;
        place();
        return;
      }
      showDecks();
    });
    show("edit", panel("PREVIEW & EDIT",
      chip,
      form,
      audioCard(draft),
      status,
      el("div", { className: "actions" }, button("Back", "button", () => { readReview(form); showTranslationResult(); }), choose),
    ));
    requestEnrichment(current());
  }

  // Fetches suggestions for the term/type on screen; late answers for an older combination are ignored.
  async function requestEnrichment({ term, kind, type }) {
    const draft = state.draft;
    if (!draft) return;
    const key = `${kind}|${type}|${term.toLowerCase()}`;
    if (!term || (kind === "word" && !type)) {
      draft.enrichStatus = { state: kind === "word" && term ? "needs-type" : "idle" };
      draft.suggestionsKey = "";
      state.renderChips?.();
      return;
    }
    if (draft.suggestionsKey === key && draft.enrichStatus?.state !== "error") { state.renderChips?.(); return; }
    draft.suggestionsKey = key;
    draft.enrichStatus = { state: "loading" };
    state.renderChips?.();
    const response = await message({ type: "enrich", term, termType: type });
    if (state.draft !== draft || draft.suggestionsKey !== key) return;
    if (!response.ok) {
      draft.enrichStatus = { state: "error", message: response.error?.message || "Suggestions are unavailable." };
    } else {
      draft.suggestions = Suggestions.mergeEnrichment(draft.suggestions, response.enrichment);
      if (kind === "word" && draft.dictionaryAntonyms?.[type]) {
        draft.suggestions = Suggestions.mergeEnrichment(draft.suggestions, { antonyms: draft.dictionaryAntonyms[type].map((text) => ({ text, source: "dictionary" })) });
      }
      draft.enrichStatus = { state: "done", sources: response.enrichment.sources };
    }
    if (state.screen === "edit") state.renderChips?.();
  }

  function renderSuggestions(container, { kind }) {
    const draft = state.draft;
    const status = draft.enrichStatus || { state: "idle" };
    const groups = Suggestions.groupsFor(kind).filter((field) => draft.suggestions?.[field]);
    container.replaceChildren(...groups.map((field) => {
      const group = draft.suggestions[field];
      const selected = group.items.filter((item) => item.selected).length;
      const stateText = status.state === "loading" ? "Loading…"
        : status.state === "needs-type" && group.items.length === 0 ? "Choose a type first"
          : group.items.length === 0 ? "No suggestions" : `${selected} selected`;
      const chips = group.items.map((item) => {
        const node = button(item.text, `chip ${item.source === "you" ? "custom" : ""}`, () => {
          draft.suggestions = Suggestions.toggle(draft.suggestions, field, item.text);
          renderSuggestions(container, { kind });
        });
        node.setAttribute("aria-pressed", String(item.selected));
        node.title = item.source === "you" ? "Added by you" : `From ${SOURCE_LABELS[item.source] || item.source}`;
        return node;
      });
      const input = el("input", { placeholder: `Add ${GROUP_LABELS[field].toLowerCase()}…`, ariaLabel: `Add to ${GROUP_LABELS[field]}`, maxLength: 80 });
      const add = () => {
        if (!input.value.trim()) return;
        draft.suggestions = Suggestions.addCustom(draft.suggestions, field, input.value);
        renderSuggestions(container, { kind });
        container.querySelector(`[data-field="${field}"] .chip-add input`)?.focus();
      };
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); add(); } });
      return el("div", { className: "chip-group" },
        el("div", { className: "chip-head" }, el("span", { text: GROUP_LABELS[field] }), el("span", { className: "chip-state", text: stateText })),
        chips.length ? el("div", { className: "chips" }, ...chips) : null,
        el("div", { className: "chip-add" }, input, iconButton("+", "", `Add to ${GROUP_LABELS[field]}`, add)));
    }));
    for (const [index, node] of [...container.children].entries()) node.dataset.field = groups[index];
    const unavailable = Object.entries(status.sources || {}).filter(([, value]) => value === "error" || value === "timeout").map(([name, value]) => `${SOURCE_LABELS[name] || name} (${value})`);
    if (status.state === "error") container.append(el("p", { className: "chip-note", text: status.message }));
    else if (unavailable.length) container.append(el("p", { className: "chip-note", text: `Unavailable: ${unavailable.join(", ")}` }));
    place();
  }

  function readReview(form) {
    const read = (name) => form.querySelector(`[name="${name}"]`).value.trim();
    const classified = classifyTerm(read("term"));
    const picked = { patterns: [], collocations: [], synonyms: [], antonyms: [], similar: [], ...Suggestions.snapshot(state.draft.suggestions) };
    state.draft = { ...state.draft, term: classified?.term || read("term"), kind: classified?.kind || "", translation: read("translation"), pronunciation: read("pronunciation"), type: read("type"), pattern: read("pattern"), example: read("example"), ...picked };
  }

  async function showDecks() {
    show("deck", panel("CHOOSE ANKI DECK", el("div", { className: "loading" }, el("span", { className: "spinner" }), el("span", { text: "Reading decks from AnkiConnect…" }))));
    const response = await message({ type: "list-decks" });
    if (state.screen !== "deck") return;
    if (!response.ok) { showDeckError(response.error?.message || "Cannot read Anki decks."); return; }
    state.decks = response.decks;
    if (state.draft.deck && !state.decks.includes(state.draft.deck)) state.draft.deck = "";
    for (const ancestor of deckAncestors(state.draft.deck)) state.expandedDecks.add(ancestor);
    renderDecks();
  }

  function renderDecks() {
    const search = el("input", { type: "search", placeholder: "Search decks…", ariaLabel: "Search decks" });
    const tree = el("div", { className: "tree", role: "tree", ariaLabel: "Anki deck tree" });
    const status = el("p", { className: "status" });
    const add = button("", "button primary", () => submitAdd(add, status));
    const newName = el("input", { placeholder: "New Anki deck name", ariaLabel: "New Anki deck name" });
    const create = button("Create", "button blue", async () => {
      if (!newName.value.trim()) { newName.focus(); return; }
      create.disabled = true;
      const response = await message({ type: "create-deck", name: newName.value });
      create.disabled = false;
      if (!response.ok) { setStatus(status, response.error?.message || "Could not create deck.", "error"); return; }
      state.draft.deck = response.deck;
      state.decks = [...new Set([...state.decks, response.deck])].sort((a, b) => a.localeCompare(b));
      for (const ancestor of deckAncestors(response.deck)) state.expandedDecks.add(ancestor);
      newName.value = "";
      refresh();
    });

    const refresh = () => {
      tree.replaceChildren();
      if (!appendDeckTree(tree, buildDeckTree(state.decks), search.value.trim().toLowerCase(), refresh)) tree.append(el("p", { className: "tree-empty", text: "No matching decks." }));
      add.textContent = `Add ${state.draft.kind} to Anki`;
      add.disabled = !state.draft.deck;
      if (state.draft.deck) setStatus(status, `✓ ${state.draft.deck} selected. No note has been written yet.`);
      else setStatus(status, "Choose a deck. No note has been written yet.", "hint");
    };

    search.addEventListener("input", refresh);
    newName.addEventListener("keydown", (event) => { if (event.key === "Enter") create.click(); });
    show("deck", panel("CHOOSE ANKI DECK",
      el("div", { className: "deck-search" }, search, iconButton("⌕", "button", "Search decks", () => search.focus())),
      tree,
      el("div", { className: "new-deck" }, newName, create),
      status,
      el("div", { className: "actions" }, button("Back", "button", showReview), add),
    ));
    refresh();
    place();
  }

  function setStatus(node, text, variant = "") {
    node.className = `status ${variant}`;
    node.textContent = text;
    place();
  }

  function buildDeckTree(decks) {
    const roots = new Map();
    const exact = new Set(decks);
    for (const fullName of decks) {
      const parts = fullName.split("::").filter(Boolean);
      let branch = roots;
      const path = [];
      for (const label of parts) {
        path.push(label);
        const name = path.join("::");
        if (!branch.has(name)) branch.set(name, { label, name, selectable: exact.has(name), children: new Map() });
        branch = branch.get(name).children;
      }
    }
    return sortDeckNodes([...roots.values()]);
  }

  function sortDeckNodes(nodes) {
    return nodes
      .map((node) => ({ ...node, children: sortDeckNodes([...node.children.values()]) }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  function appendDeckTree(container, nodes, query, refresh, depth = 0) {
    let appended = false;
    for (const node of nodes) {
      if (query && !treeMatches(node, query)) continue;
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && (Boolean(query) || state.expandedDecks.has(node.name));
      const selected = state.draft.deck === node.name;
      const row = el("div", { className: `tree-row ${selected ? "selected" : ""}`, role: "treeitem", ariaExpanded: hasChildren ? String(expanded) : undefined, ariaSelected: String(selected) });
      row.style.paddingLeft = `${5 + depth * 24}px`;
      const toggleExpanded = () => {
        if (state.expandedDecks.has(node.name)) state.expandedDecks.delete(node.name);
        else state.expandedDecks.add(node.name);
        refresh();
      };
      const twist = iconButton(hasChildren ? (expanded ? "▾" : "▸") : "·", "twist", hasChildren ? `${expanded ? "Collapse" : "Expand"} ${node.label}` : node.label, toggleExpanded);
      twist.disabled = !hasChildren;
      const pick = el("button", { type: "button", className: "deck-pick", title: node.name, ariaLabel: node.selectable ? `Choose ${node.name}` : `Folder ${node.name}` },
        el("span", { className: "folder", text: hasChildren ? "▣" : "A" }),
        el("span", { className: "deck-name", text: node.label }));
      pick.addEventListener("click", () => {
        if (!node.selectable) { toggleExpanded(); return; }
        state.draft.deck = node.name;
        refresh();
      });
      row.append(twist, pick);
      container.append(row);
      appended = true;
      if (expanded) appended = appendDeckTree(container, node.children, query, refresh, depth + 1) || appended;
    }
    return appended;
  }

  function treeMatches(node, query) {
    return node.name.toLowerCase().includes(query) || node.children.some((child) => treeMatches(child, query));
  }

  function deckAncestors(name) {
    const parts = String(name || "").split("::");
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("::"));
  }

  function showDeckError(error) {
    show("deck", panel("ANKI NOT READY",
      el("p", { className: "status error", text: error }),
      el("p", { className: "meta", text: "Open Anki Desktop, install AnkiConnect, allow the extension, then retry." }),
      el("div", { className: "actions" }, button("Back", "button", showReview), button("Retry", "button blue", showDecks)),
    ));
  }

  async function submitAdd(add, status) {
    add.disabled = true;
    add.textContent = "Adding…";
    const response = await message({ type: "add-note", draft: state.draft });
    if (state.screen !== "deck") return;
    if (!response.ok) {
      add.disabled = false;
      add.textContent = `Add ${state.draft.kind} to Anki`;
      setStatus(status, response.error?.message || "Could not add the note.", "error");
      return;
    }
    // No card review: Add just adds. The confirmation closes itself unless something needs attention.
    Object.assign(state.draft, response.note || {});
    const notices = [];
    if (response.audioSkipped) notices.push(response.audioSkipped);
    const oldDesign = response.templateStatus === "outdated" || response.templateStatus === "customized";
    if (oldDesign) notices.push("Your note type still uses an older card design. Upgrade it in Settings → Note types.");
    else if (response.antonymsHidden) notices.push("Antonyms were saved, but your card template does not show them.");
    showAdded(`✓ Added “${state.draft.term}” to ${state.draft.deck}.`, notices, oldDesign || response.antonymsHidden);
  }

  function showAdded(text, notices, offerSettings) {
    show("done", panel("",
      el("p", { className: "status", text }),
      ...notices.map((notice) => el("p", { className: "status hint", text: notice })),
      offerSettings ? el("div", { className: "actions" }, button("Open Settings → Note types", "button", () => message({ type: "open-options" }))) : null,
      notices.length ? el("div", { className: "actions" }, button("Done", "button primary", close)) : null,
    ));
    if (!notices.length) setTimeout(() => { if (state.screen === "done") close(); }, 2500);
  }

  // Text of the nearest block plus the selection's own offset, so a repeated word resolves to the selected occurrence.
  function selectionContext(selection, term) {
    try {
      const range = selection.getRangeAt(0);
      const node = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
      const block = node.closest(CONTEXT_BLOCKS) || document.body;
      const before = document.createRange();
      before.setStart(block, 0);
      before.setEnd(range.startContainer, range.startOffset);
      let text = block.textContent || "";
      let offset = before.toString().length + Math.max(0, selection.toString().search(/[\p{L}\p{N}]/u));
      if (text.length > MAX_BLOCK_CHARS) {
        const start = Math.max(0, offset - MAX_BLOCK_CHARS / 2);
        text = text.slice(start, start + MAX_BLOCK_CHARS);
        offset -= start;
      }
      const context = extractContext(text, term, offset);
      return { ...context, pronunciation: context.pronunciation || nearbyPronunciation(block, range, term) };
    } catch {
      return { sentence: "", pronunciation: "" };
    }
  }

  // Dictionary pages often put the headword and its IPA in sibling elements; look a few short ancestors up.
  function nearbyPronunciation(block, range, term) {
    let element = block.parentElement;
    for (let level = 0; element && element !== document.body && level < 3; level += 1, element = element.parentElement) {
      const text = element.textContent || "";
      if (text.length > 1000) break;
      const before = document.createRange();
      before.setStart(element, 0);
      before.setEnd(range.startContainer, range.startOffset);
      const { pronunciation } = extractContext(text, term, before.toString().length);
      if (pronunciation) return pronunciation;
    }
    return "";
  }

  function message(payload) { return new Promise((resolve) => chrome.runtime.sendMessage(payload, (response) => resolve(chrome.runtime.lastError ? { ok: false, error: { message: "Extension was reloaded. Refresh the page and try again." } } : response || { ok: false, error: { message: "No extension response." } }))); }

  function insideUI(event) { return Boolean(state.host) && event.composedPath().includes(state.host); }

  document.addEventListener("mousedown", (event) => {
    if (!state.panel || insideUI(event) || state.pinned || EDITING_SCREENS.has(state.screen)) return;
    close();
  }, true);
  document.addEventListener("mouseup", (event) => {
    if (insideUI(event) || EDITING_SCREENS.has(state.screen)) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
    clearTimeout(state.debounce);
    state.debounce = setTimeout(startFromSelection, 90);
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.panel) close(); });
  window.addEventListener("resize", place);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "open-selection-flow") {
      if (EDITING_SCREENS.has(state.screen)) { sendResponse({ ok: false }); return false; }
      sendResponse(startFromSelection());
      return false;
    }
    return false;
  });
})();
