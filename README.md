<p align="center"><img src="docs/icon.png" width="88" alt="Trove logo"></p>

<h1 align="center">Trove</h1>

<p align="center"><b>Save anything, keep everything.</b><br>
A personal, Raindrop-style library that archives what you save — articles, videos, social posts, repos, papers, notes, browser bookmarks and your X bookmarks — into Notion, so nothing is lost when the original disappears.</p>

<p align="center">
  <a href="https://trove.mariomedpar.com">App</a> ·
  <a href="https://github.com/medpar/trove/releases/latest">Extension</a> ·
  <a href="#save-from-everywhere">Capture</a> ·
  <a href="#ai-agents">AI agents</a> ·
  <a href="#self-hosting">Self-host</a>
</p>

---

## What it does

- **Archives the content, not just the link.** Articles are stored as clean text (Readability), YouTube videos with description and transcript, X/Reddit/Bluesky/Mastodon/Hacker News posts with their text and media, GitHub repos with their README, arXiv papers with abstract and the PDF, any PDF or image file. Covers and media are copied into Notion's file storage.
- **Two Notion databases, one library.** `Trove` holds everything you save; `X Bookmarks` is filled automatically by the extension from your X bookmarks (full threads, reply context, media). The web app shows both together.
- **Never a duplicate.** URLs are normalized (tracking params, `www`, mobile hosts, `youtu.be`, `?s=20`, arXiv versions…). Saving again merges tags, notes and highlights instead.
- **Organize like Raindrop.** Nested collections (`Dev/AI`), tags, favorites, read-later, notes, highlights, reminders, broken-link detection, bulk edit, four views (cards, list, headlines, moodboard), keyboard-first UI, light & dark themes.
- **Search with operators:** `"phrase"`, `-word`, `#tag`, `-#tag`, `type:video`, `site:github.com`, `collection:"Dev/AI"`, `is:fav`, `is:unread`, `created:>2025-01`, `highlights:true`, `source:x`, `match:OR`.
- **Free.** Vercel Hobby + your Notion workspace + Cloudflare DNS. No paid APIs.

## Save from everywhere

| Where | How |
|---|---|
| **Web app** (any OS) | Paste a link anywhere (⌘V), drop it on the window, or press <kbd>N</kbd>. Add many links at once, or a plain note. |
| **Brave / Chrome / Edge / Arc** (macOS, Windows, Linux) | The extension: toolbar button, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, right-click page / link / image / **selection → highlight**. It reads the page you're on, so logged-in and paywalled pages are archived too. Imports all browser bookmarks (folders → collections) and can auto-save new ones. Keeps syncing your **X bookmarks** with threads and media. |
| **iPhone, iPad, Mac** | The signed **“Save to Trove” Shortcut** (Share sheet in every app + macOS Share menu / Services). It asks for your API key once. |
| **Android, Windows, ChromeOS** | Install the app (PWA) → it appears in the system share sheet. |
| **Any browser** | Bookmarklet (Settings → drag “＋ Save to Trove”); selected text becomes a highlight. |
| **AI agents & automations** | MCP server, REST API, skill file — see below. |

## AI agents

Trove exposes the same library to every assistant. Each agent gets its own API key, recorded as **Via** on what it saves.

- **MCP (recommended):** `https://trove.mariomedpar.com/api/mcp` (Streamable HTTP, `Authorization: Bearer <key>`). Tools: `save`, `save_many`, `search`, `get_item` (full archived Markdown), `update_item`, `add_highlight`, `check_saved`, `list_collections`, `list_tags`, `rename`, `delete_item`.
  ```bash
  claude mcp add --transport http --scope user trove https://trove.mariomedpar.com/api/mcp --header "Authorization: Bearer $TROVE_API_KEY"
  ```
  ```yaml
  # Hermes Agent: ~/.hermes/config.yaml
  mcp_servers:
    trove:
      url: "https://trove.mariomedpar.com/api/mcp"
      headers:
        Authorization: "Bearer ${TROVE_API_KEY}"
  ```
- **Skill:** [`skills/trove/SKILL.md`](skills/trove/SKILL.md) teaches any skills-aware agent (Claude Code, Hermes, …) when and how to save.
- **REST:** `POST /api/items {url | text, tags, collection, note, highlight}`, `GET /api/items?q=…`, `GET /api/items/:id?content=1`. Docs for agents: [`/llms.txt`](https://trove.mariomedpar.com/llms.txt), [`/openapi.json`](https://trove.mariomedpar.com/openapi.json).

Message your assistant a link (e.g. Hermes on Telegram) and it lands in Trove.

## Architecture

```
web/          Next.js 16 app on Vercel — UI, REST API, MCP server, cron (daily broken-link check)
  lib/extract.ts   URL -> metadata + archived Markdown (Readability, YouTube, FxTwitter, Reddit, Bluesky, Mastodon, HN, GitHub, arXiv, oEmbed)
  lib/store.ts     Notion data layer: both databases, search -> filters, merged pagination, saves, highlights, stats
  app/api/mcp      MCP tools for agents
extension/    Brave/Chrome MV3 extension — save pages/links/images/highlights, browser bookmarks, X bookmarks sync (local, uses your x.com session)
skills/trove/ Agent skill
scripts/      Notion setup, Apple Shortcut builder, icons, live checks
```

- Notion is the database: everything is yours, viewable and editable in Notion (Gallery, Read later, Favorites, Videos, Articles, Notes views are created for you).
- Media is imported by Notion's servers (`external_url` uploads); the browser downloads nothing.
- The X sync runs inside the extension with your own x.com session (no paid X API). See [How the X sync works](#how-the-x-sync-works).

### How the X sync works

X's web API rotates query ids, feature flags and an `x-client-transaction-id`. The extension records the request templates your own x.com tabs send (via `webRequest`, no content scripts) and also reads current query ids from x.com's bundle; it replays them from the service worker with your cookies. Bookmarks are archived within seconds of bookmarking on x.com and every 30 minutes; a full, resumable backfill covers your whole history.

## Self-hosting

1. **Notion:** `node scripts/setup-trove.mjs` creates the library database (uses `NOTION_TOKEN` or the `ntn` CLI login); `node scripts/setup-notion.mjs` creates the X Bookmarks database.
2. **Vercel:** create a project with root directory `web`, and set `NOTION_TOKEN`, `TROVE_LIBRARY_DS`, `TROVE_LIBRARY_DB`, `TROVE_X_DS`, `TROVE_X_DB`, `TROVE_PASSWORD`, `TROVE_SESSION_SECRET`, `TROVE_API_KEYS` (`Name:key,Name:key`), `TROVE_PUBLIC_URL`, `CRON_SECRET`. Deploy.
3. **Extension:** load `extension/` unpacked (or the release zip), then set the app URL + API key in its settings.
4. **Shortcut:** `python3 scripts/make-shortcut.py https://your-app web/public/trove.shortcut` then `shortcuts sign --mode anyone …`.

## Development

```bash
npm test                          # extension + web logic, Notion limits, end-to-end sync against mocks
npm --prefix web run dev          # web app on :3000 (needs web/.env.local)
node scripts/live-check.mjs       # smoke test against the real Notion API
node scripts/package.mjs          # extension zip
```

## License

MIT
