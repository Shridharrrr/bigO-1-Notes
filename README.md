# LeetCode Auto Notes

A browser extension that automatically generates study notes after you solve a LeetCode problem — approach, time/space complexity, key insight, and pitfalls — grouped by topic tag. Notes are AI-generated using your choice of Gemini, OpenAI, Anthropic, or a local Ollama model, and are fully editable afterward.

---

## How it works

1. You solve a problem on `leetcode.com` and get an **Accepted** result.
2. The extension detects this, pulls the problem title, difficulty, topic tags, and your submitted code from the page.
3. It sends that to your configured AI provider, which returns: approach, time complexity, space complexity, key insight, and a pitfalls/edge-case note.
4. The note is saved automatically and grouped in the popup by LeetCode's own topic tags.
5. Click any problem row to view, **edit**, regenerate, or delete its note.

If you solve the same problem multiple times, the attempt count increases and the note is only regenerated if your code changed (manual edits are never silently overwritten).

---

## Install (Brave / Chrome / any Chromium browser)

1. Download or clone this repository somewhere permanent — the browser loads the extension live from this folder, so don't delete it after installing.
2. Open `brave://extensions` (or `chrome://extensions`).
3. Toggle **Developer mode** on (top-right corner).
4. Click **Load unpacked**.
5. Select the `leetcode-notes` folder (the one containing `manifest.json`).
6. The extension icon (notes icon) appears in your toolbar. Pin it for easy access.

---

## AI provider setup

The extension supports four providers — pick whichever you already have access to:

