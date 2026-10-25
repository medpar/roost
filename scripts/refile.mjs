#!/usr/bin/env node
// File items Trove collects by itself into their collections. Safe to re-run; only changes what is off.
//   Source "Browser bookmarks"  -> "Browser bookmarks/<folder>"  ("Utils/APIs" -> "Browser bookmarks/Utils/APIs")
//   Type "X bookmark", unfiled   -> "X bookmarks"
//   Platform "Pinterest", unfiled -> "Pinterest"
//
//   node scripts/refile.mjs [--dry-run]
//
// Reads NOTION_TOKEN and TROVE_LIBRARY_DS from the environment or web/.env.local.
import { existsSync, readFileSync } from 'node:fs';
import { Notion } from '../extension/lib/notion.js';
import { BROWSER_COLLECTION, L, PINTEREST_COLLECTION, X_COLLECTION, X_TYPE } from '../extension/lib/schema.js';

const dry = process.argv.includes('--dry-run');
const envFile = new URL('../web/.env.local', import.meta.url);
const fileEnv = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]))
  : {};
const get = (k) => process.env[k] || fileEnv[k];
const notion = new Notion(get('NOTION_TOKEN'));
const ds = get('TROVE_LIBRARY_DS');
const under = (c, root) => c === root || c.startsWith(`${root}/`);

const rules = [
  { filter: { property: L.source, select: { equals: BROWSER_COLLECTION } }, to: (c) => (under(c, BROWSER_COLLECTION) ? null : c ? `${BROWSER_COLLECTION}/${c}` : BROWSER_COLLECTION) },
  { filter: { and: [{ property: L.type, select: { equals: X_TYPE } }, { property: L.collection, select: { is_empty: true } }] }, to: () => X_COLLECTION },
  { filter: { and: [{ property: L.platform, select: { equals: 'Pinterest' } }, { property: L.collection, select: { is_empty: true } }] }, to: () => PINTEREST_COLLECTION },
];

const todo = [];
for (const rule of rules) {
  try {
    for await (const page of notion.queryAll(ds, { filter: rule.filter })) {
      const current = page.properties[L.collection]?.select?.name || '';
      const to = rule.to(current)?.slice(0, 100);
      if (to && to !== current) todo.push({ id: page.id, from: current, to });
    }
  } catch (e) {
    if (!/validation/i.test(e.message)) throw e; // a select option that doesn't exist yet: nothing to file
  }
}
const summary = {};
for (const t of todo) summary[`${t.from || '(none)'} -> ${t.to}`] = (summary[`${t.from || '(none)'} -> ${t.to}`] || 0) + 1;
console.log(`${todo.length} items to re-file${dry ? ' (dry run)' : ''}`);
for (const [move, n] of Object.entries(summary).sort()) console.log(`  ${String(n).padStart(4)}  ${move}`);
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
