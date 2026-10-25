#!/usr/bin/env node
// File every item saved from browser bookmarks (Source "Browser bookmarks") under the
// "Browser bookmarks" collection, keeping its folder as a sub-collection:
//   "Utils/APIs" -> "Browser bookmarks/Utils/APIs", no folder -> "Browser bookmarks".
// Safe to re-run: items already under "Browser bookmarks" are skipped.
//
//   node scripts/file-browser-bookmarks.mjs [--dry-run]
//
// Reads NOTION_TOKEN and TROVE_LIBRARY_DS from the environment or web/.env.local.
import { existsSync, readFileSync } from 'node:fs';
import { Notion } from '../extension/lib/notion.js';
import { L } from '../extension/lib/schema.js';

const ROOT = 'Browser bookmarks';
const dry = process.argv.includes('--dry-run');
const envFile = new URL('../web/.env.local', import.meta.url);
const fileEnv = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]))
  : {};
const get = (k) => process.env[k] || fileEnv[k];
const notion = new Notion(get('NOTION_TOKEN'));
const ds = get('TROVE_LIBRARY_DS');

const todo = [];
for await (const page of notion.queryAll(ds, { filter: { property: L.source, select: { equals: ROOT } } })) {
  const current = page.properties[L.collection]?.select?.name || '';
  if (current === ROOT || current.startsWith(`${ROOT}/`)) continue;
  todo.push({ id: page.id, from: current, to: (current ? `${ROOT}/${current}` : ROOT).slice(0, 100) });
}
const moves = Object.entries(todo.reduce((m, t) => ((m[`${t.from || '(none)'} -> ${t.to}`] = (m[`${t.from || '(none)'} -> ${t.to}`] || 0) + 1), m), {}));
console.log(`${todo.length} items to re-file${dry ? ' (dry run)' : ''}`);
for (const [move, n] of moves.sort()) console.log(`  ${String(n).padStart(4)}  ${move}`);
if (dry) process.exit(0);

let done = 0;
let next = 0;
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (next < todo.length) {
      const t = todo[next++];
      await notion.updatePage(t.id, { properties: { [L.collection]: { select: { name: t.to } } } });
      done++;
    }
  }),
);
console.log(`Re-filed ${done} items.`);
