#!/usr/bin/env node
// Move every page of the old "X Bookmarks" database into the Trove database, as Type "X bookmark".
// Uses Notion's move endpoint, so page ids, archived content and uploaded media are kept.
// Safe to re-run: it only moves what is still in the old database.
//
//   node scripts/merge-x-into-trove.mjs [--dry-run] [--limit N] [--page <id>] [--views]
//
// Reads NOTION_TOKEN, TROVE_LIBRARY_DS and TROVE_X_DS from the environment or web/.env.local.
// Writes a JSON backup of every moved page's properties to ~/.config/trove/backups first.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Notion } from '../extension/lib/notion.js';
import { L, X_TYPE, createViews, ensureSchema, xKey } from '../extension/lib/schema.js';

const args = process.argv.slice(2);
const flag = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const has = (n) => args.includes(`--${n}`);

const envFile = new URL('../web/.env.local', import.meta.url);
const fileEnv = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]))
  : {};
const get = (k) => process.env[k] || fileEnv[k];
const token = get('NOTION_TOKEN');
const libraryDs = get('TROVE_LIBRARY_DS');
const xDs = get('TROVE_X_DS');
if (!token || !libraryDs || !xDs) throw new Error('Need NOTION_TOKEN, TROVE_LIBRARY_DS and TROVE_X_DS.');

const notion = new Notion(token);
const txt = (p) => (p?.rich_text || p?.title || []).map((t) => t.plain_text).join('');
const tweetId = (page) => txt(page.properties?.['Post ID']) || /\/status(?:es)?\/(\d+)/.exec(page.properties?.URL?.url || '')?.[1] || '';

// 1. Old database: give the two clashing properties the Trove names (X "Type" is a multi-select of
//    what the post contains, Trove "Type" is the content type; X "Posted" is Trove "Published").
async function alignOldSchema() {
  const ds = await notion.getDataSource(xDs);
  const p = ds.properties;
  const rename = {};
  if (p.Type?.type === 'multi_select' && !p[L.postKind]) rename.Type = { name: L.postKind };
  if (p.Posted?.type === 'date' && !p[L.published]) rename.Posted = { name: L.published };
  if (Object.keys(rename).length && !has('dry-run')) await notion.updateDataSource(xDs, { properties: rename });
  return Object.keys(rename);
}

// 2. Trove database: add the X columns and the "X bookmark" type, plus every select option the old
//    database uses (a move drops select values whose option doesn't exist in the target).
async function prepareLibrary() {
  if (has('dry-run')) return;
  await ensureSchema(notion, libraryDs);
  const [lib, old] = await Promise.all([notion.getDataSource(libraryDs), notion.getDataSource(xDs)]);
  const patch = {};
  for (const [name, prop] of Object.entries(old.properties)) {
    const kind = prop.type;
    const target = lib.properties[name];
    if ((kind !== 'select' && kind !== 'multi_select') || target?.type !== kind) continue;
    const have = new Set(target[kind].options.map((o) => o.name));
    const add = prop[kind].options.filter((o) => !have.has(o.name)).map(({ name: n, color }) => ({ name: n, color }));
    if (add.length) patch[name] = { [kind]: { options: [...target[kind].options.map(({ id, name: n, color }) => ({ id, name: n, color })), ...add] } };
  }
  if (Object.keys(patch).length) {
    await notion.updateDataSource(libraryDs, { properties: patch });
    console.log(`Added options to: ${Object.keys(patch).join(', ')}`);
  }
}

// Select values are re-applied after the move, in case an option was still missing.
const SELECTS = [L.lang, L.client, L.source, L.collection];
const MULTIS = [L.tags, L.postKind];

function libraryProps(page) {
  const id = tweetId(page);
  const props = {
    [L.type]: { select: { name: X_TYPE } },
    [L.platform]: { select: { name: 'X' } },
    [L.domain]: { rich_text: [{ type: 'text', text: { content: 'x.com' } }] },
    [L.site]: { rich_text: [{ type: 'text', text: { content: 'X' } }] },
  };
  if (id) props[L.key] = { rich_text: [{ type: 'text', text: { content: xKey(id) } }] };
  for (const k of SELECTS) {
    const name = page.properties?.[k]?.select?.name;
    if (name) props[k] = { select: { name } };
  }
  for (const k of MULTIS) {
    const names = (page.properties?.[k]?.multi_select || []).map((o) => o.name);
    if (names.length) props[k] = { multi_select: names.map((name) => ({ name })) };
  }
  // Pages written by an older extension after the rename still use "Type" (multi-select) and "Posted".
  const oldKinds = page.properties?.Type?.multi_select;
  if (oldKinds?.length && !props[L.postKind]) props[L.postKind] = { multi_select: oldKinds.map((o) => ({ name: o.name })) };
  const posted = page.properties?.Posted?.date;
  if (posted && !page.properties?.[L.published]?.date) props[L.published] = { date: posted };
  return props;
}

async function main() {
  console.log(`Old database: ${xDs}\nTrove database: ${libraryDs}${has('dry-run') ? '\n(dry run)' : ''}`);
  const renamed = await alignOldSchema();
  if (renamed.length) console.log(`Renamed in the old database: ${renamed.join(', ')}`);
  await prepareLibrary();

  const pages = [];
  if (flag('page')) pages.push(await notion.req('GET', `/pages/${flag('page')}`));
  else for await (const page of notion.queryAll(xDs, {})) pages.push(page);
  const limit = Number(flag('limit')) || pages.length;
  const todo = pages.slice(0, limit);
  console.log(`${pages.length} pages in the old database, moving ${todo.length}`);
  if (!todo.length || has('dry-run')) return;

  const dir = join(homedir(), '.config', 'trove', 'backups');
  mkdirSync(dir, { recursive: true });
  const backup = join(dir, `x-bookmarks-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(backup, JSON.stringify(todo.map((p) => ({ id: p.id, url: p.url, created_time: p.created_time, properties: p.properties })), null, 1));
  console.log(`Backup of their properties: ${backup}`);

  let done = 0;
  let failed = 0;
  let next = 0;
  const started = Date.now();
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < todo.length) {
        const page = todo[next++];
        try {
          await notion.req('POST', `/pages/${page.id}/move`, { parent: { type: 'data_source_id', data_source_id: libraryDs } });
          await notion.updatePage(page.id, { properties: libraryProps(page) });
          done++;
        } catch (e) {
          failed++;
          console.error(`✗ ${page.id} ${txt(page.properties?.Title).slice(0, 60)}: ${e.message}`);
        }
        if ((done + failed) % 50 === 0) console.log(`${done + failed}/${todo.length} (${Math.round((Date.now() - started) / 1000)}s)`);
      }
    }),
  );
  console.log(`Moved ${done}, failed ${failed}.`);

  if (has('views')) {
    const ds = await notion.getDataSource(libraryDs);
    console.log(`Views: ${(await createViews(notion, { databaseId: ds.parent?.database_id, dataSourceId: libraryDs })).join(', ') || 'none'}`);
  }
}

await main();
