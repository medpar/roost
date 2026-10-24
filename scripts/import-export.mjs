#!/usr/bin/env node
// Import a Roost bookmark export (JSON produced in an x.com tab) into Notion
// using the extension's own save pipeline: same pages, media archiving,
// fallbacks and duplicate protection. Resumable: re-running skips posts that
// are already in the database.
//
//   node scripts/import-export.mjs <bookmarks.json> [threads.json]
//
// bookmarks.json: { items: [{ t: <normalized post>, s: <sortIndex> }] } (newest first)
// threads.json:   { [postId]: { status: 200, focal, chain, parent } }
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Minimal chrome.storage shim so the extension modules run in Node.
const mem = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys === null || keys === undefined) return { ...mem };
        const out = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) if (k in mem) out[k] = mem[k];
        return out;
      },
      async set(obj) {
        Object.assign(mem, JSON.parse(JSON.stringify(obj)));
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete mem[k];
      },
    },
  },
  runtime: { async getPlatformInfo() { return {}; } },
};

const { Notion } = await import('../extension/lib/notion.js');
const { P, ensureSchema } = await import('../extension/lib/schema.js');
const { parseRules } = await import('../extension/lib/render.js');
const { looksLikeThread } = await import('../extension/lib/parse.js');
const S = await import('../extension/lib/store.js');
const { savePost } = await import('../extension/lib/sync.js');

const [file, threadsFile] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/import-export.mjs <bookmarks.json> [threads.json]');
  process.exit(1);
}
const cfgPath = new URL('../extension/config.local.json', import.meta.url);
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const token = process.env.NOTION_TOKEN || cfg.notionToken || execFileSync('ntn', ['auth', 'token'], { encoding: 'utf8' }).trim();
const dataSourceId = process.env.ROOST_DATA_SOURCE || cfg.dataSourceId;
if (!dataSourceId) throw new Error('No data source id (run scripts/setup-notion.mjs first)');

const items = JSON.parse(readFileSync(file, 'utf8')).items.filter((i) => i.t && !i.t.unavailable && i.t.id);
const threads = threadsFile && existsSync(threadsFile) ? JSON.parse(readFileSync(threadsFile, 'utf8')) : {};
const settings = { ...S.DEFAULTS, notionToken: token, dataSourceId, threads: 'off' };
await S.setSettings(settings);

const notion = new Notion(token);
await ensureSchema(notion, dataSourceId);

// Duplicate protection: learn what is already in the database.
const known = {};
for await (const page of notion.queryAll(dataSourceId, {})) {
  const id = (page.properties?.[P.id]?.rich_text || []).map((t) => t.plain_text).join('').trim();
  if (id) known[id] = page.id;
}
await S.mergeIndex(known);
console.log(`database already has ${Object.keys(known).length} posts; export has ${items.length}`);

const c = { settings, notion, rules: parseRules(settings.rules) };
// Oldest bookmark first, so Notion's "Saved" order matches bookmark order.
const queue = [...items].reverse();
const started = Date.now();
let saved = 0, dup = 0, failed = 0, done = 0, deferred = 0;

async function worker() {
  while (queue.length) {
    const { t, s } = queue.shift();
    const th = threads[t.id];
    const prefetched = th?.status === 200 && th.focal ? { focal: th.focal, chain: th.chain || [], parent: th.parent || null } : null;
    try {
      const r = await savePost(c, t, { source: 'Bookmark', sortIndex: s, prefetched });
      if (r === 'saved') saved++;
      else dup++;
      // Thread-looking posts we could not unroll: let the extension do it later.
      if (r === 'saved' && !prefetched && looksLikeThread(t)) {
        const pageId = await S.pageIdFor(t.id);
        if (pageId) await notion.updatePage(pageId, { properties: { [P.unroll]: { checkbox: true } } });
        deferred++;
      }
    } catch (e) {
      failed++;
      console.error(`FAILED ${t.id}: ${e.message}`);
    }
    if (++done % 25 === 0 || !queue.length) {
      const rate = done / ((Date.now() - started) / 60000);
      console.log(`${done}/${items.length} · saved ${saved} · dup ${dup} · failed ${failed} · ${rate.toFixed(1)}/min`);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
const st = await S.getState();
const warnings = st.log.filter((l) => l.level !== 'info').slice(0, 20);
console.log(JSON.stringify({ saved, dup, failed, deferredThreads: deferred, minutes: ((Date.now() - started) / 60000).toFixed(1), recentWarnings: warnings.map((w) => `${w.msg}${w.extra ? ' — ' + w.extra : ''}`) }, null, 1));
