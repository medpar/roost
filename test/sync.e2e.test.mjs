// End-to-end: the real sync code against a simulated x.com and a mock Notion
// API that enforces Notion's request limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tweet, user, photo, video, entry, cursorEntry, moduleEntry, bookmarksResponse, detailResponse, addToModuleResponse } from './fixtures.mjs';
import { validateBlocks, validateProperties } from './notion-limits.mjs';

globalThis.__TROVE_TIME_SCALE__ = 0.001;

// ---------- fake chrome ----------
const store = {};
const clone = (v) => JSON.parse(JSON.stringify(v));
const hooks = {};
let tabsOpened = 0;
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys === null || keys === undefined) return clone(store);
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (k in store) out[k] = clone(store[k]);
        return out;
      },
      async set(obj) {
        Object.assign(store, clone(obj));
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      },
    },
    onChanged: { addListener() {} },
  },
  cookies: { async get({ name }) { return { ct0: { value: 'CT0' }, auth_token: { value: 'AT' }, twid: { value: 'u%3D1' } }[name] || null; } },
  declarativeNetRequest: { async updateSessionRules() {} },
  runtime: { async getPlatformInfo() { return {}; } },
  tabs: {
    async create({ url }) {
      tabsOpened++;
      // The page makes its own GraphQL request, which our listeners capture.
      const op = url.includes('/status/') ? 'TweetDetail' : 'Bookmarks';
      setTimeout(() => simulatePageRequest(op), 5);
      return { id: 77 };
    },
    async remove() {},
  },
  webRequest: {
    onBeforeRequest: { addListener: (fn) => (hooks.before = fn) },
    onSendHeaders: { addListener: (fn) => (hooks.headers = fn) },
  },
};

let reqId = 0;
function simulatePageRequest(op) {
  const vars = op === 'Bookmarks' ? { count: 20, includePromotedContent: true, cursor: 'STALE' } : { focalTweetId: '999', referrer: 'home', with_rux_injections: false };
  const url = `https://x.com/i/api/graphql/QID_${op}/${op}?variables=${encodeURIComponent(JSON.stringify(vars))}&features=${encodeURIComponent(JSON.stringify({ a: true }))}`;
  const id = String(++reqId);
  hooks.before({ tabId: 3, requestId: id, url, method: 'GET' });
  hooks.headers({
    tabId: 3,
    requestId: id,
    url,
    method: 'GET',
    requestHeaders: [
      { name: 'Authorization', value: 'Bearer CAPTURED' },
      { name: 'x-client-transaction-id', value: `TX_${op}` },
      { name: 'x-csrf-token', value: 'OLD' },
      { name: 'Cookie', value: 'secret' },
    ],
  });
}

// ---------- fake X ----------
const me = user({ id: '1', handle: 'me', name: 'Me' });
const other = user({ id: '2', handle: 'other', name: 'Other', newShape: true });
const thread1 = tweet({ id: '201', author: other, text: 'A thread 🧵 1/3', media: [photo('901')] });
const thread2 = tweet({ id: '202', author: other, text: '2/3 middle', replyTo: { id: '201', userId: '2', handle: 'other' }, media: [video('902')] });
const thread3 = tweet({ id: '203', author: other, text: '3/3 end', replyTo: { id: '202', userId: '2', handle: 'other' } });
const plain = (id, text, extra = {}) => tweet({ id, author: me, text, ...extra });

let bookmarkPages = [
  [plain('110', 'newest'), thread1, plain('108', 'with photo', { media: [photo('908', 'alt text')] })],
  [plain('107', 'quote', { quoted: plain('50', 'quoted one') }), plain('106', 'last')],
];
const xCalls = [];
let featureErrorOnce = true;

