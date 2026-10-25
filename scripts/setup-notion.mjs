#!/usr/bin/env node
// Create the Trove database in Notion and write extension/config.local.json
// (git-ignored) so the unpacked extension starts already connected.
//
//   NOTION_TOKEN=ntn_... node scripts/setup-notion.mjs [--parent <page url|id>] [--title "Trove"]
//
// Without NOTION_TOKEN it uses the ntn CLI login (`ntn auth token`), then ~/.config/notion/api_key.
// Without --parent it creates the database at the workspace top level.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { Notion, parseNotionId } from '../extension/lib/notion.js';
import { createDatabase, createViews, ensureSchema, resolveDataSource } from '../extension/lib/schema.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const keyFile = `${homedir()}/.config/notion/api_key`;
const cliToken = () => {
  try {
    return execFileSync('ntn', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const token = process.env.NOTION_TOKEN || cliToken() || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
if (!token) {
  console.error('Set NOTION_TOKEN (or log in with the ntn CLI).');
  process.exit(1);
}

const notion = new Notion(token);
const me = await notion.me();
console.log(`Workspace: ${me.bot?.workspace_name} (integration "${me.name}")`);

let db;
const existing = flag('database');
if (existing) {
  db = await resolveDataSource(notion, parseNotionId(existing));
  await ensureSchema(notion, db.dataSourceId);
  console.log(`Using existing database ${db.url}`);
} else {
  const parent = flag('parent') ? { pageId: parseNotionId(flag('parent')) } : { workspace: true };
  db = await createDatabase(notion, parent, flag('title') || 'Trove');
  const views = await createViews(notion, db);
  console.log(`Created database ${db.url}${views.length ? ` with views: ${views.join(', ')}` : ''}`);
}

const cfg = {
  notionToken: token,
  databaseId: db.databaseId,
  dataSourceId: db.dataSourceId,
  databaseUrl: db.url,
  databaseTitle: db.title || flag('title') || 'Trove',
};
const out = new URL('../extension/config.local.json', import.meta.url);
writeFileSync(out, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
console.log(`Wrote ${out.pathname} (git-ignored). Load the extension folder in Brave and it starts syncing.`);
