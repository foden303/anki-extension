// Tickable suggestion groups for the edit screen (content script global; no network, no DOM).
(() => {
  "use strict";

  const MAX_ITEMS = 12;
  const GROUPS = Object.freeze({ word: Object.freeze(["patterns", "collocations", "synonyms", "antonyms"]), collocation: Object.freeze(["similar"]) });
  // How many items a group ticks by default while the user has not acted in it.
  const DEFAULT_TICKS = { synonyms: 5, collocations: 3, antonyms: 3 };

  const groupsFor = (kind) => GROUPS[kind] || [];
  const key = (text) => text.toLowerCase();

  function cleanCustom(value) {
    const text = String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
    return text.length <= 80 && /\p{L}/u.test(text) && !/[<>{}\\]/.test(text) ? text : "";
  }

  function createGroups(draft) {
    const groups = {};
    for (const field of groupsFor(draft?.kind)) groups[field] = { items: [], touched: false };
    if (groups.patterns && draft.contextPattern) {
      groups.patterns.items.push({ text: draft.contextPattern, source: "sentence", selected: true, explicit: false });
    }
    if (groups.synonyms) {
      for (const text of (draft.synonyms || []).slice(0, DEFAULT_TICKS.synonyms)) {
        if (cleanCustom(text)) groups.synonyms.items.push({ text, source: "gtx", selected: true, explicit: false });
      }
    }
    return groups;
  }

  function mergeEnrichment(groups, enrichment) {
    const next = copy(groups);
    for (const [field, group] of Object.entries(next)) {
      const seen = new Set(group.items.map((item) => key(item.text)));
      for (const incoming of enrichment?.[field] || []) {
        const text = cleanCustom(incoming?.text);
        if (!text || seen.has(key(text)) || group.items.length >= MAX_ITEMS) continue;
        seen.add(key(text));
        group.items.push({ text, source: String(incoming.source || ""), selected: false, explicit: false });
      }
      if (!group.touched) applyDefaults(field, group);
    }
    return next;
  }

  function applyDefaults(field, group) {
    let remaining = (DEFAULT_TICKS[field] || 0) - group.items.filter((item) => item.selected).length;
    for (const item of group.items) {
      if (remaining <= 0) break;
      if (!item.selected) { item.selected = true; remaining -= 1; }
    }
  }

  function toggle(groups, field, text) {
    const next = copy(groups);
    const item = next[field]?.items.find((candidate) => key(candidate.text) === key(text));
    if (!item) return next;
    item.selected = !item.selected;
    item.explicit = true;
    next[field].touched = true;
    return next;
  }

  function addCustom(groups, field, value) {
    const next = copy(groups);
    const group = next[field];
    const text = cleanCustom(value);
    if (!group || !text) return next;
    group.touched = true;
    const existing = group.items.find((item) => key(item.text) === key(text));
    if (existing) {
      Object.assign(existing, { selected: true, explicit: true });
      return next;
    }
    if (group.items.length >= MAX_ITEMS) {
      const drop = group.items.findLastIndex((item) => !item.selected && !item.explicit);
      if (drop < 0) return next;
      group.items.splice(drop, 1);
    }
    group.items.push({ text, source: "you", selected: true, explicit: true });
    return next;
  }

  // A new type invalidates default picks; keep only what the user chose and the type-independent sentence pattern.
  function resetForType(groups) {
    const next = copy(groups);
    for (const group of Object.values(next)) {
      group.items = group.items.filter((item) => (item.explicit && item.selected) || item.source === "sentence");
      group.touched = group.items.some((item) => item.explicit);
    }
    return next;
  }

  function snapshot(groups) {
    return Object.fromEntries(Object.entries(groups).map(([field, group]) => [field, group.items.filter((item) => item.selected).map((item) => item.text)]));
  }

  function copy(groups) {
    return Object.fromEntries(Object.entries(groups || {}).map(([field, group]) => [field, { touched: group.touched, items: group.items.map((item) => ({ ...item })) }]));
  }

  globalThis.AnkiVocabularySuggestions = Object.freeze({ MAX_ITEMS, groupsFor, createGroups, mergeEnrichment, toggle, addCustom, resetForType, snapshot });
})();