function xResponse(url, init) {
  const u = new URL(url);
  const op = u.pathname.split('/').pop();
  const vars = JSON.parse(u.searchParams.get('variables') || '{}');
  xCalls.push({ op, vars, headers: init.headers, features: JSON.parse(u.searchParams.get('features') || '{}') });
  assert.equal(init.headers['x-csrf-token'], 'CT0', 'uses fresh ct0 cookie');
  assert.equal(init.headers.authorization, 'Bearer CAPTURED');
  assert.ok(!('cookie' in init.headers), 'never forwards captured cookies');
  assert.equal(init.credentials, 'include');
  if (op === 'Bookmarks') {
    if (featureErrorOnce) {
      featureErrorOnce = false;
      return new Response(JSON.stringify({ errors: [{ message: 'The following features cannot be null: new_flag_x, other_flag' }] }), { status: 400 });
    }
    assert.equal(init.headers['x-client-transaction-id'], 'TX_Bookmarks');
    const idx = vars.cursor ? Number(vars.cursor.slice(1)) : 0;
    assert.notEqual(vars.cursor, 'STALE', 'drops stale captured cursor');
    const page = bookmarkPages[idx] || [];
    const entries = page.map((t) => entry(t));
    entries.push(cursorEntry('Bottom', `c${idx + 1}`));
    return Response.json(bookmarksResponse(entries));
  }
  if (op === 'TweetDetail') {
    assert.match(u.pathname, /QID_DISC/, 'uses the query id discovered from the bundle');
    assert.equal(JSON.parse(u.searchParams.get('fieldToggles')).withArticlePlainText, true);
    const focal = vars.focalTweetId;
    if (['201', '202', '203'].includes(focal)) {
      if (vars.cursor === 'MORE') return Response.json(addToModuleResponse('conversationthread-202', [thread3]));
      return Response.json(detailResponse([entry(thread1), moduleEntry('202', [thread2], 'MORE')]));
    }
    const all = bookmarkPages.flat().concat([plain('300', 'not bookmarked, saved manually 🧵')]);
    const t = all.find((x) => x.rest_id === focal);
    return Response.json(detailResponse(t ? [entry(t)] : []));
  }
  return new Response('nope', { status: 404 });
}

// ---------- mock Notion ----------
import { schemaProperties, P } from '../extension/lib/schema.js';
const notion = { pages: new Map(), uploads: new Map(), requests: 0, schema: null };
let pageSeq = 0;

function notionResponse(url, init) {
  notion.requests++;
  const u = new URL(url);
  const path = u.pathname.replace('/v1', '');
  const body = init.body ? JSON.parse(init.body) : null;
  assert.equal(init.headers['Notion-Version'], '2026-03-11');
  if (path === '/data_sources/DS' && init.method === 'GET') {
    notion.schema ||= Object.fromEntries(Object.entries(schemaProperties()).filter(([k]) => k !== P.unroll).map(([k, v]) => [k, { id: k.slice(0, 4), type: Object.keys(v)[0] }]));
    return Response.json({ id: 'DS', properties: notion.schema });
  }
  if (path === '/data_sources/DS' && init.method === 'PATCH') {
    for (const [k, v] of Object.entries(body.properties)) notion.schema[k] = { id: k.slice(0, 4), type: Object.keys(v)[0] };
    return Response.json({ id: 'DS', properties: notion.schema });
  }
  if (path === '/data_sources/DS/query') {
    let rows = [...notion.pages.values()];
    const f = body.filter;
    if (f?.property === P.id) rows = rows.filter((p) => (f.rich_text.is_not_empty ? !!p.postId : p.postId === f.rich_text.equals));
    if (f?.property === P.unroll) rows = rows.filter((p) => p.properties[P.unroll]?.checkbox === true);
    const start = Number(body.start_cursor || 0);
    const slice = rows.slice(start, start + (body.page_size || 100));
    return Response.json({
      results: slice.map((p) => ({ id: p.id, properties: { [P.id]: { rich_text: [{ plain_text: p.postId }] }, [P.url]: { url: p.properties[P.url]?.url } } })),
      has_more: start + slice.length < rows.length,
      next_cursor: String(start + slice.length),
    });
  }
  if (path === '/pages' && init.method === 'POST') {
    assert.equal(body.parent.data_source_id, 'DS');
    validateProperties(body.properties, schemaProperties());
    validateBlocks(body.children);
    for (const b of body.children) if (b[b.type]?.file_upload) assert.equal(notion.uploads.get(b[b.type].file_upload.id), 'uploaded');
    const id = `page-${++pageSeq}`;
    notion.pages.set(id, { id, postId: body.properties[P.id].rich_text[0].text.content, properties: body.properties, children: body.children });
    return Response.json({ id, url: `https://notion.so/${id}` });
  }
  const m = /^\/blocks\/(page-\d+)\/children$/.exec(path);
  if (m) {
    validateBlocks(body.children);
    notion.pages.get(m[1]).children.push(...body.children);
    return Response.json({ results: [] });
  }
  const pm = /^\/pages\/(page-\d+)$/.exec(path);
  if (pm && init.method === 'PATCH') {
    Object.assign(notion.pages.get(pm[1]).properties, body.properties);
    return Response.json({ id: pm[1] });
  }
  if (path === '/file_uploads' && init.method === 'POST') {
    assert.equal(body.mode, 'external_url');
    assert.match(body.filename, /\.(jpg|png|mp4)$/);
    const id = `fu-${notion.uploads.size + 1}`;
    notion.uploads.set(id, 'pending');
    return Response.json({ id, status: 'pending' });
  }
  const fu = /^\/file_uploads\/(fu-\d+)$/.exec(path);
  if (fu) {
    notion.uploads.set(fu[1], 'uploaded');
    return Response.json({ id: fu[1], status: 'uploaded' });
  }
  return Response.json({ code: 'not_found', message: path }, { status: 404 });
}

