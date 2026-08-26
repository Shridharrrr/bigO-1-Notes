// background.js
// MV3 service worker. Handles PROBLEM_ACCEPTED messages from content scripts,
// calls the configured AI provider to generate a note, and persists everything.

importScripts(chrome.runtime.getURL("lib/providers.js"));

// ── storage helpers ──
// Notes (can be large) → storage.local
// Settings (small strings) → storage.sync, so they follow the user's profile

async function getSettings() {
  const result = await chrome.storage.sync.get([
    "provider",
    "model",
    "apiKey",
    "baseUrl",
    "autoGenerate",
  ]);
  const provider = result.provider || "gemini";
  const providerDef = self.LCProviders.PROVIDERS[provider];
  return {
    provider,
    model: result.model || providerDef?.defaultModel || "",
    apiKey: result.apiKey || "",
    baseUrl: result.baseUrl || "",
    autoGenerate: result.autoGenerate !== false,
  };
}

async function getGithubSettings() {
  const result = await chrome.storage.sync.get([
    "githubPat",
    "githubRepo",
    "githubBranch",
    "githubAutoSync",
  ]);
  return {
    pat: result.githubPat || "",
    repo: result.githubRepo || "",
    branch: result.githubBranch || "main",
    autoSync: result.githubAutoSync === true,
  };
}

async function getAllNotes() {
  const result = await chrome.storage.local.get(["notes"]);
  return result.notes || {};
}

function fallbackNoteFields() {
  return {
    approach: "",
    timeComplexity: "",
    spaceComplexity: "",
    keyInsight: "",
    pitfalls: "",
    optimalApproach: "",
  };
}

// ── GitHub sync helpers ──

