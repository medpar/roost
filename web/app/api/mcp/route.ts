// Remote MCP server (Streamable HTTP) so any agent (Claude Code, Hermes, Cursor, ChatGPT,
// custom assistants) can save to and search Trove. Auth: Authorization: Bearer <api key>.
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { caller, unauthorized, type Caller } from '@/lib/auth';
import { addHighlight, getItem, invalidateStats, list, lookup, remove, renameFacet, save, stats, update, type Item } from '@/lib/store';
import { toSaveInput } from '@/lib/input';

export const maxDuration = 60;

const INSTRUCTIONS = `Trove is the user's personal read-it-later library and archive (Raindrop-style) backed by Notion.
Use it whenever the user shares a link or content and wants it kept ("save this", "bookmark", "read later", "remember this article", or simply sends a bare link with no other request).
- save: store a URL (articles, YouTube, X/Reddit/Bluesky/Mastodon posts, GitHub repos, PDFs...) or plain text as a note. Trove fetches title, description, cover, the full article text / transcript, and never creates duplicates (saving again merges tags/notes).
- search: find saved items. Query syntax: words, "exact phrase", -exclude, #tag, type:video|article|post|x|repo|note (type:x = X bookmarks), site:domain, collection:"Name", is:fav, is:unread, created:>2025-01, highlights:true.
- get_item returns the archived full content (Markdown) for summarizing or answering questions.
Prefer existing collections and tags (see list_collections / list_tags) over inventing new ones; at most 5 tags per item. Report only what tool results confirm.`;

const brief = (i: Item) => ({
  id: i.id,
  title: i.title,
  url: i.url,
  type: i.type,
  platform: i.platform,
  collection: i.collection,
  tags: i.tags,
  note: i.note || undefined,
  excerpt: i.excerpt ? i.excerpt.slice(0, 240) : undefined,
  author: i.author || undefined,
  favorite: i.favorite || undefined,
  read: i.read,
  saved: i.created,
  notion: i.notionUrl,
});

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: `Error: ${(e as Error)?.message || e}` }] });

