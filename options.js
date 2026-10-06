const $ = (id) => document.getElementById(id);

async function load() {
  const values = await chrome.storage.local.get({
    ankiUrl: "http://127.0.0.1:8765",
    ankiApiKey: "",
    targetLanguage: "vi",
  });
  for (const key of Object.keys(values)) $(key).value = values[key];
}

function formSettings() {
  return {
    ankiUrl: $("ankiUrl").value.trim(),
    ankiApiKey: $("ankiApiKey").value.trim(),
    targetLanguage: $("targetLanguage").value,
  };
}

async function save() {
  return chrome.runtime.sendMessage({ type: "save-settings", settings: formSettings() });
}

async function test() {
  const button = $("test");
  const output = $("result");
  button.disabled = true;
  output.className = "";
  output.textContent = "Checking…";
  const saved = await save();
  if (!saved?.ok) {
    output.className = "error";
    output.textContent = saved?.error?.message || "Settings are invalid.";
    button.disabled = false;
    return;
  }
  const status = await chrome.runtime.sendMessage({ type: "status" });
  output.className = status?.ok ? "ok" : "error";
  output.textContent = status?.ok
    ? `Connected. ${status.deckCount} Anki decks found.`
    : status?.error || "AnkiConnect is unavailable.";
  button.disabled = false;
}

const MODEL_STATES = {
  current: ["Up to date", ""],
  missing: ["Not created yet", "Created with the current template on your first add."],
  outdated: ["Older template", "Upgrade adds the Antonyms section to the card back. Your notes and fields are not changed."],
  customized: ["Customized template", "Upgrade replaces your template edits with the current VocabBot template."],
  unsupported: ["Cannot upgrade", "This note type does not have exactly one card type. Edit it in Anki instead."],
  "missing-fields": ["Missing fields", "Required fields are missing; notes cannot be added until they are restored."],
};

function renderModels(models) {
  $("models").replaceChildren(...models.map((model) => {
    const [label, hint] = MODEL_STATES[model.status] || [model.status, ""];
    const item = document.createElement("li");
    const name = document.createElement("code");
    name.textContent = model.name;
    const state = document.createElement("span");
    state.className = `state ${model.status}`;
    state.textContent = label;
    item.append(name, state);
    const detail = [hint, model.missingFields?.length ? `Missing: ${model.missingFields.join(", ")}` : ""].filter(Boolean).join(" ");
    if (detail) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = detail;
      item.append(note);
    }
    return item;
  }));
  const upgradable = models.filter((model) => model.status === "outdated" || model.status === "customized");
  $("upgradeModels").hidden = upgradable.length === 0;
  $("upgradeModels").dataset.kinds = upgradable.map((model) => model.kind).join(",");
  $("upgradeModels").dataset.customized = String(upgradable.some((model) => model.status === "customized"));
}

async function checkModels() {
  const output = $("modelResult");
  output.className = "";
  output.textContent = "Checking…";
  const saved = await save();
  const response = saved?.ok ? await chrome.runtime.sendMessage({ type: "model-status" }) : saved;
  if (!response?.ok) {
    output.className = "error";
    output.textContent = response?.error?.message || "Could not read note types.";
    return;
  }
  renderModels(response.models);
  output.textContent = "";
}

async function upgradeModels() {
  const button = $("upgradeModels");
  const kinds = button.dataset.kinds.split(",").filter(Boolean);
  const customized = button.dataset.customized === "true";
  if (customized && !confirm("A VocabBot note type has a customized card template. Upgrading replaces your template edits. Notes and fields are kept. Continue?")) return;
  button.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "upgrade-models", kinds, confirmCustomized: customized });
  button.disabled = false;
  const output = $("modelResult");
  output.className = response?.ok ? "ok" : "error";
  output.textContent = response?.ok
    ? (response.upgraded.length ? `Upgraded: ${response.upgraded.join(", ")}.` : "Nothing to upgrade.")
    : response?.error?.message || "Upgrade failed.";
  if (response?.ok) renderModels(response.models);
}

$("test").addEventListener("click", test);
$("checkModels").addEventListener("click", checkModels);
$("upgradeModels").addEventListener("click", upgradeModels);
$("targetLanguage").addEventListener("change", async () => { await save(); });
load();
