export async function GET(req: Request) {
  const base = (process.env.TROVE_PUBLIC_URL || new URL(req.url).origin).replace(/\/$/, '');
  const body = `# Trove

> A personal library (Raindrop-style read-later and archive, stored in Notion). Agents can save links or any content and search what was saved.

Auth for everything below: \`Authorization: Bearer <TROVE API KEY>\` (ask the user for a key; never print it).

## CLI (simplest for agents that can run commands)
npm install -g github:medpar/trove
trove login --url ${base} --key <key>        # or set TROVE_URL and TROVE_API_KEY
trove save <url|text> [-t tags] [-c Collection] [-n note] --json
trove search "<query>" [-l N] [--unsorted] [--untagged] --json
trove get <id> --content --json
trove update <id…> [--add-tags a,b] [-c Collection] [--read] --json
trove check <url> --json
trove tags --json | trove collections --json
Run \`trove --help\` for everything.

## When you save something
File it without asking: list existing collections and tags first (trove collections --json, trove tags --json, or GET /api/stats), pass the best collection (nested with "/"; create one only when nothing fits; never "Browser bookmarks", "X bookmarks" or "Pinterest", which Trove fills itself), 1-4 short lowercase tags, and a one-line note when the user gave context. Write collection names, tags, notes and any title you set in English, even if the content or request is in another language. Trove detects the content type (article, video, X bookmark, repo...) itself.

## REST
- POST ${base}/api/items  JSON {url | text, title?, note?, tags?, collection?, highlight?, favorite?}  -> saves (deduplicated; saving again merges tags and notes). {items:[...]} saves up to 25 at once.
- GET  ${base}/api/items?q=QUERY&limit=20  -> search. Syntax: words, "phrase", -word, #tag, -#tag, type:video|article|post|x|repo|note (type:x = X bookmarks), site:domain, collection:"Name", is:fav, is:unread, created:>2025-01, source:x, match:OR
- GET  ${base}/api/items/{id}?content=1  -> item + archived Markdown (article text, transcript, post)
- PATCH ${base}/api/items/{id}  {tags, collection, note, favorite, read, title}
- GET  ${base}/api/lookup?url=...  -> which URLs are already saved
- GET  ${base}/api/stats  -> collections, tags and counts
- OpenAPI: ${base}/openapi.json

## MCP (optional)
- Streamable HTTP server: ${base}/api/mcp with the same bearer key
- Tools: save, save_many, search, get_item, update_item, add_highlight, delete_item, check_saved, list_collections, list_tags, rename

## Examples
curl -X POST ${base}/api/items -H "Authorization: Bearer $TROVE_API_KEY" -H "content-type: application/json" -d '{"url":"https://example.com/post","tags":["ai"],"note":"why it matters"}'
curl "${base}/api/items?q=%23ai+type:article&limit=5" -H "Authorization: Bearer $TROVE_API_KEY"
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