// x.com's own bundle, which Trove reads to discover current query ids.
const BUNDLE = 'https://abs.twimg.com/responsive-web/client-web/main.test.js';
const bundleJs = 'e.exports={queryId:"QID_DISC",operationName:"TweetDetail",operationType:"query",metadata:{featureSwitches:["a","new_detail_flag"],fieldToggles:["withArticlePlainText","withGrokAnalyze"]}}';

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === 'https://x.com/home') return new Response(`<html><script src="${BUNDLE}"></script></html>`);
  if (url === BUNDLE) return new Response(bundleJs);
  if (url.startsWith('https://x.com/i/api/graphql/')) return xResponse(url, init);
  if (url.startsWith('https://api.notion.com/')) return notionResponse(url, init);
  throw new Error('unexpected fetch ' + url);
};

const X = await import('../extension/lib/x.js');
const Sync = await import('../extension/lib/sync.js');
const S = await import('../extension/lib/store.js');

X.installCapture();
await S.setSettings({ notionToken: 'ntn_test', dataSourceId: 'DS', rules: 'Threads: type:Thread' });

const postIds = () => [...notion.pages.values()].map((p) => p.postId).sort();

test('full backfill archives every bookmark once, with threads and media', async () => {
  simulatePageRequest('Bookmarks'); // user browsed x.com/i/bookmarks
  const st = await Sync.backfill();
  assert.equal(st.status, 'done');
  assert.deepEqual(postIds(), ['106', '107', '108', '110', '201']);
  assert.equal(notion.schema[P.unroll].type, 'checkbox', 'missing column was added');

  const threadPage = [...notion.pages.values()].find((p) => p.postId === '201');
  assert.equal(threadPage.properties[P.threadLen].number, 3, 'thread unrolled across a "show more" cursor');
  assert.deepEqual(threadPage.properties[P.tags].multi_select, [{ name: 'Threads' }]);
  const kinds = threadPage.children.map((b) => b.type);
  assert.ok(kinds.includes('image') && kinds.includes('video'));
  assert.ok(threadPage.children.some((b) => b.type === 'video' && b.video.type === 'file_upload'), 'video archived in Notion');
  assert.equal(tabsOpened, 0, 'no background tab needed: TweetDetail came from bundle discovery');

  const fx = xCalls.find((c) => c.op === 'Bookmarks' && c.features.new_flag_x);
  assert.ok(fx, 'patched missing feature flags after a 400');
});

test('incremental sync adds only new bookmarks and never duplicates', async () => {
  let r = await Sync.syncNew('test');
  assert.equal(r.added, 0);
  bookmarkPages[0].unshift(plain('111', 'brand new'));
  r = await Sync.syncNew('test');
  assert.equal(r.added, 1);
  r = await Sync.syncNew('test');
  assert.equal(r.added, 0);
  assert.deepEqual(postIds(), ['106', '107', '108', '110', '111', '201']);
  const p = [...notion.pages.values()].find((x) => x.postId === '111');
  assert.ok(p.properties[P.bookmarked].date.start, 'incremental sync stamps bookmark time');
});

test('re-scan after index loss is still duplicate-free (index rebuilt from Notion)', async () => {
  await S.clearIndex();
  const r = await Sync.rebuildIndex();
  assert.equal(r.found, 6);
  const st = await Sync.backfill({ restart: true });
  assert.equal(st.saved, 0);
  assert.equal(notion.pages.size, 6);
});

test('manual save by URL and the "Unroll thread" checkbox', async () => {
  const r = await Sync.saveFromUrl('https://x.com/me/status/300?s=20');
  assert.equal(r.status, 'saved');
  const manual = [...notion.pages.values()].find((x) => x.postId === '300');
  assert.equal(manual.properties[P.source].select.name, 'Manual');
  const again = await Sync.saveFromUrl('https://twitter.com/me/status/300');
  assert.equal(again.status, 'exists');

  const page = [...notion.pages.values()].find((x) => x.postId === '108');
  page.properties[P.unroll] = { checkbox: true };
  const before = page.children.length;
  await Sync.syncNew('test');
  assert.equal(page.properties[P.unroll].checkbox, false);
  assert.equal(page.properties[P.threadLen].number, 1);
  assert.equal(page.children.length, before, 'no thread to append for a single post');
});
