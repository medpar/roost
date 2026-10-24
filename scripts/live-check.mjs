#!/usr/bin/env node
// Live smoke test against the real Notion API: creates a temporary database,
// archives realistic posts (media imports, thread, quote, poll, reply context),
// checks the result, then moves the temporary database to the trash.
//
//   NOTION_TOKEN=ntn_... node scripts/live-check.mjs [--parent <page id>] [--keep]
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { Notion, parseNotionId } from '../extension/lib/notion.js';
import { createDatabase, createViews, ensureSchema, P } from '../extension/lib/schema.js';
import { buildBlocks, buildProperties } from '../extension/lib/render.js';
import { chunk } from '../extension/lib/util.js';

const args = process.argv.slice(2);
const parentArg = args.includes('--parent') ? args[args.indexOf('--parent') + 1] : null;
const keyFile = `${homedir()}/.config/notion/api_key`;
const cliToken = () => {
  try {
    return execFileSync('ntn', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const token = process.env.NOTION_TOKEN || cliToken() || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
const notion = new Notion(token);

const IMG = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
const VIDEO = 'https://www.w3schools.com/html/mov_bbb.mp4';
const author = { id: '1', name: 'Roost Test', handle: 'roost_test', avatar: IMG, verified: false, blueVerified: true, followers: 42 };
const post = (id, text, extra = {}) => ({
  id, url: `https://x.com/roost_test/status/${id}`, conversationId: '1', createdAt: '2025-03-01T10:00:00.000Z', lang: 'en', source: 'Twitter Web App',
  text, isLong: false, author, stats: { likes: 1200, reposts: 30, replies: 4, quotes: 1, bookmarks: 99, views: 120000 },
  media: [], urls: [], hashtags: [], symbols: [], mentions: [], replyTo: null, quotedId: null, quotedUrl: null, quoted: null, card: null, poll: null, article: null, communityNote: '', ...extra,
});

const t0 = Date.now();
const db = await createDatabase(notion, parentArg ? { pageId: parseNotionId(parentArg) } : { workspace: true }, `Roost live check ${new Date().toISOString()}`);
console.log('db', db.url);
await ensureSchema(notion, db.dataSourceId);
console.log('views', await createViews(notion, db));

const photo = { id: 'p1', type: 'photo', url: IMG, alt: 'Default avatar' };
const vid = { id: 'v1', type: 'video', url: VIDEO, variants: [{ url: VIDEO, bitrate: 500000 }], durationMs: 10000 };
const extVid = { id: 'v2', type: 'video', url: VIDEO + '?tag=12', variants: [] };
const quoted = post('50', 'I am the quoted post', { media: [photo] });
const parent = post('90', 'Parent post by someone else? (context)', { author: { ...author, id: '2', handle: 'other', name: 'Other' }, poll: { options: [{ label: 'A', votes: 3 }, { label: 'B', votes: 1 }], final: true } });
const focal = post('100', 'Thread start 🧵 with @jack #roost $TSLA https://example.com/page', {
  media: [photo, vid, extVid], quoted, urls: [{ url: 'https://example.com/page', display: 'example.com/page' }], hashtags: ['roost'],
  mentions: [{ handle: 'jack' }], card: { url: 'https://example.com/page', title: 'Example', description: 'desc' }, replyTo: { id: '90', handle: 'other', userId: '2' },
});
const chain = [focal, post('101', '2/2 the end', { replyTo: { id: '100', handle: 'roost_test', userId: '1' }, media: [photo] })];

// 1) server-side imports
const ids = { img: await notion.importUrl(IMG, 'p1.png'), vid: await notion.importUrl(VIDEO, 'v1.mp4') };
const st = await notion.waitUploads(Object.values(ids), 120000);
console.log('imports', Object.fromEntries([...st].map(([k, v]) => [k, v])), `${Date.now() - t0}ms`);
const uploads = new Map([[IMG, ids.img], [VIDEO, ids.vid]]);

// 2) page with everything
const props = buildProperties(focal, { chain, bookmarkedAt: '2025-03-02T00:00:00.000Z', tags: ['Test'] });
const blocks = buildBlocks(focal, { chain, parent, uploads, raw: true });
const [first, ...rest] = chunk(blocks, 100);
const page = await notion.createPage({ parent: { type: 'data_source_id', data_source_id: db.dataSourceId }, icon: { type: 'external', external: { url: IMG } }, properties: props, children: first });
for (const part of rest) await notion.appendChildren(page.id, part);
console.log('page', page.url, `${blocks.length} blocks`);

// 3) can a still-pending import be attached right away? (informs a future optimisation)
const pendingId = await notion.importUrl(IMG, 'p2.png');
try {
  await notion.appendChildren(page.id, [{ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: pendingId } } }]);
  console.log('attach-pending: accepted');
} catch (e) {
  console.log('attach-pending: rejected ->', e.message);
}

// 4) read back
const q = await notion.query(db.dataSourceId, { filter: { property: P.id, rich_text: { equals: '100' } } });
console.log('query by Post ID', q.results.length === 1 ? 'ok' : 'FAILED');
const kids = await notion.req('GET', `/blocks/${page.id}/children`, null, { query: { page_size: 100 } });
console.log('block types', [...new Set(kids.results.map((b) => b.type + (b[b.type]?.type ? ':' + b[b.type].type : '')))].join(' '));

if (!args.includes('--keep')) {
  await notion.req('PATCH', `/databases/${db.databaseId}`, { in_trash: true });
  console.log('temporary database moved to trash');
}
console.log(`done in ${Date.now() - t0}ms`);
