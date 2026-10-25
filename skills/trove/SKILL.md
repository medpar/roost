---
name: trove
description: Save links or any content to the user's Trove library (a Raindrop-style read-later and archive stored in Notion) and search what they saved. Use when the user shares a link or a piece of content to keep ("save this", "bookmark", "read later", "add to Trove", "remember this article/video/post", or a bare URL with no other request), or asks to find, list, tag, organize or re-read something they saved. Not for browsing or summarizing a link the user doesn't want saved, or for files on disk.
---

# Trove

Trove is the user's personal library. Saving a URL archives the content itself (article text, YouTube description and transcript, X/Reddit/Bluesky/Mastodon posts with media, GitHub README, arXiv abstract and PDF), so it survives if the original disappears. Saving the same URL again never duplicates; it merges tags and notes.

## How to call it

Use the **`trove` CLI** (install once with `npm install -g github:medpar/trove`, then `trove login --key <key>`; it reads `TROVE_URL` and `TROVE_API_KEY` too). Add `--json` whenever you need to read the output.

```bash
trove save https://example.com/post -t ai,research -c "Research" -n "why it matters" --json
trove save https://a.com https://b.com --json        # several links, one item each
echo "a thought worth keeping" | trove save --json   # a note
trove search '#ai type:article' -l 10 --json
trove search --untagged -l 50 --json                 # also: --unsorted, --source x, -c "Collection"
trove get <id> --content --json                      # item + archived Markdown
trove update <id> [<id>…] --add-tags ai -c "Dev/AI" --read --json
trove check https://example.com/post --json          # already saved?
trove tags --json ; trove collections --json
trove rename tag ml machine-learning
```

Without the CLI, use the REST API with the same key (never print it):

```bash
curl -sS -X POST "$TROVE_URL/api/items" -H "Authorization: Bearer $TROVE_API_KEY" -H "content-type: application/json" \
  -d '{"url":"https://example.com/post","tags":["ai"],"collection":"Research","note":"why it matters"}'
curl -sS "$TROVE_URL/api/items?q=%23ai+type:article&limit=10" -H "Authorization: Bearer $TROVE_API_KEY"
curl -sS "$TROVE_URL/api/items/ITEM_ID?content=1" -H "Authorization: Bearer $TROVE_API_KEY"
```

Full reference: `$TROVE_URL/llms.txt` and `$TROVE_URL/openapi.json`. An MCP server is also available at `$TROVE_URL/api/mcp` for clients that prefer MCP.

## Rules

1. **Bare link or "save this": save it right away.** Don't ask for confirmation. Pass any context the user gave as the note.
2. **Tags:** reuse existing ones (`trove tags --json`) before inventing new ones; at most 5, lowercase, short. Only add tags or a collection when the user asked or it is obvious from their words.
3. **Collections** are one per item and can be nested with `/` (for example `Dev/AI`). Prefer existing collections.
4. **Search syntax:** words, `"exact phrase"`, `-exclude`, `#tag`, `-#tag`, `type:article|video|post|x|repo|note|paper|image|document` (`type:x` = X bookmarks), `site:github.com`, `collection:"Name"`, `is:fav`, `is:unread`, `created:>2025-01`, `highlights:true`, `match:OR`.
5. **Answer from the archive:** to summarize or quote something saved, read it with `trove get <id> --content` instead of fetching the web again.
6. **Report what the command confirmed:** the title, whether it was new or already saved, and the link `$TROVE_URL/?item=<id>`. Never claim a save that returned an error.
7. **Delete** only on an explicit request (`trove rm <id>` moves it to Notion's trash).
