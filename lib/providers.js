// lib/providers.js
// Provider-agnostic AI calling layer.
// Loaded via importScripts in the background service worker, attaches to self.LCProviders.

(function () {
  "use strict";

  const NOTE_JSON_SHAPE = `{
  "approach": "2-4 sentences describing the core idea/algorithm used, in plain language",
  "timeComplexity": "e.g. O(n)",
  "spaceComplexity": "e.g. O(1)",
  "keyInsight": "one sentence: the trick or pattern that makes this solvable",
  "pitfalls": "one sentence on a common mistake or edge case for this problem (or empty string if none)",
  "optimalApproach": "If the user's code is not the most optimal approach (in terms of time/space complexity or code simplicity), describe the best optimal approach here, including any optimal code snippet if relevant. If the user's submission is already the most optimal, leave this string empty."
}`;

  function buildPrompt(payload) {
    return `You are a concise coding-interview tutor. Given a LeetCode problem and a user's accepted solution, write study notes.

Problem: ${payload.title}
Difficulty: ${payload.difficulty}
Topics: ${(payload.tags || []).join(", ") || "Unknown"}
Language: ${payload.language}

Solution code:
\`\`\`
${payload.code}
\`\`\`

Respond ONLY with valid JSON (no markdown fences, no preamble) matching exactly this shape:
${NOTE_JSON_SHAPE}`;
  }

  function stripFences(text) {
    return text.replace(/```json|```/g, "").trim();
  }

  function extractFirstJsonObject(text) {
    // Some local models ignore "JSON only" and wrap the response in prose.
    const match = text.match(/\{[\s\S]*\}/);
    return match ? match[0] : text;
  }

  function parseNoteJson(rawText) {
    const cleaned = stripFences(rawText);
    try {
      return JSON.parse(cleaned);
    } catch {
      return JSON.parse(extractFirstJsonObject(cleaned));
    }
  }

  // ── Gemini ──
  async function callGemini(payload, settings) {
    const model = settings.model || "gemini-3.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;
    const body = {
      contents: [{ parts: [{ text: buildPrompt(payload) }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Gemini error ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content");
    return parseNoteJson(text);
  }

  // ── OpenAI ──
  async function callOpenAI(payload, settings) {
    const model = settings.model || "gpt-5.5";
    const url = "https://api.openai.com/v1/chat/completions";
    const body = {
      model,
      messages: [
        {
          role: "system",
          content:
            "You write concise, structured coding-interview study notes and respond only with valid JSON.",
        },
        { role: "user", content: buildPrompt(payload) },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`OpenAI error ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI returned no content");
    return parseNoteJson(text);
  }

  // ── Anthropic (Claude) ──
  async function callAnthropic(payload, settings) {
    const model = settings.model || "claude-sonnet-4-6";
    const url = "https://api.anthropic.com/v1/messages";
    const body = {
      model,
      max_tokens: 1000,
      messages: [{ role: "user", content: buildPrompt(payload) }],
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(
        `Anthropic error ${resp.status}: ${errText.slice(0, 200)}`,
      );
    }
    const data = await resp.json();
    const text = data?.content?.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no content");
    return parseNoteJson(text);
  }

  // ── Ollama (local) ──
  async function callOllama(payload, settings) {
    const model = settings.model || "llama3";
    const baseUrl = (settings.baseUrl || "http://localhost:11434").replace(
      /\/+$/,
      "",
    );
    const url = `${baseUrl}/api/chat`;
    const body = {
      model,
      messages: [
        {
          role: "system",
          content:
            "You write concise, structured coding-interview study notes and respond only with valid JSON, no markdown fences.",
        },
        { role: "user", content: buildPrompt(payload) },
      ],
      stream: false,
      format: "json",
      options: { temperature: 0.3 },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(
        `Ollama error ${resp.status}: ${errText.slice(0, 200)}. Is "ollama serve" running and OLLAMA_ORIGINS set to allow this extension?`,
      );
    }
    const data = await resp.json();
    const text = data?.message?.content;
    if (!text) throw new Error("Ollama returned no content");
    return parseNoteJson(text);
  }

  // ── dispatch ──
  const PROVIDERS = {
    gemini: {
      label: "Google Gemini",
      call: callGemini,
      defaultModel: "gemini-2.5-flash",
      needsApiKey: true,
      needsBaseUrl: false,
      modelHint: "e.g. gemini-2.5-flash, gemini-3.5-flash",
    },
    openai: {
      label: "OpenAI",
      call: callOpenAI,
      defaultModel: "gpt-5.5",
      needsApiKey: true,
      needsBaseUrl: false,
      modelHint: "e.g. gpt-5.5, gpt-5.5-mini",
    },
    anthropic: {
      label: "Anthropic",
      call: callAnthropic,
      defaultModel: "claude-sonnet-4-6",
      needsApiKey: true,
      needsBaseUrl: false,
      modelHint: "e.g. claude-sonnet-4-6, claude-haiku-4-5",
    },
    ollama: {
      label: "Ollama (local)",
      call: callOllama,
      defaultModel: "llama3",
      needsApiKey: false,
      needsBaseUrl: true,
      modelHint: "e.g. llama3, qwen2.5-coder, deepseek-r1",
    },
  };

  async function generateNote(payload, settings) {
    const provider = PROVIDERS[settings.provider];
    if (!provider) throw new Error(`Unknown provider: ${settings.provider}`);
    if (provider.needsApiKey && !settings.apiKey) {
      throw new Error(`No API key set for ${provider.label}`);
    }
    return provider.call(payload, settings);
  }

  self.LCProviders = { PROVIDERS, generateNote };
})();
