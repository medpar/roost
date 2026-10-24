<p align="center"><img src="docs/icon.png" width="96" alt="Roost logo"></p>

<h1 align="center">Roost</h1>

<p align="center"><b>Your X (Twitter) bookmarks, archived in Notion — threads, media and all.</b><br>
Free, local, no API keys, no servers. If a post gets deleted, you still have it.</p>

<p align="center">
  <a href="https://github.com/medpar/roost/releases/latest">Download</a> ·
  <a href="https://medpar.github.io/roost/">Website</a> ·
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a>
</p>

---

Roost is a tiny Brave / Chrome extension (≈130 KB, zero dependencies, no build step). It syncs every post you bookmark on X into a Notion database, with the full text, author, stats, links, polls, quoted posts, whole threads, and **copies of the photos and videos stored in Notion**, so nothing disappears when the original does.

## Features

- **Full backfill** — walks your entire bookmark list once (resumable, survives browser restarts and rate limits).
- **Automatic sync** — checks every 30 min (configurable), and archives a post **within seconds of you bookmarking it** on x.com.
- **Deletion-proof archive** — text, author, metrics, links and media are copied into Notion. Media is imported by Notion's servers (`external_url` uploads), so the extension never downloads files.
- **Threads** — detects threads and unrolls the author's whole chain (following X's "show more" pages). Tick **Unroll thread** on any row in Notion to fetch one later.
- **Reply context** — replies keep the post they answer.
- **Rich pages** — long posts, X Articles, polls with results, link cards, quote posts with their media, community notes, alt text, and an optional raw-JSON copy.
- **No duplicates, ever** — one page per post, enforced by a local index that is rebuilt from Notion on a new browser.
- **Save anything** — right-click any post → *Save post to Notion*, the popup's *Save this post*, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>. Works for posts you didn't bookmark too.
- **Auto-tags** — rules like `AI: openai, @karpathy, arxiv.org, /gpt-?\d/i, type:Thread`.
- **Notion views** — Gallery, Unread, Threads and Media views are created for you; there's a **Read** checkbox for a reading-list workflow.
- **Optional inbox zero** — remove posts from your X bookmarks once they're safely archived (off by default).

### What goes into Notion

| Column | | Column | |
|---|---|---|---|
| Title | first line / article title | Posted · Bookmarked · Saved | dates |
| Author · Handle · Verified · Followers | who wrote it | Likes · Reposts · Replies · Quotes · Bookmarks · Views | snapshot at save time |
| Text | full text (whole thread, quoted post) | Type | Text, Photo, Video, GIF, Link, Quote, Reply, Thread, Article, Poll, Long post |
| URL · Post ID | original post | Media | original media links |
| Links · Link · Hashtags · Mentions | entities | Quoted post · Reply to | related posts |
| Tags · Read · Unroll thread | your workflow | Language · Client · Source | metadata |

The page body holds the readable post: author line, text with live links, archived photos/videos, link cards, polls, quote posts, reply context, the full thread, stats and a collapsed raw-data block.

## Install

1. Download `roost-vX.Y.Z.zip` from the [latest release](https://github.com/medpar/roost/releases/latest) and unzip it (or clone this repo and use the `extension/` folder).
2. Open `brave://extensions` (or `chrome://extensions`), enable **Developer mode**, click **Load unpacked** and pick the folder.
3. Make sure you're logged in to x.com in the same browser.
4. Connect Notion in the settings page that opens:
   - create a free internal integration at [notion.so/profile/integrations](https://www.notion.so/profile/integrations) and paste its secret,
   - share a page with it (••• → Connections), then **Create new database…** and pick that page. Or connect an existing database.

The full archive starts immediately. Watch progress in the toolbar popup.

### Shortcut for Notion CLI users

If you use the [`ntn`](https://developers.notion.com) CLI, one command creates the database (top-level, with views) and pre-connects the extension through a git-ignored `extension/config.local.json`:

```bash
node scripts/setup-notion.mjs
```

Then load the `extension/` folder. Options: `--parent <page url>`, `--database <existing db url>`, `--title "X Bookmarks"`, or `NOTION_TOKEN=…` to use another token.

## How it works

X's official API charges for bookmarks, so Roost uses the same private web API x.com itself uses, with your logged-in session:

- **Learns, doesn't guess.** X rotates query IDs, feature flags and an `x-client-transaction-id` header bound to each endpoint. Roost passively records the request templates your own x.com tabs send (via `webRequest`, no content scripts) and replays them from the service worker with your cookies. It also reads current query IDs and feature names straight from x.com's own JS bundle (cached for a day). Only if neither works does it open x.com in a background tab for a few seconds to learn the request.
- **Self-healing.** Missing feature flags reported by X are added automatically; stale templates are re-learned; rate limits pause and resume on their own.
- **Light on resources.** An MV3 service worker that sleeps between alarms — no background page, no polling loops, no content scripts injected into x.com. Media goes straight from X's CDN to Notion.
- **Safe writes.** A page is never created twice: a local id index (rebuilt from Notion when needed), in-flight guards, non-retried page creation, and a duplicate check before every retry. If Notion rejects some content, Roost falls back to a simpler version instead of skipping the post.

### Privacy

Everything runs in your browser. Roost talks only to `x.com` (your session) and `api.notion.com` (your token). No analytics, no third-party servers. Your Notion token is stored in the extension's local storage.

### Limits

- X rate limits apply (Roost backs off automatically; a large backfill can take a while).
- X may cap how far back the bookmark timeline goes; Roost archives everything X returns.
- Media files larger than your Notion plan's upload limit are linked instead of copied (videos pick the best quality that fits the size cap in settings).

## Development

```bash
npm test                        # parser, renderer, Notion limits, end-to-end sync against mocks
node scripts/live-check.mjs     # smoke test against the real Notion API (temporary database, then trashed)
node scripts/package.mjs        # dist/roost-vX.Y.Z.zip
node scripts/make-icons.mjs     # regenerate icons
node scripts/import-export.mjs export.json [threads.json]   # bulk-import an exported bookmark list with the extension's pipeline
```

```
extension/
  background.js    service worker: alarms, menus, shortcut, badge, messages
  lib/x.js         X web API client (template capture + replay, self-healing)
  lib/parse.js     timeline/thread parsing → normalized posts
  lib/render.js    posts → Notion properties + blocks (respects API limits)
  lib/notion.js    Notion client (rate limiting, retries, server-side media import)
  lib/schema.js    database schema, auto-migration, views
  lib/sync.js      backfill, incremental sync, threads, retries, dedupe
  ui/              popup + settings
```

Releases are built by GitHub Actions when a `v*` tag is pushed.

## License

MIT
