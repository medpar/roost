export async function GET(req: Request) {
  const base = (process.env.TROVE_PUBLIC_URL || new URL(req.url).origin).replace(/\/$/, '');
  const body = `# Trove

> Mario's personal library (Raindrop-style read-it-later + archive, stored in Notion). Agents can save links or any content and search what was saved.

Auth for everything below: \`Authorization: Bearer <TROVE API KEY>\` (ask the user for a key; never print it).

## MCP (preferred)
- Remote MCP server (Streamable HTTP): ${base}/api/mcp
- Tools: save, save_many, search, get_item, update_item, add_highlight, delete_item, check_saved, list_collections, list_tags, rename

## REST
- POST ${base}/api/items  JSON {url | text, title?, note?, tags?, collection?, highlight?, favorite?}  -> saves (deduplicated; saving again merges tags/notes)
- GET  ${base}/api/items?q=QUERY&limit=20  -> search. Syntax: words, "phrase", -word, #tag, type:video|article|post|repo|note, site:domain, collection:"Name", is:fav, is:unread, created:>2025-01
- GET  ${base}/api/items/{id}?content=1  -> item + archived Markdown (article text, transcript, post)
- PATCH ${base}/api/items/{id}  {tags, collection, note, favorite, read, title}
- OpenAPI: ${base}/openapi.json

## Examples
curl -X POST ${base}/api/items -H "Authorization: Bearer $TROVE_API_KEY" -H "content-type: application/json" -d '{"url":"https://example.com/post","tags":["ai"],"note":"why it matters"}'
curl "${base}/api/items?q=%23ai+type:article&limit=5" -H "Authorization: Bearer $TROVE_API_KEY"
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
