// popup.js

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  groupsContainer: document.getElementById("groupsContainer"),
  emptyState: document.getElementById("emptyState"),
  settingsBtn: document.getElementById("settingsBtn"),

  apiKeyInput: document.getElementById("apiKeyInput"),
  apiKeyGroup: document.getElementById("apiKeyGroup"),
  apiKeyHint: document.getElementById("apiKeyHint"),
  providerSelect: document.getElementById("providerSelect"),
  modelInput: document.getElementById("modelInput"),
  modelHint: document.getElementById("modelHint"),
  baseUrlGroup: document.getElementById("baseUrlGroup"),
  baseUrlInput: document.getElementById("baseUrlInput"),
  autoGenToggle: document.getElementById("autoGenToggle"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  settingsSavedMsg: document.getElementById("settingsSavedMsg"),
  testConnectionBtn: document.getElementById("testConnectionBtn"),
  testResultMsg: document.getElementById("testResultMsg"),
  exportBtn: document.getElementById("exportBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),

  modal: document.getElementById("noteModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalDifficulty: document.getElementById("modalDifficulty"),
  modalTags: document.getElementById("modalTags"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  previewModeBtn: document.getElementById("previewModeBtn"),
  editModeBtn: document.getElementById("editModeBtn"),
  modalPreviewPanel: document.getElementById("modalPreviewPanel"),
  modalEditPanel: document.getElementById("modalEditPanel"),
  previewContent: document.getElementById("previewContent"),
  approachField: document.getElementById("approachField"),
  optimalApproachField: document.getElementById("optimalApproachField"),
  timeField: document.getElementById("timeField"),
  spaceField: document.getElementById("spaceField"),
  insightField: document.getElementById("insightField"),
  pitfallsField: document.getElementById("pitfallsField"),
  codeField: document.getElementById("codeField"),
  aiErrorMsg: document.getElementById("aiErrorMsg"),
  regenerateBtn: document.getElementById("regenerateBtn"),
  openProblemBtn: document.getElementById("openProblemBtn"),
  saveNoteBtn: document.getElementById("saveNoteBtn"),
  deleteNoteBtn: document.getElementById("deleteNoteBtn"),

  githubPushBtn: document.getElementById("githubPushBtn"),
  githubSyncMsg: document.getElementById("githubSyncMsg"),

  githubPatInput: document.getElementById("githubPatInput"),
  githubRepoInput: document.getElementById("githubRepoInput"),
  githubBranchInput: document.getElementById("githubBranchInput"),
  githubAutoSyncToggle: document.getElementById("githubAutoSyncToggle"),
  saveGithubBtn: document.getElementById("saveGithubBtn"),
  githubSavedMsg: document.getElementById("githubSavedMsg"),
  testGithubBtn: document.getElementById("testGithubBtn"),
  githubTestResultMsg: document.getElementById("githubTestResultMsg"),
  syncAllGithubBtn: document.getElementById("syncAllGithubBtn"),

  githubProgressPanel: document.getElementById("githubProgressPanel"),
  githubProgressLabel: document.getElementById("githubProgressLabel"),
  githubProgressCount: document.getElementById("githubProgressCount"),
  githubProgressBar: document.getElementById("githubProgressBar"),
  githubProgressCurrent: document.getElementById("githubProgressCurrent"),
};

let allNotes = {};
let expandedGroups = new Set();
let activeSlug = null;

// Wraps sendMessage to gracefully handle MV3 service-worker dormancy.
// Returns a synthetic error object instead of throwing if the SW dropped the response.
async function sendMsg(payload) {
  try {
    const response = await chrome.runtime.sendMessage(payload);
    if (response === undefined) {
      return { ok: false, error: "Extension service worker restarted — please try again." };
    }
    return response;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── GitHub progress UI ──

function updateProgressUI(progress) {
  if (!progress) {
    els.githubProgressPanel.classList.add("hidden");
    return;
  }

  els.githubProgressPanel.classList.remove("hidden");

  const pct = progress.total > 0
    ? Math.round((progress.currentIndex / progress.total) * 100)
    : 0;

  els.githubProgressBar.style.width = pct + "%";
  els.githubProgressCount.textContent = `${progress.currentIndex} / ${progress.total}`;

  if (progress.inProgress) {
    els.githubProgressLabel.textContent = "Pushing to GitHub...";
    els.githubProgressBar.classList.remove("done");
    els.githubProgressCurrent.textContent = progress.currentTitle
      ? `Current: ${progress.currentTitle}`
      : "Starting...";
    // Disable buttons while in progress
    els.syncAllGithubBtn.disabled = true;
    els.syncAllGithubBtn.textContent = "Pushing...";
    els.githubTestResultMsg.classList.add("hidden");
  } else {
    // Sync finished
    els.githubProgressBar.classList.add("done");
    els.githubProgressBar.style.width = "100%";
    const ok = progress.failCount === 0;
    els.githubProgressLabel.textContent = ok ? "Sync complete" : "Sync finished with errors";
    els.githubProgressCount.textContent = `${progress.successCount} / ${progress.total}`;
    els.githubProgressCurrent.textContent = progress.lastError
      ? `Last error: ${progress.lastError}`
      : `All ${progress.successCount} notes pushed successfully.`;
    // Re-enable button
    els.syncAllGithubBtn.disabled = false;
    els.syncAllGithubBtn.textContent = "Push all notes now";
    // Show result in the result message element too
    els.githubTestResultMsg.classList.remove("hidden");
    els.githubTestResultMsg.className = ok ? "test-ok" : "test-fail";
    els.githubTestResultMsg.textContent = ok
      ? `All ${progress.successCount} notes synced to GitHub.`
      : `${progress.successCount} succeeded, ${progress.failCount} failed. Last error: ${progress.lastError}`;
  }
}

// ── tab switching ──
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    els.tabs.forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    const target = tab.dataset.tab;
    els.views.forEach((v) => v.classList.toggle("active", v.id === target + "View"));
  });
});
els.settingsBtn.addEventListener("click", () => {
  document.querySelector('.tab[data-tab="settings"]').click();
});

// ── load + render ──
async function loadNotes() {
  const result = await chrome.storage.local.get(["notes"]);
  allNotes = result.notes || {};
  render();
}

function groupByTag(notes) {
  const groups = {};
  Object.values(notes).forEach((note) => {
    const tags = note.tags && note.tags.length ? note.tags : ["Untagged"];
    tags.forEach((tag) => {
      if (!groups[tag]) groups[tag] = [];
      groups[tag].push(note);
    });
  });
  return groups;
}

function groupByDifficulty(notes) {
  const groups = { Easy: [], Medium: [], Hard: [], Unknown: [] };
  Object.values(notes).forEach((note) => {
    const d = ["Easy", "Medium", "Hard"].includes(note.difficulty) ? note.difficulty : "Unknown";
    groups[d].push(note);
  });
  Object.keys(groups).forEach((k) => { if (groups[k].length === 0) delete groups[k]; });
  return groups;
}

function filterNotes(notes, query) {
  if (!query) return notes;
  const q = query.toLowerCase();
  const filtered = {};
  Object.entries(notes).forEach(([slug, note]) => {
    const haystack = (note.title + " " + (note.tags || []).join(" ")).toLowerCase();
    if (haystack.includes(q)) filtered[slug] = note;
  });
  return filtered;
}

function render() {
  const query = els.searchInput.value.trim();
  const sortMode = els.sortSelect.value;
  const filtered = filterNotes(allNotes, query);
  const hasAny = Object.keys(allNotes).length > 0;
  const hasFiltered = Object.keys(filtered).length > 0;

  els.emptyState.classList.toggle("hidden", hasAny);
  els.groupsContainer.innerHTML = "";

  if (!hasFiltered) {
    if (hasAny && query) {
      const msg = document.createElement("p");
      msg.style.color = "var(--text-dim)";
      msg.style.fontSize = "12px";
      msg.style.padding = "16px 4px";
      msg.textContent = `No problems match "${query}".`;
      els.groupsContainer.appendChild(msg);
    }
    return;
  }

  let groups;
  if (sortMode === "topic") {
    groups = groupByTag(filtered);
  } else if (sortMode === "difficulty") {
    groups = groupByDifficulty(filtered);
  } else {
    // recent: single flat list sorted by lastSolvedAt desc
    const sorted = Object.values(filtered).sort(
      (a, b) => new Date(b.lastSolvedAt || b.solvedAt) - new Date(a.lastSolvedAt || a.solvedAt)
    );
    groups = { "All problems": sorted };
  }

  // Sort group keys: alphabetically for topic, fixed order for difficulty.
  let groupKeys = Object.keys(groups);
  if (sortMode === "topic") {
    groupKeys.sort((a, b) => a.localeCompare(b));
  } else if (sortMode === "difficulty") {
    const order = { Easy: 0, Medium: 1, Hard: 2, Unknown: 3 };
    groupKeys.sort((a, b) => order[a] - order[b]);
  }

  groupKeys.forEach((groupName) => {
    const problems = groups[groupName];
    if (sortMode !== "recent") {
      problems.sort((a, b) => a.title.localeCompare(b.title));
    }
    els.groupsContainer.appendChild(renderGroup(groupName, problems, sortMode === "recent"));
  });
}

function renderGroup(groupName, problems, alwaysExpanded) {
  const groupEl = document.createElement("div");
  groupEl.className = "group";
  const isExpanded = alwaysExpanded || expandedGroups.has(groupName);
  if (isExpanded) groupEl.classList.add("expanded");

  const header = document.createElement("div");
  header.className = "group-header";
  header.innerHTML = `
    <span class="group-title">
      ${alwaysExpanded ? "" : '<span class="group-chevron">▶</span>'}
      ${escapeHtml(groupName)}
    </span>
    <span class="group-count">${problems.length}</span>
  `;
  if (!alwaysExpanded) {
    header.addEventListener("click", () => {
      if (expandedGroups.has(groupName)) expandedGroups.delete(groupName);
      else expandedGroups.add(groupName);
      render();
    });
  }
  groupEl.appendChild(header);

  const body = document.createElement("div");
  body.className = "group-body";
  problems.forEach((note) => body.appendChild(renderProblemRow(note)));
  groupEl.appendChild(body);

  return groupEl;
}

function renderProblemRow(note) {
  const row = document.createElement("div");
  row.className = "problem-row";

  const syncState = getGithubSyncState(note);
  const ghTitles = {
    never:   "Not synced to GitHub",
    pending: "Changes not yet pushed to GitHub",
    synced:  "Up to date on GitHub",
  };
  const githubBadge = note.githubSyncError
    ? `<span class="gh-badge error" title="GitHub sync error">GH</span>`
    : `<span class="gh-badge ${syncState}" title="${ghTitles[syncState]}">GH</span>`;

  row.innerHTML = `
    <span class="problem-title">${escapeHtml(note.title)}</span>
    <span class="problem-meta">
      ${note.generated ? '<span class="ai-badge">AI</span>' : ""}
      ${githubBadge}
      <span class="pill ${note.difficulty}">${note.difficulty}</span>
    </span>
  `;
  row.addEventListener("click", () => openModal(note.titleSlug));
  return row;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// Returns "never" | "pending" | "synced" based on modification vs sync timestamps.
function getGithubSyncState(note) {
  if (!note.githubSyncedAt) return "never";
  if (note.lastModifiedAt && new Date(note.lastModifiedAt) > new Date(note.githubSyncedAt)) return "pending";
  return "synced";
}

// Applies the correct visual state to the Push to GitHub button.
function applyGithubPushBtn(note) {
  const state = getGithubSyncState(note);
  const btn = els.githubPushBtn;

  btn.disabled = state === "synced";
  btn.className = "secondary-btn preview-only gh-push-" + state;

  const titles = {
    never:   "Push to GitHub",
    pending: "Push changes to GitHub",
    synced:  "Up to date on GitHub",
  };
  btn.title = titles[state];
}

els.searchInput.addEventListener("input", render);
els.sortSelect.addEventListener("change", render);

// ── modal ──

function setModalMode(mode) {
  const isPreview = mode === "preview";

  // Switch panels
  els.modalPreviewPanel.classList.toggle("hidden", !isPreview);
  els.modalEditPanel.classList.toggle("hidden", isPreview);

  // Update toggle pill
  els.previewModeBtn.classList.toggle("active", isPreview);
  els.previewModeBtn.setAttribute("aria-pressed", String(isPreview));
  els.editModeBtn.classList.toggle("active", !isPreview);
  els.editModeBtn.setAttribute("aria-pressed", String(!isPreview));

  // Swap footer buttons
  document.querySelectorAll(".preview-only").forEach(b => b.classList.toggle("hidden", !isPreview));
  document.querySelectorAll(".edit-only").forEach(b => b.classList.toggle("hidden", isPreview));
}

function renderNotePreview(note) {
  let displayCode = note.code || "";
  if (displayCode.includes("\\n") && !displayCode.includes("\n")) {
    displayCode = displayCode.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  const empty = (v) => !v || !v.trim();
  const lines = (v) => escapeHtml(v).replace(/\n/g, "<br>");

  let html = "";

  html += `<div class="preview-section">
    <p class="preview-label">Question</p>
    ${
      empty(note.question)
        ? `<p class="preview-empty">No question found.</p>`
        : `<p class="preview-text">${lines(note.question)}</p>`
    }
  </div>`;

  html += `<div class="preview-section">
    <p class="preview-label">Testcases</p>
    ${
      empty(note.testcases)
        ? `<p class="preview-empty">No testcases found.</p>`
        : `<pre class="code-block">${escapeHtml(note.testcases)}</pre>`
    }
  </div>`;

  html += `<div class="preview-section">
    <p class="preview-label">Approach</p>
    ${
      empty(note.approach)
        ? `<p class="preview-empty">No approach notes yet.</p>`
        : `<p class="preview-text">${lines(note.approach)}</p>`
    }
  </div>`;

  if (!empty(note.optimalApproach)) {
    html += `<div class="preview-section">
      <p class="preview-label">Optimal Approach</p>
      <p class="preview-text">${lines(note.optimalApproach)}</p>
    </div>`;
  }

  html += `<div class="preview-section">
    <p class="preview-label">Complexity</p>
    <div class="preview-complexity">
      <span class="preview-complexity-item">
        <span class="preview-complexity-key">Time</span>
        <code>${escapeHtml(note.timeComplexity || "—")}</code>
      </span>
      <span class="preview-complexity-item">
        <span class="preview-complexity-key">Space</span>
        <code>${escapeHtml(note.spaceComplexity || "—")}</code>
      </span>
    </div>
  </div>`;

  if (!empty(note.keyInsight)) {
    html += `<div class="preview-section">
      <p class="preview-label">Key Insight</p>
      <p class="preview-insight-box">${lines(note.keyInsight)}</p>
    </div>`;
  }

  if (!empty(note.pitfalls)) {
    html += `<div class="preview-section">
      <p class="preview-label">Pitfalls / Edge Cases</p>
      <p class="preview-text">${lines(note.pitfalls)}</p>
    </div>`;
  }

  const lang = escapeHtml((note.language || "text").toLowerCase());
  html += `<div class="preview-section">
    <p class="preview-label">Code <span class="preview-lang">${lang}</span></p>
    <pre class="code-block">${escapeHtml(displayCode) || "<em>No code captured.</em>"}</pre>
  </div>`;

  return html;
}
function openModal(slug) {
  const note = allNotes[slug];
  if (!note) return;
  activeSlug = slug;

  // Header
  els.modalTitle.textContent = note.title;
  els.modalDifficulty.textContent = note.difficulty;
  els.modalDifficulty.className = "pill " + note.difficulty;
  els.modalTags.innerHTML = (note.tags || [])
    .map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`)
    .join("");

  // Populate edit fields (hidden until user switches to Edit mode)
  els.approachField.value = note.approach || "";
  els.optimalApproachField.value = note.optimalApproach || "";
  els.timeField.value = note.timeComplexity || "";
  els.spaceField.value = note.spaceComplexity || "";
  els.insightField.value = note.keyInsight || "";
  els.pitfallsField.value = note.pitfalls || "";
  let displayCode = note.code || "";
  if (displayCode.includes("\\n") && !displayCode.includes("\n")) {
    displayCode = displayCode.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  els.codeField.textContent = displayCode;

  // Render preview
  els.previewContent.innerHTML = renderNotePreview(note);

  // AI status
  if (note.aiError) {
    els.aiErrorMsg.className = "error-msg";
    els.aiErrorMsg.textContent = "AI generation failed: " + note.aiError;
  } else if (note.generated && note.generatedBy) {
    els.aiErrorMsg.className = "field-hint";
    els.aiErrorMsg.textContent = "Generated by " + note.generatedBy;
  } else {
    els.aiErrorMsg.className = "field-hint hidden";
    els.aiErrorMsg.textContent = "";
  }

  // GitHub sync status
  if (note.githubSyncedAt) {
    els.githubSyncMsg.className = "field-hint test-ok";
    els.githubSyncMsg.textContent =
      "Synced to GitHub: " + (note.githubPath || "") +
      " (" + new Date(note.githubSyncedAt).toLocaleTimeString() + ")";
  } else if (note.githubSyncError) {
    els.githubSyncMsg.className = "error-msg";
    els.githubSyncMsg.textContent = "GitHub sync error: " + note.githubSyncError;
  } else {
    els.githubSyncMsg.className = "field-hint hidden";
    els.githubSyncMsg.textContent = "";
  }

  // Push button state
  applyGithubPushBtn(note);

  // Always open in preview mode
  setModalMode("preview");
  els.modal.classList.remove("hidden");
}

function closeModal() {
  els.modal.classList.add("hidden");
  activeSlug = null;
}

els.closeModalBtn.addEventListener("click", closeModal);
els.modal.addEventListener("click", (e) => {
  if (e.target === els.modal) closeModal();
});

els.previewModeBtn.addEventListener("click", () => setModalMode("preview"));
els.editModeBtn.addEventListener("click", () => setModalMode("edit"));

els.openProblemBtn.addEventListener("click", () => {
  const note = allNotes[activeSlug];
  if (note?.url) chrome.tabs.create({ url: note.url });
});

els.saveNoteBtn.addEventListener("click", async () => {
  if (!activeSlug) return;
  const note = allNotes[activeSlug];
  note.approach = els.approachField.value;
  note.optimalApproach = els.optimalApproachField.value;
  note.timeComplexity = els.timeField.value;
  note.spaceComplexity = els.spaceField.value;
  note.keyInsight = els.insightField.value;
  note.pitfalls = els.pitfallsField.value;
  note.userEdited = true;
  note.lastModifiedAt = new Date().toISOString(); // mark as changed

  await chrome.storage.local.set({ notes: allNotes });

  // Auto-push if enabled (force:false respects the autoSync toggle).
  // This covers the case where a previously-synced note is edited and saved.
  chrome.runtime.sendMessage({ type: "SYNC_NOTE", titleSlug: activeSlug, force: false }).catch(() => {});

  // Refresh preview and push-button state, then switch back to preview.
  els.previewContent.innerHTML = renderNotePreview(note);
  applyGithubPushBtn(note);
  setModalMode("preview");
  render();
});

els.deleteNoteBtn.addEventListener("click", async () => {
  if (!activeSlug) return;
  if (!confirm("Delete this note? This can't be undone.")) return;
  delete allNotes[activeSlug];
  await chrome.storage.local.set({ notes: allNotes });
  closeModal();
  render();
});

// SVG icon strings used to restore button content after async operations.
const BTN_ICONS = {
  regenerate: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
  githubPush: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>`,
  loading: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>`,
};

els.regenerateBtn.addEventListener("click", async () => {
  if (!activeSlug) return;
  els.regenerateBtn.innerHTML = BTN_ICONS.loading;
  els.regenerateBtn.disabled = true;

  const response = await sendMsg({ type: "REGENERATE_NOTE", titleSlug: activeSlug });

  els.regenerateBtn.innerHTML = BTN_ICONS.regenerate;
  els.regenerateBtn.disabled = false;

  if (response.ok) {
    allNotes[activeSlug] = response.note;
    openModal(activeSlug); // re-opens in preview mode
  } else {
    // Show the error in the preview panel status area
    els.aiErrorMsg.className = "error-msg";
    els.aiErrorMsg.textContent = "Regeneration failed: " + response.error;
  }
});

els.githubPushBtn.addEventListener("click", async () => {
  if (!activeSlug) return;

  const note = allNotes[activeSlug];
  // Prevent re-push if already up to date
  if (getGithubSyncState(note) === "synced") return;

  els.githubPushBtn.innerHTML = BTN_ICONS.loading;
  els.githubPushBtn.disabled = true;
  els.githubSyncMsg.className = "field-hint";
  els.githubSyncMsg.textContent = "Pushing to GitHub...";

  const response = await sendMsg({ type: "SYNC_NOTE", titleSlug: activeSlug, force: true });

  els.githubPushBtn.innerHTML = BTN_ICONS.githubPush;

  if (response.ok) {
    // Reload note from storage so lastModifiedAt reflects the sync
    await loadNotes();
    const updated = allNotes[activeSlug];
    applyGithubPushBtn(updated);
    els.githubSyncMsg.className = "field-hint test-ok";
    els.githubSyncMsg.textContent = "Synced to GitHub ✓ (" + new Date().toLocaleTimeString() + ")";
  } else {
    applyGithubPushBtn(note);
    els.githubSyncMsg.className = "error-msg";
    els.githubSyncMsg.textContent = "Failed: " + response.error;
  }
});

// ── settings ──

// Provider metadata (mirrors lib/providers.js — update both if adding a provider).
const PROVIDER_META = {
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    modelHint: "e.g. gemini-2.5-flash, gemini-3.5-flash",
    apiKeyHint: 'Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com</a>.',
    needsApiKey: true,
    needsBaseUrl: false,
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5.5",
    modelHint: "e.g. gpt-5.5, gpt-5.5-mini",
    apiKeyHint: 'Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.',
    needsApiKey: true,
    needsBaseUrl: false,
  },
  anthropic: {
    label: "Anthropic (Claude)",
    defaultModel: "claude-sonnet-4-6",
    modelHint: "e.g. claude-sonnet-4-6, claude-haiku-4-5",
    apiKeyHint: 'Get a key at <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>.',
    needsApiKey: true,
    needsBaseUrl: false,
  },
  ollama: {
    label: "Ollama (local)",
    defaultModel: "llama3",
    modelHint: "e.g. llama3, qwen2.5-coder, deepseek-r1 (must be pulled locally)",
    apiKeyHint: "",
    needsApiKey: false,
    needsBaseUrl: true,
  },
};

function applyProviderUI(providerId, opts = {}) {
  const meta = PROVIDER_META[providerId] || PROVIDER_META.gemini;
  els.modelHint.textContent = meta.modelHint;
  els.apiKeyGroup.classList.toggle("hidden", !meta.needsApiKey);
  els.baseUrlGroup.classList.toggle("hidden", !meta.needsBaseUrl);
  els.apiKeyHint.innerHTML = meta.apiKeyHint;
  if (opts.fillDefaultModel) {
    els.modelInput.value = meta.defaultModel;
  } else if (!els.modelInput.value) {
    els.modelInput.placeholder = meta.defaultModel;
  }
}

els.providerSelect.addEventListener("change", () => {
  applyProviderUI(els.providerSelect.value, { fillDefaultModel: true });
});

async function loadSettings() {
  const result = await chrome.storage.sync.get([
    "provider",
    "model",
    "apiKey",
    "baseUrl",
    "autoGenerate",
    "githubPat",
    "githubRepo",
    "githubBranch",
    "githubAutoSync",
  ]);
  const provider = result.provider || "gemini";
  els.providerSelect.value = provider;
  els.modelInput.value = result.model || PROVIDER_META[provider].defaultModel;
  els.apiKeyInput.value = result.apiKey || "";
  els.baseUrlInput.value = result.baseUrl || "http://localhost:11434";
  els.autoGenToggle.checked = result.autoGenerate !== false;
  applyProviderUI(provider);

  // Load GitHub settings
  els.githubPatInput.value = result.githubPat || "";
  els.githubRepoInput.value = result.githubRepo || "";
  els.githubBranchInput.value = result.githubBranch || "main";
  els.githubAutoSyncToggle.checked = result.githubAutoSync === true;
}

els.saveSettingsBtn.addEventListener("click", async () => {
  await chrome.storage.sync.set({
    provider: els.providerSelect.value,
    model: els.modelInput.value.trim() || PROVIDER_META[els.providerSelect.value].defaultModel,
    apiKey: els.apiKeyInput.value.trim(),
    baseUrl: els.baseUrlInput.value.trim(),
    autoGenerate: els.autoGenToggle.checked,
  });
  els.settingsSavedMsg.classList.remove("hidden");
  els.testResultMsg.classList.add("hidden");
  setTimeout(() => els.settingsSavedMsg.classList.add("hidden"), 1800);
});

function parseGithubRepo(raw) {
  let r = raw.trim();
  if (r.includes("github.com/")) {
    const parts = r.split("github.com/")[1].split("/");
    if (parts.length >= 2) r = `${parts[0]}/${parts[1]}`;
  }
  if (r.endsWith(".git")) r = r.slice(0, -4);
  return r;
}

els.saveGithubBtn.addEventListener("click", async () => {
  const parsedRepo = parseGithubRepo(els.githubRepoInput.value);
  els.githubRepoInput.value = parsedRepo;
  await chrome.storage.sync.set({
    githubPat: els.githubPatInput.value.trim(),
    githubRepo: parsedRepo,
    githubBranch: els.githubBranchInput.value.trim() || "main",
    githubAutoSync: els.githubAutoSyncToggle.checked,
  });
  els.githubSavedMsg.classList.remove("hidden");
  els.githubTestResultMsg.classList.add("hidden");
  setTimeout(() => els.githubSavedMsg.classList.add("hidden"), 1800);
});

els.testGithubBtn.addEventListener("click", async () => {
  const parsedRepo = parseGithubRepo(els.githubRepoInput.value);
  const pat = els.githubPatInput.value.trim();

  if (!parsedRepo || !pat) {
    els.githubTestResultMsg.className = "test-fail";
    els.githubTestResultMsg.textContent = "✗ Please enter both a PAT and a Repository.";
    els.githubTestResultMsg.classList.remove("hidden");
    return;
  }

  els.testGithubBtn.textContent = "Testing…";
  els.testGithubBtn.disabled = true;
  els.githubTestResultMsg.classList.add("hidden");

  const settings = {
    pat: pat,
    repo: parsedRepo,
    branch: els.githubBranchInput.value.trim() || "main",
  };

  const response = await sendMsg({ type: "TEST_GITHUB", settings });

  els.testGithubBtn.textContent = "Test connection";
  els.testGithubBtn.disabled = false;
  els.githubTestResultMsg.classList.remove("hidden");

  if (response.ok) {
    els.githubTestResultMsg.className = "test-ok";
    els.githubTestResultMsg.textContent = "✓ Connected — Repository exists and token is valid.";
  } else {
    els.githubTestResultMsg.className = "test-fail";
    els.githubTestResultMsg.textContent = "✗ " + response.error;
  }
});

els.syncAllGithubBtn.addEventListener("click", async () => {
  if (!confirm("This will push all locally stored notes to GitHub. Proceed?")) return;

  // Clear previous result message
  els.githubTestResultMsg.classList.add("hidden");

  // Show initial progress immediately (before background even starts)
  updateProgressUI({
    inProgress: true,
    total: Object.keys(allNotes).length,
    currentIndex: 0,
    currentTitle: "",
    successCount: 0,
    failCount: 0,
  });

  // Fire-and-forget: background persists progress via SYNC_PROGRESS messages.
  // Closing the popup won't interrupt the sync.
  sendMsg({ type: "SYNC_ALL_NOTES" }).then(response => {
    // Final response is a fallback in case SYNC_PROGRESS messages were missed.
    if (response && !response.ok) {
      els.githubProgressPanel.classList.remove("hidden");
      els.githubTestResultMsg.className = "test-fail";
      els.githubTestResultMsg.textContent = "Sync failed: " + response.error;
      els.githubTestResultMsg.classList.remove("hidden");
      els.syncAllGithubBtn.disabled = false;
      els.syncAllGithubBtn.textContent = "Push all notes now";
    }
  });
});

els.testConnectionBtn.addEventListener("click", async () => {
  els.testConnectionBtn.textContent = "Testing…";
  els.testConnectionBtn.disabled = true;
  els.testResultMsg.classList.add("hidden");

  const overrideSettings = {
    provider: els.providerSelect.value,
    model: els.modelInput.value.trim() || PROVIDER_META[els.providerSelect.value].defaultModel,
    apiKey: els.apiKeyInput.value.trim(),
    baseUrl: els.baseUrlInput.value.trim(),
  };

  const response = await sendMsg({ type: "TEST_PROVIDER", settings: overrideSettings });

  els.testConnectionBtn.textContent = "Test connection";
  els.testConnectionBtn.disabled = false;
  els.testResultMsg.classList.remove("hidden");

  if (response.ok) {
    els.testResultMsg.className = "test-ok";
    els.testResultMsg.textContent = "✓ Connected — the model responded successfully.";
  } else {
    els.testResultMsg.className = "test-fail";
    els.testResultMsg.textContent = "✗ " + response.error;
  }
});

els.exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(allNotes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads
    ? chrome.downloads.download({ url, filename: "leetcode-notes-export.json" })
    : window.open(url);
});

els.clearAllBtn.addEventListener("click", async () => {
  if (!confirm("This deletes ALL saved notes permanently. Continue?")) return;
  await chrome.storage.local.set({ notes: {} });
  allNotes = {};
  chrome.runtime.sendMessage({ type: "NOTES_UPDATED" }).catch(() => {});
  render();
});

// ── live updates while popup is open ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "NOTES_UPDATED") loadNotes();
  if (msg.type === "SYNC_PROGRESS") {
    updateProgressUI(msg.progress);
    // Refresh note list to pick up new githubSyncedAt badges
    if (!msg.progress.inProgress) loadNotes();
  }
});

// ── init ──
loadNotes();
loadSettings();

// Restore any in-progress or completed sync state from the last session
chrome.storage.local.get(["githubSyncProgress"]).then(result => {
  if (result.githubSyncProgress) {
    updateProgressUI(result.githubSyncProgress);
  }
});