function getNotePath(note) {
  let primaryTag = "untagged";
  if (note.tags && note.tags.length > 0 && note.tags[0]) {
    primaryTag = note.tags[0].toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
  if (!primaryTag) primaryTag = "untagged";
  const slug = (note.titleSlug || "unknown").replace(/[^a-z0-9-]/gi, "");
  return `problems/${primaryTag}/${slug}.md`;
}

function buildMarkdownContent(note) {
  // Sanitize title: strip any --- sequences that could break YAML front matter.
  const safeTitle = (note.title || "").replace(/"/g, '\\"').replace(/---/g, "—");
  const tagsStr = (note.tags || []).map(t => `"${t}"`).join(", ");
  const solvedAt = note.solvedAt || new Date().toISOString();
  const attempts = note.attempts || 1;
  const url = note.url || `https://leetcode.com/problems/${note.titleSlug}/`;

  const frontMatter = [
    "---",
    `title: "${safeTitle}"`,
    `difficulty: ${note.difficulty}`,
    `tags: [${tagsStr}]`,
    `language: ${note.language}`,
    `solved_at: ${solvedAt}`,
    `attempts: ${attempts}`,
    `leetcode_url: ${url}`,
    "---",
    ""
  ].join("\n");

  // Unescape code that may have been stored with literal \n instead of newlines.
  let codeStr = note.code || "";
  if (codeStr.includes("\\n") && !codeStr.includes("\n")) {
    codeStr = codeStr.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  const markdownBody = [
    `# ${note.title}`,
    "",
    `**Difficulty:** ${note.difficulty}`,
    `**Tags:** ${(note.tags || []).join(", ")}`,
    "",
    "## Question",
    note.question || "_No question found._",
    "",
    "## Testcases",
    note.testcases ? ("```\n" + note.testcases + "\n```") : "_No testcases found._",
    "",
    "## Approach",
    note.approach || "_No approach notes yet._",
    "",
    ...(note.optimalApproach && note.optimalApproach.trim() ? ["## Optimal Approach", note.optimalApproach.trim(), ""] : []),
    "## Complexity",
    `- Time: ${note.timeComplexity || "Unknown"}`,
    `- Space: ${note.spaceComplexity || "Unknown"}`,
    "",
    "## Key Insight",
    note.keyInsight || "_No key insight yet._",
    "",
    "## Pitfalls / Edge Cases",
    note.pitfalls || "_No pitfalls noted._",
    "",
    "## Code",
    "```" + (note.language || "text").toLowerCase(),
    codeStr,
    "```"
  ].join("\n");

  return frontMatter + markdownBody;
}

function toBase64(str) {
  // TextEncoder → Uint8Array → latin-1 string → btoa.
  // Chunked to avoid call-stack overflow on large code strings.
  const bytes = new TextEncoder().encode(str);
  let binString = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binString += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binString);
}

async function githubErrorMessage(resp) {
  try {
    const data = await resp.json();
    return data.message || JSON.stringify(data);
  } catch {
    return `HTTP ${resp.status}`;
  }
}

async function syncNoteToGithub(titleSlug, force = false) {
  const settings = await getGithubSettings();
  if (!force && !settings.autoSync) return { ok: false, error: "Auto-sync disabled" };
  if (!settings.pat || !settings.repo) {
    return { ok: false, error: "GitHub integration not configured" };
  }

  const notes = await getAllNotes();
  const note = notes[titleSlug];
  if (!note) return { ok: false, error: "Note not found" };

  const path = getNotePath(note);
  const url = `https://api.github.com/repos/${settings.repo}/contents/${path}`;
  const headers = {
    "Authorization": `Bearer ${settings.pat}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    // 1. Get existing file SHA (required to update an existing file).
    let sha = null;
    const getResp = await fetch(`${url}?ref=${encodeURIComponent(settings.branch)}`, { headers });
    if (getResp.ok) {
      const data = await getResp.json();
      sha = data.sha;
    } else if (getResp.status === 401) {
      throw new Error("Unauthorized — check your PAT has 'contents:write' permission.");
    } else if (getResp.status === 403) {
      throw new Error("Forbidden — your PAT doesn't have write access to this repository.");
    } else if (getResp.status !== 404) {
      const msg = await githubErrorMessage(getResp);
      throw new Error(`GitHub GET ${getResp.status}: ${msg}`);
    }

    // 2. Upload the Markdown file.
    const markdownContent = buildMarkdownContent(note);
    const body = {
      message: `sync: ${note.title} [o1-notes]`,
      content: toBase64(markdownContent),
      branch: settings.branch,
    };
    if (sha) body.sha = sha;

    const putResp = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!putResp.ok) {
      const msg = await githubErrorMessage(putResp);
      if (putResp.status === 401) throw new Error("Unauthorized — check your PAT.");
      if (putResp.status === 403) throw new Error("Forbidden — PAT lacks write access.");
      if (putResp.status === 422) throw new Error(`Unprocessable: ${msg} — SHA mismatch or branch doesn't exist.`);
      throw new Error(`GitHub PUT ${putResp.status}: ${msg}`);
    }

    // 3. Persist sync state — record the sync timestamp so the popup
    //    can compare it against lastModifiedAt to derive push-button state.
    const syncedAt = new Date().toISOString();
    notes[titleSlug] = {
      ...note,
      githubSyncedAt: syncedAt,
      githubSyncError: null,
      githubPath: path,
      lastModifiedAt: syncedAt, // mark as up-to-date at this moment
    };
    await chrome.storage.local.set({ notes });
    chrome.runtime.sendMessage({ type: "NOTES_UPDATED" }).catch(() => {});
    return { ok: true, path };

  } catch (err) {
    console.error("[O(1) Notes] GitHub sync failed:", err);
    notes[titleSlug] = { ...note, githubSyncError: err.message };
    await chrome.storage.local.set({ notes });
    chrome.runtime.sendMessage({ type: "NOTES_UPDATED" }).catch(() => {});
    return { ok: false, error: err.message };
  }
}

// ── Bulk sync with live progress tracking ──

async function syncAllNotesToGithub() {
  const settings = await getGithubSettings();
  if (!settings.pat || !settings.repo) {
    return { ok: false, error: "GitHub integration not configured" };
  }

  const notes = await getAllNotes();
  const slugs = Object.keys(notes);

  if (slugs.length === 0) {
    await chrome.storage.local.remove("githubSyncProgress");
    return { ok: true, successCount: 0, failCount: 0 };
  }

  const progress = {
    inProgress: true,
    total: slugs.length,
    currentIndex: 0,
    currentTitle: "",
    successCount: 0,
    failCount: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
  };
  await chrome.storage.local.set({ githubSyncProgress: { ...progress } });
  chrome.runtime.sendMessage({ type: "SYNC_PROGRESS", progress: { ...progress } }).catch(() => {});

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const freshNotes = await getAllNotes();
    const note = freshNotes[slug];

    progress.currentIndex = i + 1;
    progress.currentTitle = note?.title || slug;
    await chrome.storage.local.set({ githubSyncProgress: { ...progress } });
    chrome.runtime.sendMessage({ type: "SYNC_PROGRESS", progress: { ...progress } }).catch(() => {});

    const res = await syncNoteToGithub(slug, true);
    if (res.ok) {
      progress.successCount++;
    } else {
      progress.failCount++;
      progress.lastError = res.error;
    }

    // Throttle writes — GitHub secondary rate limit is ~100 write req/min.
    await new Promise(r => setTimeout(r, 350));
  }

  progress.inProgress = false;
  progress.finishedAt = new Date().toISOString();
  await chrome.storage.local.set({ githubSyncProgress: { ...progress } });
  chrome.runtime.sendMessage({ type: "SYNC_PROGRESS", progress: { ...progress } }).catch(() => {});

  return { ok: true, successCount: progress.successCount, failCount: progress.failCount };
}

