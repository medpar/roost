#!/usr/bin/env node
// trove — command line client for Trove (https://github.com/medpar/trove).
// Zero dependencies, Node 20+. Built for humans and AI agents (use --json).
//
// Config: TROVE_URL + TROVE_API_KEY env vars, or `trove login` (~/.config/trove/config.json).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const CONFIG = join(homedir(), '.config', 'trove', 'config.json');
const DEFAULT_URL = 'https://trove.mariomedpar.com';

const HELP = `trove — save anything to your Trove library, and find it again

Usage
  trove save <url|text…> [options]     Save links (several at once) or a note. No args: reads stdin.
      -t, --tags a,b        Tags            -c, --collection Name   Collection (nest with /)
      -n, --note "…"        Your note       -h, --highlight "…"     Quote to keep as a highlight
          --fav  --read     Flags               --quick             Metadata only (faster)
          --via name        Label who saved it (shown as "Via")
  trove search [query…]                Search (newest first). Syntax: words "phrase" -word #tag
      -l, --limit N   --sort newest|oldest|title|published      type:video site:x.com is:fav is:unread
      -c, --collection Name   --unsorted   --untagged            created:>2025-01 type:x (X bookmarks)
  trove get <id> [--content]           One item; --content prints the archived Markdown
  trove update <id…> [options]         --title "…"  --tags a,b (replace)  --add-tags a,b  --remove-tags a
                                       -c Name | --unsorted   -n "…"  --fav|--unfav  --read|--unread
  trove highlight <id> "<text>" [-n note]
  trove rm <id>                        Move to trash (recoverable in Notion)
  trove check <url…>                   Is it already saved?
  trove collections | trove tags       List with counts
  trove rename tag|collection <old> <new>   Rename everywhere (merges into <new> if it exists)
  trove open [id]                      Open the web app (or an item)
  trove login [--url URL] [--key KEY]  Store credentials (or set TROVE_URL / TROVE_API_KEY)

Agent (AI librarian, runs on this computer with your Claude Code or Codex login, no API keys)
  trove agent "<request>"              e.g. "tag everything untagged", "find what I saved about RAG"
      --engine claude|codex   --model name   --continue (follow up on the last conversation)
  trove agent serve [--port 7878]      Local bridge so the web app's Agent panel can use it
  trove agent install | uninstall      Start the bridge at login (macOS)
  trove agent status                   Which engines are installed and signed in

Global: --json (machine-readable output), --help`;

// ---------- args ----------

const FLAGS = { t: 'tags', c: 'collection', n: 'note', h: 'highlight', l: 'limit' };
const BOOL = new Set(['json', 'fav', 'read', 'unfav', 'unread', 'quick', 'content', 'unsorted', 'untagged', 'help', 'continue']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    const m = /^(--?)([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m || /^-\d/.test(a)) {
      out._.push(a);
      continue;
    }
    let key = m[1] === '-' ? FLAGS[m[2]] || m[2] : m[2];
    key = key.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (BOOL.has(key) || BOOL.has(m[2])) out[key] = true;
    else out[key] = m[3] ?? argv[++i];
  }
  return out;
}

const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : undefined);

// ---------- config & http ----------

