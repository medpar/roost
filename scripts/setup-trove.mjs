#!/usr/bin/env node
// Create the Trove library database (top level of the workspace, or under --parent)
// and print the ids to put in Vercel env vars.
//   node scripts/setup-trove.mjs [--parent <page url|id>] [--title Trove]
import { execFileSync } from 'node:child_process';
import { Notion, parseNotionId } from '../extension/lib/notion.js';
import { createViews, librarySchema, L } from '../extension/lib/schema.js';

const args = process.argv.slice(2);
const flag = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const token = process.env.NOTION_TOKEN || execFileSync('ntn', ['auth', 'token'], { encoding: 'utf8' }).trim();
const notion = new Notion(token);

const parent = flag('parent') ? { type: 'page_id', page_id: parseNotionId(flag('parent')) } : { type: 'workspace', workspace: true };
const db = await notion.req('POST', '/databases', {
  parent,
  title: [{ type: 'text', text: { content: flag('title') || 'Trove' } }],
  icon: { type: 'emoji', emoji: '🗂️' },
  description: [{ type: 'text', text: { content: 'Everything saved with Trove: links, articles, videos, posts, your X bookmarks, repos, PDFs and notes, with an archived copy of the content.' } }],
  initial_data_source: { properties: librarySchema() },
});
const ds = db.data_sources[0].id;
const newest = [{ timestamp: 'created_time', direction: 'descending' }];
const views = [
  { name: 'Gallery', type: 'gallery', configuration: { type: 'gallery', cover: { type: 'page_cover' }, cover_size: 'medium', cover_aspect: 'cover', card_layout: 'list' } },
  { name: 'Read later', type: 'table', filter: { property: L.read, checkbox: { equals: false } } },
  { name: 'Favorites', type: 'gallery', filter: { property: L.favorite, checkbox: { equals: true } }, configuration: { type: 'gallery', cover: { type: 'page_cover' }, cover_size: 'medium' } },
  { name: 'Videos', type: 'gallery', filter: { property: L.type, select: { equals: 'Video' } }, configuration: { type: 'gallery', cover: { type: 'page_cover' }, cover_size: 'large' } },
  { name: 'Articles', type: 'table', filter: { property: L.type, select: { equals: 'Article' } } },
  { name: 'Notes', type: 'table', filter: { property: L.type, select: { equals: 'Note' } } },
];
const made = [];
for (const v of views) {
  try {
    await notion.req('POST', '/views', { database_id: db.id, data_source_id: ds, sorts: newest, ...v });
    made.push(v.name);
  } catch (e) {
    console.warn(`view ${v.name}: ${e.message}`);
  }
}
made.push(...(await createViews(notion, { databaseId: db.id, dataSourceId: ds })));
console.log(JSON.stringify({ databaseId: db.id, dataSourceId: ds, url: db.url, views: made }, null, 2));