| Provider | API key needed? | Default model | Get a key |
|---|---|---|---|
| Google Gemini | Yes | `gemini-2.5-flash` | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| OpenAI | Yes | `gpt-5.5` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic (Claude) | Yes | `claude-sonnet-4-6` | [console.anthropic.com](https://console.anthropic.com/) |
| Ollama (local) | No | `llama3` | [ollama.com](https://ollama.com/) |

Steps:

1. Click the extension icon → **Settings** tab.
2. Choose a provider from the dropdown.
3. Enter a model name (a default fills in automatically — change it if you want a different model, e.g. `gpt-5.5-mini`).
4. For Gemini / OpenAI / Anthropic: paste your API key.  
   For Ollama: make sure `ollama serve` is running, then confirm the server URL (default `http://localhost:11434` is usually correct).
5. Click **Test connection** to verify it works.
6. Click **Save settings**.
7. Solve a problem on LeetCode. Once you see "Accepted," wait a couple of seconds, then open the popup — your note should appear under the relevant topic group.

> **Ollama note:** Ollama blocks requests from unrecognized origins by default. Start it with `OLLAMA_ORIGINS=* ollama serve` (fine for local personal use). If "Test connection" fails with a CORS-looking error, this is almost always why.

Without a working provider the extension still captures every accepted problem (title, code, tags, difficulty) — you'll just need to fill in the approach/complexity fields yourself in the edit modal.

---

## GitHub sync

You can push your notes as Markdown files to a GitHub repository. Each note is saved at `problems/<tag>/<problem-slug>.md` with YAML front matter (title, difficulty, tags, language, solve date, attempt count) and a full code block.

### One-time setup

1. **Create a GitHub Personal Access Token (PAT)**
   - Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**.
   - Give it a descriptive name (e.g. `leetcode-notes`).
   - Under **Scopes**, tick **`repo`** (or at minimum **`contents:write`** on a fine-grained token).
   - Click **Generate token** and copy it immediately — you won't see it again.

2. **Create a destination repository**
   - Create a new (or use an existing) GitHub repo where notes will be stored, e.g. `your-username/leetcode-notes`.
   - The branch you target (default: `main`) must already exist.

3. **Configure the extension**
   - Open the popup → **Settings** tab → scroll to **GitHub Sync**.
   - Paste your PAT into **Personal Access Token**.
   - Enter the repo in `owner/repo` format (e.g. `your-username/leetcode-notes`). You can also paste a full GitHub URL — the extension normalises it automatically.
   - Set the **Branch** (default: `main`).
   - Click **Save settings**, then **Test connection** to confirm the token and repo are valid.

### Pushing notes

| Action | How |
|---|---|
| **Auto-push on solve** | Enable **"Push notes to GitHub automatically"** in the GitHub Sync card. Every accepted problem is pushed immediately after the note is generated. |
| **Push one note** | Open a note from the Notes tab → click **Push to GitHub** in the modal footer. |
| **Push all notes** | Settings → GitHub Sync → **Push all notes to GitHub**. A live progress bar tracks each upload. You can close the popup mid-sync — the background worker continues and the popup restores progress when reopened. |

### Resulting file structure

```
problems/
  array/
    two-sum.md
    best-time-to-buy-and-sell-stock.md
  dynamic-programming/
    climbing-stairs.md
  ...
```

Each file looks like:

```markdown
---
title: "Two Sum"
difficulty: Easy
tags: ["Array", "Hash Table"]
language: python
solved_at: 2026-06-30T12:00:00.000Z
attempts: 1
leetcode_url: https://leetcode.com/problems/two-sum/
---

# Two Sum

**Difficulty:** Easy  
**Tags:** Array, Hash Table

## Approach
Use a hash map to store each number's index as you iterate...

## Complexity
- Time: O(n)
- Space: O(n)

## Key Insight
A single pass is enough — check the complement before inserting.

## Pitfalls / Edge Cases
Watch out for using the same element twice (e.g. target = 6, nums = [3, 3]).

## Code
```python
def twoSum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
```
```

### Troubleshooting

| Error | Fix |
|---|---|
| `Unauthorized` | PAT is invalid, expired, or copied with extra whitespace. |
| `Repository not found` | Check the `owner/repo` value and that the PAT has access to that repo. |
| `Forbidden` | Token doesn't have `contents:write` (or `repo`) scope. |
| `Unprocessable` / SHA mismatch | Extremely rare — usually resolves if you retry immediately. |
| CORS error on Test connection | Unlikely for GitHub (unlike Ollama). Check your network/proxy. |

---

## Using the popup

- **Notes tab**: your problems, grouped. Default sort is "Most recent" (flat list); switch to "By topic" for the tag-grouped accordion, or "By difficulty."
- **Search bar**: filters by problem title or tag name.
- **Click a problem row** → opens the note in an editable panel. Rewrite any field and hit **Save note** — manual edits are preserved and won't be overwritten by future auto-generation for the same code.
- **↻ Regenerate**: re-runs AI on that problem (overwrites AI fields).
- **Open**: jumps back to the LeetCode problem page.
- **Settings → Export notes**: downloads all notes as a `.json` file (good backup before clearing browser data).

---

## Where your data lives

- **Notes** (problem details + AI text): `chrome.storage.local` — stays on this device only. Notes can be larger than the 8 KB-per-item `storage.sync` limit, so they are stored locally.
- **Settings** (provider, model, API key, GitHub PAT): `chrome.storage.sync` — follows you across devices signed into the same browser profile. Your API key and PAT sync with your profile — only use this if you're comfortable with that, or use Ollama (no key) if not.

To move notes to another device, use **Export** on one device and import the `.json` manually (or ask for an Import button to be added — see below).

---

## Limitations

- Detection relies on reading the LeetCode page DOM (looking for the "Accepted" label and reading the code editor). If LeetCode redesigns its page, the selectors in `content/content.js` may need updating.
- Topic tags are scraped from the tag links shown on the problem page — no separate tag database needed.
- API calls go directly from your browser to the provider using your key — nothing routes through a third-party server. Ollama calls go to your own machine.
- Model names move fast — the defaults are current as of mid-2026, but the model field is free-text so you can type any string your provider supports.
- The badge count on the toolbar icon shows total problems with notes.

---

## Possible additions

- **Import button** — load an exported `.json` back in (e.g. after switching computers).
- **Streak / stats view** — problems solved per week, easy/medium/hard breakdown.
- **Spaced-repetition reminders** — surface a problem again after N days for review.
- **Per-note provider override** — pick a different model for one regeneration without changing global settings.