function config() {
  let file = {};
  try {
    file = JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch { /* no config yet */ }
  return { url: (process.env.TROVE_URL || file.url || DEFAULT_URL).replace(/\/$/, ''), key: process.env.TROVE_API_KEY || file.key || '' };
}

async function api(path, { method = 'GET', body } = {}) {
  const { url, key } = config();
  if (!key) throw new Error('No API key. Run `trove login --key <key>` or set TROVE_API_KEY (Trove → Settings → API keys).');
  const res = await fetch(url + path, {
    method,
    headers: { authorization: `Bearer ${key}`, 'user-agent': 'trove-cli/1.0', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function stdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

// ---------- output ----------

const tty = process.stdout.isTTY;
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const date = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const link = (id) => `${config().url}/?item=${id}`;

function line(it) {
  const tags = it.tags?.length ? ' ' + it.tags.map((t) => `#${t}`).join(' ') : '';
  const where = it.collection ? ` [${it.collection}]` : '';
  return `${dim(it.id)}  ${it.type.padEnd(8)} ${bold(it.title || it.url)}${where}${tags}\n${' '.repeat(38)}${dim(`${it.url || '(note)'} · ${date(it.created)}${it.favorite ? ' · ♥' : ''}${it.read ? '' : ' · unread'}`)}`;
}

function print(json, data, human) {
  if (json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else human(data);
}

// ---------- commands ----------

async function cmdSave(a) {
  let inputs = a._.slice(1);
  if (!inputs.length) {
    const text = await stdin();
    if (!text) throw new Error('Nothing to save. Usage: trove save <url|text>');
    inputs = [text];
  }
  // Several bare URLs => one item each; anything else => a single item (text may contain a link).
  const allUrls = inputs.every((s) => /^https?:\/\/\S+$/.test(s));
  const common = {
    tags: list(a.tags),
    collection: a.collection,
    note: a.note,
    highlight: a.highlight,
    favorite: a.fav || undefined,
    read: a.read || undefined,
    via: a.via,
    archive: a.quick ? false : undefined,
  };
  const items = allUrls ? inputs.map((url) => ({ url, ...common })) : [{ text: inputs.join(' '), ...common }];
  const results = [];
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    if (batch.length === 1) {
      try {
        results.push(await api('/api/items', { method: 'POST', body: batch[0] }));
      } catch (e) {
        results.push({ error: e.message, input: batch[0].url || batch[0].text.slice(0, 80) });
      }
    } else results.push(...(await api('/api/items', { method: 'POST', body: { items: batch } })).results);
  }
  print(a.json, items.length === 1 ? results[0] : { results }, () => {
    for (const r of results) {
      if (r.error) console.log(`✗ ${r.input || ''}: ${r.error}`);
      else console.log(`${r.created ? '✓ Saved' : '• Already saved'}: ${bold(r.item.title || r.item.url)}${r.item.tags?.length ? ' ' + r.item.tags.map((t) => `#${t}`).join(' ') : ''}\n  ${dim(link(r.item.id))}`);
    }
  });
  if (results.some((r) => r.error)) process.exitCode = 1;
}

async function cmdSearch(a) {
  const p = new URLSearchParams({ q: a._.slice(1).join(' '), limit: String(a.limit || 20), sort: a.sort || 'newest' });
  if (a.collection) p.set('collection', a.collection);
  if (a.unsorted) p.set('collection', 'unsorted');
  if (a.untagged) p.set('notag', '1');
  if (a.source) p.set('source', a.source);
  if (a.cursor) p.set('cursor', a.cursor);
  const r = await api(`/api/items?${p}`);
  print(a.json, r, () => {
    if (!r.items.length) return console.log('No matches.');
    for (const it of r.items) console.log(line(it));
    if (r.cursor) console.log(dim(`… more: trove search ${a._.slice(1).join(' ')} --cursor ${r.cursor}`));
  });
}

async function cmdGet(a) {
  const id = a._[1];
  if (!id) throw new Error('Usage: trove get <id> [--content]');
  const r = await api(`/api/items/${id}${a.content ? '?content=1' : ''}`);
  print(a.json, r, () => {
    console.log(line(r.item));
    if (r.item.note) console.log(`\nNote: ${r.item.note}`);
    if (r.markdown) console.log('\n' + r.markdown);
  });
}

async function cmdUpdate(a) {
  const ids = a._.slice(1);
  if (!ids.length) throw new Error('Usage: trove update <id…> [options]');
  const body = {};
  if (a.title) body.title = a.title;
  if (a.note !== undefined) body.note = a.note;
  if (a.collection) body.collection = a.collection;
  if (a.unsorted) body.collection = '';
  if (a.fav) body.favorite = true;
  if (a.unfav) body.favorite = false;
  if (a.read) body.read = true;
  if (a.unread) body.read = false;
  if (a.tags) body.tags = list(a.tags);
  const results = [];
  for (const id of ids) {
    try {
      const patch = { ...body };
      if (a.addTags || a.removeTags) {
        const { item } = await api(`/api/items/${id}`);
        const remove = list(a.removeTags) || [];
        patch.tags = [...new Set([...(body.tags || item.tags), ...(list(a.addTags) || [])])].filter((t) => !remove.includes(t));
      }
      results.push(await api(`/api/items/${id}`, { method: 'PATCH', body: patch }));
    } catch (e) {
      results.push({ error: e.message, id });
    }
  }
  print(a.json, ids.length === 1 ? results[0] : { results }, () => {
    for (const r of results) console.log(r.error ? `✗ ${r.id}: ${r.error}` : `✓ Updated\n${line(r.item)}`);
  });
  if (results.some((r) => r.error)) process.exitCode = 1;
}

async function cmdRename(a) {
  const [, kind, from, to] = a._;
  if (!['tag', 'collection'].includes(kind) || !from || to === undefined) throw new Error('Usage: trove rename tag|collection <old> <new>');
  const r = await api('/api/facets', { method: 'PATCH', body: { kind, from: from.replace(/^#/, ''), to: to.replace(/^#/, '') } });
  print(a.json, r, () => console.log(`✓ Renamed ${kind} “${from}” to “${to}”`));
}

async function cmdAgent(a) {
  const { runAgent, serve, install, uninstall, engines, PORT } = await import('./agent.mjs');
  const sub = a._[1];
  const { url } = config();
  if (sub === 'serve') {
    const port = Number(a.port) || PORT;
    const server = serve({ port, troveUrl: url, origins: list(a.origin) || [] });
    server.on('error', (e) => {
      console.error(`trove: ${e.code === 'EADDRINUSE' ? `port ${port} is in use (is the agent already running?)` : e.message}`);
      process.exit(1);
    });
    server.on('listening', () => console.log(`Trove agent listening on http://127.0.0.1:${port} for ${url}`));
    return new Promise(() => {});
  }
  if (sub === 'install') return console.log(`✓ The agent now starts at login (${await install()}).`);
  if (sub === 'uninstall') return console.log((await uninstall()) ? '✓ Removed the login item.' : 'Nothing to remove.');
  if (sub === 'status') {
    const e = await engines();
    return print(a.json, e, () => {
      for (const [name, s] of Object.entries(e)) console.log(`${name.padEnd(7)} ${s.installed ? (s.loggedIn ? '✓ signed in' : `installed, not signed in (${name === 'codex' ? 'codex login' : 'claude auth login'})`) : 'not installed'}`);
    });
  }
  const prompt = a._.slice(1).join(' ') || (await stdin());
  if (!prompt) throw new Error('Usage: trove agent "<request>"   (or: trove agent serve | install | status)');
  const engine = a.engine === 'codex' ? 'codex' : 'claude';
  const statePath = join(homedir(), '.config', 'trove', 'agent', `last-${engine}`);
  let session;
  if (a.continue) {
    try {
      session = readFileSync(statePath, 'utf8').trim();
    } catch { /* no previous conversation */ }
  }
  await new Promise((resolve) => {
    runAgent({ prompt, engine, session, model: a.model, troveUrl: url }, (e) => {
      if (a.json) process.stdout.write(JSON.stringify(e) + '\n');
      else if (e.type === 'text') console.log(e.text + '\n');
      else if (e.type === 'tool') console.error(dim(`› ${e.label}`));
      else if (e.type === 'status') console.error(dim(e.text));
      else if (e.type === 'error') {
        console.error(`trove agent: ${e.message}`);
        process.exitCode = 1;
      }
      if (e.type === 'session' && e.id) {
        mkdirSync(join(homedir(), '.config', 'trove', 'agent'), { recursive: true });
        writeFileSync(statePath, e.id);
      }
      if (e.type === 'done') resolve();
    });
  });
}

async function cmdHighlight(a) {
  const [, id, ...text] = a._;
  if (!id || !text.length) throw new Error('Usage: trove highlight <id> "<text>" [-n note]');
  const r = await api(`/api/items/${id}/highlights`, { method: 'POST', body: { text: text.join(' '), note: a.note } });
  print(a.json, r, () => console.log(`✓ Highlight saved on “${r.item.title}”`));
}

async function cmdRm(a) {
  const id = a._[1];
  if (!id) throw new Error('Usage: trove rm <id>');
  const r = await api(`/api/items/${id}`, { method: 'DELETE' });
  print(a.json, r, () => console.log('✓ Moved to trash'));
}

async function cmdCheck(a) {
  const urls = a._.slice(1);
  if (!urls.length) throw new Error('Usage: trove check <url…>');
  const r = await api(`/api/lookup?${urls.map((u) => `url=${encodeURIComponent(u)}`).join('&')}`);
  print(a.json, r, () => {
    for (const [u, it] of Object.entries(r.results)) console.log(it ? `✓ ${u}\n  ${dim(`${it.title} · ${link(it.id)}`)}` : `✗ ${u} (not saved)`);
  });
}

async function cmdFacets(a, kind) {
  const s = await api('/api/stats');
  const rows = kind === 'collections' ? s.collections : s.tags;
  print(a.json, rows, () => {
    if (!rows.length) return console.log(`No ${kind} yet.`);
    for (const f of rows) console.log(`${String(f.count).padStart(5)}  ${kind === 'tags' ? '#' : ''}${f.name}`);
  });
}

function cmdOpen(a) {
  const target = a._[1] ? link(a._[1]) : config().url;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [target]);
  console.log(target);
}

async function cmdLogin(a) {
  const current = (() => {
    try {
      return JSON.parse(readFileSync(CONFIG, 'utf8'));
    } catch {
      return {};
    }
  })();
  const next = { url: (a.url || current.url || DEFAULT_URL).replace(/\/$/, ''), key: a.key || process.env.TROVE_API_KEY || current.key || (await stdin()) };
  if (!next.key) throw new Error('Pass --key <api key> (Trove → Settings → API keys), or pipe it in.');
  mkdirSync(join(homedir(), '.config', 'trove'), { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  process.env.TROVE_URL = next.url;
  process.env.TROVE_API_KEY = next.key;
  const h = await api('/api/health');
  if (!h.authenticated) throw new Error('Saved, but the key was rejected.');
  console.log(`✓ Logged in to ${next.url}`);
}

// ---------- main ----------

const a = parseArgs(process.argv.slice(2));
const cmd = a._[0];
const run = {
  save: cmdSave, add: cmdSave, s: cmdSave,
  search: cmdSearch, find: cmdSearch, ls: cmdSearch, list: cmdSearch,
  get: cmdGet, show: cmdGet, read: cmdGet,
  update: cmdUpdate, edit: cmdUpdate,
  highlight: cmdHighlight,
  rm: cmdRm, delete: cmdRm,
  check: cmdCheck,
  rename: cmdRename,
  agent: cmdAgent,
  collections: (x) => cmdFacets(x, 'collections'),
  tags: (x) => cmdFacets(x, 'tags'),
  open: cmdOpen,
  login: cmdLogin,
}[cmd];

if (!cmd || a.help || cmd === 'help' || !run) {
  console.log(HELP);
  if (cmd && !run && cmd !== 'help') process.exitCode = 2;
} else {
  Promise.resolve(run(a)).catch((e) => {
    if (a.json) console.log(JSON.stringify({ error: e.message }));
    else console.error(`trove: ${e.message}`);
    process.exitCode = 1;
  });
}
