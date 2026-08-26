// content.js
// Runs on every leetcode.com/problems/* page.
// Detects an "Accepted" submission, collects problem metadata and submitted
// code, then sends it to the background service worker to generate a note.

(function () {
  "use strict";

  let lastHandledSignature = null;
  let lastSubmittedCode = "";

  // Inject page-inject.js via <script src="..."> into the page's MAIN world.
  // CSP-safe: LeetCode's CSP blocks unsafe-inline but allows scripts from the
  // chrome-extension:// origin of this extension.
  (function injectPageScript() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content/page-inject.js");
    script.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
  })();

  // Receive the code captured by the fetch interceptor in page-inject.js.
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    if (e.data && e.data.type === "LC_NOTES_SUBMITTED_CODE") {
      lastSubmittedCode = e.data.code;
    }
  });

  // ── DOM helpers ──

  function getTitleSlugFromUrl() {
    const m = window.location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  function getDifficulty() {
    const candidates = Array.from(document.querySelectorAll("div, span"));
    for (const el of candidates) {
      const text = el.textContent?.trim();
      if (text === "Easy" || text === "Medium" || text === "Hard") {
        if (el.children.length === 0) return text;
      }
    }
    return "Unknown";
  }

  function getProblemTitle() {
    const t = document.title.replace(/\s*-\s*LeetCode\s*$/i, "").trim();
    if (t) return t;
    const anchor = document.querySelector("a[href*='/problems/']");
    return anchor ? anchor.textContent.trim() : "Unknown Problem";
  }

  function getTopicTags() {
    const tags = new Set();
    const tagLinks = document.querySelectorAll("a[href*='/tag/'], a[href*='/topic/']");
    tagLinks.forEach((el) => {
      const text = el.textContent.trim();
      if (text && text.length < 40) tags.add(text);
    });
    return Array.from(tags);
  }

  function getLanguage() {
    const langButton = document.querySelector("button[id*='lang'], button[class*='language']");
    if (langButton) return langButton.textContent.trim();
    return "Unknown";
  }

  function getCodeFromMonacoDOM() {
    // Fallback: read .view-line elements sorted by vertical position.
    // Monaco uses absolute positioning, so DOM order !== visual order.
    const editor = document.querySelector(".monaco-editor");
    if (!editor) return "";
    const lines = Array.from(editor.querySelectorAll(".view-line"));
    lines.sort((a, b) => {
      const topA = parseFloat(a.style.top) || a.offsetTop || 0;
      const topB = parseFloat(b.style.top) || b.offsetTop || 0;
      return topA - topB;
    });
    return lines.map((l) => l.textContent).join("\n");
  }

  function getQuestion() {
    const descEl = document.querySelector('[data-track-load="description_content"]');
    if (descEl) return descEl.innerText.trim();
    // fallback
    const fallback = document.querySelector('meta[name="description"]');
    if (fallback) return fallback.content.trim();
    return "Question description not found.";
  }

  function getTestCases() {
    const preTags = document.querySelectorAll('[data-track-load="description_content"] pre');
    if (preTags.length > 0) {
      return Array.from(preTags).map((pre, i) => `Case ${i + 1}:\n${pre.innerText.trim()}`).join('\n\n');
    }
    return "Test cases not found.";
  }

  function getSubmittedCode() {
    if (lastSubmittedCode) return Promise.resolve(lastSubmittedCode);

    return new Promise((resolve) => {
      let resolved = false;

      const listener = (event) => {
        if (event.source !== window) return;
        if (event.data && event.data.type === "LC_NOTES_CODE_RES") {
          if (resolved) return;
          resolved = true;
          window.removeEventListener("message", listener);
          resolve(event.data.code || getCodeFromMonacoDOM());
        }
      };
      window.addEventListener("message", listener);

      window.postMessage({ type: "LC_NOTES_GET_CODE" }, window.location.origin);

      // Fall back to DOM scraping if page-inject.js doesn't respond in time.
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener("message", listener);
        resolve(getCodeFromMonacoDOM());
      }, 500);
    });
  }

  async function extractProblemPayload() {
    return {
      titleSlug: getTitleSlugFromUrl(),
      title: getProblemTitle(),
      difficulty: getDifficulty(),
      tags: getTopicTags(),
      language: getLanguage(),
      code: await getSubmittedCode(),
      url: window.location.href.split("?")[0],
      solvedAt: new Date().toISOString(),
      question: getQuestion(),
      testcases: getTestCases(),
    };
  }

  function isAcceptedVisible() {
    const nodes = document.querySelectorAll("span, div");
    for (const el of nodes) {
      if (el.children.length > 0) continue;
      if (el.textContent.trim() === "Accepted") return true;
    }
    return false;
  }

  let isExtracting = false;
  let awaitingSubmitResult = false;

  async function handlePotentialAccept() {
    if (!awaitingSubmitResult) return;
    if (!isAcceptedVisible()) return;
    if (isExtracting) return;

    const slug = getTitleSlugFromUrl();
    if (!slug || slug === lastHandledSignature) return;

    isExtracting = true;
    try {
      const payload = await extractProblemPayload();
      if (!payload.titleSlug || !payload.code) return;

      lastHandledSignature = payload.titleSlug;
      awaitingSubmitResult = false;

      chrome.runtime.sendMessage({ type: "PROBLEM_ACCEPTED", payload }).catch(() => {});
    } finally {
      isExtracting = false;
    }
  }

  function markSubmitIntent() {
    lastHandledSignature = null;
    awaitingSubmitResult = true;
  }

  function clearSubmitIntent() {
    awaitingSubmitResult = false;
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) {
      const text = btn.textContent?.trim() || "";
      const locator = btn.getAttribute("data-e2e-locator");
      if (text === "Submit" || locator === "console-submit-button") {
        markSubmitIntent();
      } else if (text === "Run" || text === "Run Code" || locator === "console-run-button") {
        clearSubmitIntent();
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      markSubmitIntent();
    } else if (e.key === "'" && (e.ctrlKey || e.metaKey)) {
      clearSubmitIntent();
    }
  });

  const observer = new MutationObserver(() => {
    handlePotentialAccept();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Periodic fallback in case MutationObserver timing misses the result panel.
  setInterval(handlePotentialAccept, 1500);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GET_CURRENT_PROBLEM") {
      extractProblemPayload().then(sendResponse);
      return true;
    }
  });
})();