function build(who: Caller) {
  return createMcpHandler(
    (server) => {
      const saveShape = z.object({
        url: z.string().optional().describe('Link to save. Optional when saving plain text.'),
        text: z.string().optional().describe('Plain text / a message to save as a note, or text containing a single link.'),
        title: z.string().optional().describe('Override the fetched title.'),
        note: z.string().optional().describe('Your note about why it matters (Markdown).'),
        tags: z.array(z.string()).max(5).optional(),
        collection: z.string().optional().describe('Collection name; nested with "/", e.g. "Dev/AI".'),
        highlight: z.string().optional().describe('A quote from the content to keep as a highlight.'),
        favorite: z.boolean().optional(),
      });

      server.registerTool(
        'save',
        { title: 'Save to Trove', description: 'Save a link or a piece of content (note) to Trove. Returns the saved item and whether it already existed.', inputSchema: saveShape },
        async (args) => {
          try {
            const r = await save(toSaveInput({ ...args, source: 'Agent' }, who));
            invalidateStats();
            return ok({ created: r.created, item: brief(r.item) });
          } catch (e) {
            return fail(e);
          }
        },
      );

      server.registerTool(
        'save_many',
        { title: 'Save several items', description: 'Save up to 25 links/notes in one call.', inputSchema: z.object({ items: z.array(saveShape).min(1).max(25) }) },
        async ({ items }) => {
          const results = [];
          for (const it of items) {
            try {
              const r = await save(toSaveInput({ ...it, source: 'Agent' }, who));
              results.push({ created: r.created, item: brief(r.item) });
            } catch (e) {
              results.push({ error: (e as Error).message, input: it.url || it.text?.slice(0, 60) });
            }
          }
          invalidateStats();
          return ok({ results });
        },
      );

      server.registerTool(
        'search',
        {
          title: 'Search Trove',
          description: 'Search or list saved items (newest first). Supports the Trove query syntax described in the server instructions.',
          inputSchema: z.object({
            query: z.string().optional().describe('e.g. "llm agents #ai type:article", or empty for latest'),
            collection: z.string().optional(),
            limit: z.number().int().min(1).max(50).optional(),
            sort: z.enum(['newest', 'oldest', 'title', 'published']).optional(),
            cursor: z.string().optional().describe('Pass the cursor from a previous result to get the next page.'),
          }),
          annotations: { readOnlyHint: true },
        },
        async ({ query, collection, limit, sort, cursor }) => {
          try {
            const r = await list({ q: query || '', query: collection ? { collection } : {}, limit: limit || 20, sort, cursor });
            return ok({ items: r.items.map(brief), cursor: r.cursor });
          } catch (e) {
            return fail(e);
          }
        },
      );

      server.registerTool(
        'get_item',
        { title: 'Read a saved item', description: 'Get one item with its archived content as Markdown (article text, post text, video transcript, highlights).', inputSchema: z.object({ id: z.string(), max_chars: z.number().int().min(500).max(100000).optional() }), annotations: { readOnlyHint: true } },
        async ({ id, max_chars }) => {
          try {
            const { item, markdown } = await getItem(id, { content: true });
            const max = max_chars || 30000;
            return ok({ item: brief(item), content: markdown && markdown.length > max ? markdown.slice(0, max) + '\n…(truncated)' : markdown });
          } catch (e) {
            return fail(e);
          }
        },
      );

      server.registerTool(
        'update_item',
        {
          title: 'Update an item',
          description: 'Change title, note, collection, tags (replace, add or remove), favorite or read state.',
          inputSchema: z.object({
            id: z.string(),
            title: z.string().optional(),
            note: z.string().optional(),
            collection: z.string().nullable().optional().describe('null moves it to Unsorted'),
            tags: z.array(z.string()).optional().describe('Replace all tags'),
            add_tags: z.array(z.string()).optional(),
            remove_tags: z.array(z.string()).optional(),
            favorite: z.boolean().optional(),
            read: z.boolean().optional(),
          }),
        },
        async (a) => {
          try {
            let tags = a.tags;
            if (!tags && (a.add_tags || a.remove_tags)) {
              const { item } = await getItem(a.id);
              tags = [...item.tags, ...(a.add_tags || [])].filter((t) => !(a.remove_tags || []).includes(t));
            }
            const item = await update(a.id, { title: a.title, note: a.note, collection: a.collection, tags, favorite: a.favorite, read: a.read });
            invalidateStats();
            return ok({ item: brief(item) });
          } catch (e) {
            return fail(e);
          }
        },
      );

      server.registerTool(
        'add_highlight',
        { title: 'Add a highlight', description: 'Store a quote (and optional comment) on a saved item.', inputSchema: z.object({ id: z.string(), text: z.string(), note: z.string().optional() }) },
        async ({ id, text, note }) => {
          try {
            return ok({ item: brief(await addHighlight(id, text, note)) });
          } catch (e) {
            return fail(e);
          }
        },
      );

      server.registerTool(
        'delete_item',
        { title: 'Delete an item', description: 'Move an item to the trash (recoverable in Notion). Only when the user explicitly asks.', inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
        async ({ id }) => {
          try {
            await remove(id);
            invalidateStats();
            return ok({ deleted: id });
          } catch (e) {
            return fail(e);
          }
        },
      );

      server.registerTool(
        'check_saved',
        { title: 'Check if links are saved', description: 'For up to 20 URLs, return the saved item or null.', inputSchema: z.object({ urls: z.array(z.string()).min(1).max(20) }), annotations: { readOnlyHint: true } },
        async ({ urls }) => {
          try {
            const r = await lookup(urls);
            return ok(Object.fromEntries(Object.entries(r).map(([u, it]) => [u, it ? brief(it) : null])));
          } catch (e) {
            return fail(e);
          }
        },
      );

      server.registerTool(
        'list_collections',
        { title: 'List collections', description: 'Collections with item counts.', inputSchema: z.object({}), annotations: { readOnlyHint: true } },
        async () => {
          try {
            return ok((await stats()).collections.map(({ name, count }) => ({ name, count })));
          } catch (e) {
            return fail(e);
          }
        },
      );

      server.registerTool(
        'list_tags',
        { title: 'List tags', description: 'Tags with item counts (most used first).', inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional() }), annotations: { readOnlyHint: true } },
        async ({ limit }) => {
          try {
            return ok((await stats()).tags.slice(0, limit || 200).map(({ name, count }) => ({ name, count })));
          } catch (e) {
            return fail(e);
          }
        },
      );

      server.registerTool(
        'rename',
        { title: 'Rename or merge a tag/collection', description: 'Rename a tag or collection everywhere; renaming onto an existing name merges them. Empty "to" removes it from all items.', inputSchema: z.object({ kind: z.enum(['tag', 'collection']), from: z.string(), to: z.string() }) },
        async ({ kind, from, to }) => {
          try {
            return ok(await renameFacet(kind, from, to));
          } catch (e) {
            return fail(e);
          }
        },
      );
    },
    { serverInfo: { name: 'trove', version: '2.0.0' }, instructions: INSTRUCTIONS },
  );
}

async function handle(req: Request) {
  const who = caller(req);
  if (!who) return unauthorized();
  return build(who)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