async function testGithub(settings) {
  if (!settings.pat) return { ok: false, error: "No Personal Access Token provided." };
  if (!settings.repo || !settings.repo.includes("/")) {
    return { ok: false, error: "Invalid repository format. Use owner/repo." };
  }

  const url = `https://api.github.com/repos/${settings.repo}`;
  const headers = {
    "Authorization": `Bearer ${settings.pat}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const resp = await fetch(url, { headers });
    if (resp.ok) {
      const data = await resp.json();
      const canPush = !data.permissions || data.permissions.push;
      if (!canPush) {
        return { ok: false, error: "Repository found but your token lacks write (push) access." };
      }
      return { ok: true };
    }
    const msg = await githubErrorMessage(resp);
    if (resp.status === 401) return { ok: false, error: "Unauthorized — PAT is invalid or expired." };
    if (resp.status === 404) return { ok: false, error: "Repository not found — check owner/repo and that your PAT can access it." };
    return { ok: false, error: `GitHub ${resp.status}: ${msg}` };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

// ── main message handler ──

async function handleProblemAccepted(payload) {
  const settings = await getSettings();
  const notes = await getAllNotes();
  const existing = notes[payload.titleSlug];

  // Skip if we already have an AI-generated note for this exact code submission.
  if (existing && existing.code === payload.code && existing.generated) {
    return;
  }

  let aiFields = fallbackNoteFields();
  let generated = false;
  let aiError = null;

  const providerDef = self.LCProviders.PROVIDERS[settings.provider];
  const hasWhatItNeeds = providerDef && (!providerDef.needsApiKey || settings.apiKey);

  if (settings.autoGenerate && hasWhatItNeeds) {
    try {
      aiFields = await self.LCProviders.generateNote(payload, settings);
      generated = true;
    } catch (err) {
      aiError = err.message;
      console.warn("[O(1) Notes] AI generation failed:", err);
    }
  }

  const note = {
    titleSlug: payload.titleSlug,
    title: payload.title,
    difficulty: payload.difficulty,
    tags: payload.tags,
    language: payload.language,
    code: payload.code,
    url: payload.url,
    question: payload.question,
    testcases: payload.testcases,
    solvedAt: existing ? existing.solvedAt : payload.solvedAt,
    lastSolvedAt: payload.solvedAt,
    lastModifiedAt: payload.solvedAt, // changes each time code changes
    attempts: existing ? (existing.attempts || 1) + 1 : 1,
    generated,
    generatedBy: generated ? `${settings.provider}:${settings.model}` : existing?.generatedBy || null,
    aiError,
    ...aiFields,
    userEdited: existing && existing.code === payload.code ? existing.userEdited : false,
  };

  // Never silently overwrite manual edits for the same code.
  if (existing && existing.userEdited && existing.code === payload.code) {
    notes[payload.titleSlug] = { ...existing, lastSolvedAt: payload.solvedAt, attempts: note.attempts };
  } else {
    notes[payload.titleSlug] = note;
  }

  await chrome.storage.local.set({ notes });
  updateBadge(notes);

  const githubSettings = await getGithubSettings();
  if (githubSettings.autoSync) {
    syncNoteToGithub(payload.titleSlug).catch(err => console.error("Auto-sync error:", err));
  }

  chrome.runtime.sendMessage({ type: "NOTES_UPDATED" }).catch(() => {});
}

function updateBadge(notes) {
  const count = Object.keys(notes).length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#FFA116" });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "PROBLEM_ACCEPTED") {
    handleProblemAccepted(msg.payload);
    // No async response needed; popup is notified via NOTES_UPDATED.
  } else if (msg.type === "REGENERATE_NOTE") {
    regenerateNote(msg.titleSlug).then(sendResponse);
    return true;
  } else if (msg.type === "TEST_PROVIDER") {
    testProvider(msg.settings).then(sendResponse);
    return true;
  } else if (msg.type === "TEST_GITHUB") {
    testGithub(msg.settings).then(sendResponse);
    return true;
  } else if (msg.type === "SYNC_NOTE") {
    syncNoteToGithub(msg.titleSlug, msg.force !== false).then(sendResponse);
    return true;
  } else if (msg.type === "SYNC_ALL_NOTES") {
    syncAllNotesToGithub().then(sendResponse);
    return true;
  }
});

async function regenerateNote(titleSlug) {
  const settings = await getSettings();
  const notes = await getAllNotes();
  const existing = notes[titleSlug];
  if (!existing) return { ok: false, error: "Note not found" };

  const providerDef = self.LCProviders.PROVIDERS[settings.provider];
  if (providerDef?.needsApiKey && !settings.apiKey) {
    return { ok: false, error: `No API key set for ${providerDef.label}` };
  }

  try {
    const aiFields = await self.LCProviders.generateNote(existing, settings);
    const now = new Date().toISOString();
    notes[titleSlug] = {
      ...existing,
      ...aiFields,
      generated: true,
      generatedBy: `${settings.provider}:${settings.model}`,
      aiError: null,
      userEdited: false,
      lastModifiedAt: now,
    };
    await chrome.storage.local.set({ notes });

    const githubSettings = await getGithubSettings();
    if (githubSettings.autoSync) {
      syncNoteToGithub(titleSlug).catch(err => console.error("Auto-sync error:", err));
    }

    return { ok: true, note: notes[titleSlug] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function testProvider(overrideSettings) {
  const settings = { ...(await getSettings()), ...overrideSettings };
  const samplePayload = {
    title: "Two Sum",
    difficulty: "Easy",
    tags: ["Array", "Hash Table"],
    language: "Python",
    code: "def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i",
  };
  try {
    await self.LCProviders.generateNote(samplePayload, settings);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Initialize badge count on startup and install.
chrome.runtime.onStartup.addListener(async () => {
  const notes = await getAllNotes();
  updateBadge(notes);
});
chrome.runtime.onInstalled.addListener(async () => {
  const notes = await getAllNotes();
  updateBadge(notes);
});
