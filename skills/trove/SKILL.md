---
name: trove
description: Save links or any content to the user's Trove library (a Raindrop-style read-later + archive stored in Notion) and search what they saved. Use when the user shares a link or a piece of content to keep — "save this", "bookmark", "read later", "add to Trove", "remember this article/video/post", or just sends a bare URL with no other request — or asks to find, list, tag, organize or re-read something they saved. Not for: browsing or summarizing a link the user doesn't want saved, or for files on disk.
---

# Trove

Trove (https://trove.mariomedpar.com) is the user's personal library. Saving a URL archives the content itself (article text, YouTube description + transcript, X/Reddit/Bluesky/Mastodon posts with media, GitHub README, arXiv abstract + PDF), so it survives if the original is deleted. Saving the same URL again never duplicates — it merges tags and notes.

## How to call it

Prefer the **`trove` MCP server** tools when they are available:
`save`, `save_many`, `search`, `get_item`, `update_item`, `add_highlight`, `check_saved`, `list_collections`, `list_tags`, `rename`, `delete_item`.

Without MCP, use the REST API with the key in `$TROVE_API_KEY` (never print it):

```bash
# save a link (or {"text": "..."} for a note)
curl -sS -X POST https://trove.mariomedpar.com/api/items \
  -H "Authorization: Bearer $TROVE_API_KEY" -H "content-type: application/json" \
  -d '{"url":"https://example.com/post","tags":["ai"],"collection":"Research","note":"why it matters"}'

# search (same syntax as the app)
curl -sS "https://trove.mariomedpar.com/api/items?q=%23ai+type:article&limit=10" -H "Authorization: Bearer $TROVE_API_KEY"

# full archived content of one item (Markdown)
curl -sS "https://trove.mariomedpar.com/api/items/ITEM_ID?content=1" -H "Authorization: Bearer $TROVE_API_KEY"
```

Full reference: https://trove.mariomedpar.com/llms.txt and /openapi.json.

## Rules

1. **Bare link or "save this" → save it immediately.** Don't ask for confirmation. Pass along any context the user gave as `note`.
2. **Tags:** reuse existing ones (`list_tags`) before inventing new ones; at most 5, lowercase, short. Only add tags/collection when the user asked or it's obvious from their words.
3. **Collections** are single per item and can be nested with `/` (e.g. `Dev/AI`). Prefer existing collections (`list_collections`).
4. **Several links at once** → `save_many` (max 25 per call).
5. **Search syntax:** words, `"exact phrase"`, `-exclude`, `#tag`, `-#tag`, `type:article|video|post|repo|note|paper|image|document`, `site:github.com`, `collection:"Name"`, `is:fav`, `is:unread`, `created:>2025-01`, `highlights:true`, `source:x` (X bookmarks), `match:OR`.
6. **Answer from the archive:** to summarize or quote something saved, call `get_item` and use its content instead of re-fetching the web.
7. **Report what the tool confirmed:** title + whether it was new or already saved + the Trove link `https://trove.mariomedpar.com/?item=<id>`. Never claim a save that returned an error.
8. **Deleting** only on explicit request (it moves the item to Notion's trash).
