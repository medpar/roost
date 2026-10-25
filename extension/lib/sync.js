// Sync orchestration: incremental sync, resumable full backfill, thread
// unrolling, manual saves, retries. Jobs run one at a time through a small
// scheduler; the long backfill yields whenever another job is waiting.

import * as X from './x.js';
import { Notion, NotionError } from './notion.js';
import { P, X_TYPE, ensureSchema, xKey } from './schema.js';
import { autoTags, buildBlocks, buildProperties, fullText, linkify, para, parseRules, rt, threadAppendBlocks, titleFor } from './render.js';
import { bookmarkedAtFromSortIndex, looksLikeThread, postTypes } from './parse.js';
import { chunk, tweetIdFromUrl } from './util.js';
import * as S from './store.js';

// ---------- scheduler ----------

let chain = Promise.resolve();
const pending = new Map();
let current = null;
let manualWaiting = 0;
let keepAlive = null;
const listeners = new Set();

export const onActivity = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn(current));
export const currentJob = () => current;
const othersWaiting = () => pending.size > 0 || manualWaiting > 0;

export function schedule(kind, fn) {
  if (kind !== 'manual' && pending.has(kind)) return pending.get(kind);
  if (kind === 'manual') manualWaiting++;
  const p = chain.then(async () => {
    if (kind === 'manual') manualWaiting--;
    else pending.delete(kind);
    current = kind;
    keepAlive ||= setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
    await S.updateState((s) => ({ ...s, running: { kind, startedAt: Date.now() } }));
    emit();
    try {
      return await fn();
    } finally {
      current = null;
      if (!othersWaiting()) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
      await S.updateState((s) => ({ ...s, running: null }));
      emit();
    }
  });
  chain = p.catch(() => {});
  if (kind !== 'manual') pending.set(kind, p);
  return p;
}

// ---------- context ----------

let schemaChecked = null;

export class SetupError extends Error {
  constructor(msg) {
    super(msg);
    this.code = 'setup_needed';
  }
}

async function context() {
  const settings = await S.getSettings();
  if (!settings.notionToken || !settings.dataSourceId) throw new SetupError('Connect Notion in Trove settings first');
  const notion = new Notion(settings.notionToken);
  if (schemaChecked !== settings.dataSourceId) {
    await ensureSchema(notion, settings.dataSourceId);
    schemaChecked = settings.dataSourceId;
  }
  return { settings, notion, rules: parseRules(settings.rules) };
}

const isFatal = (e) =>
  e instanceof SetupError ||
  (e instanceof NotionError && [401, 403, 404].includes(e.status)) ||
  (e instanceof X.XError && ['not_logged_in', 'auth', 'rate_limited'].includes(e.code));

// ---------- media ----------

function extFromUrl(url, fallback) {
  return /[?&]format=(\w+)/.exec(url)?.[1] || /\.(\w{3,4})(?:\?|$)/.exec(url)?.[1] || fallback;
}

/** Ask Notion to import every media file server-side. Returns Map(originalUrl -> fileUploadId). */
async function importMedia(c, posts) {
  const uploads = new Map();
  if (!c.settings.archiveMedia) return uploads;
  const jobs = [];
  const seen = new Set();
  const capBytes = c.settings.maxVideoMB * 1e6;
  for (const p of posts) {
    if (!p) continue;
    for (const m of [...(p.media || []), ...(p.quoted?.media || [])]) {
      if (!m.url || seen.has(m.url)) continue;
      seen.add(m.url);
      if (m.type === 'photo') {
        jobs.push({ key: m.url, src: m.url, name: `${p.id}-${m.id || jobs.length}.${extFromUrl(m.url, 'jpg')}` });
      } else {
        const secs = (m.durationMs || 0) / 1000;
        const v = (m.variants || []).find((x) => !secs || !x.bitrate || (x.bitrate / 8) * secs <= capBytes);
        if (v) jobs.push({ key: m.url, src: v.url, name: `${p.id}-${m.id || jobs.length}.mp4`, video: true });
      }
    }
    const cover = p.article?.cover;
    if (cover && !seen.has(cover)) {
      seen.add(cover);
      jobs.push({ key: cover, src: cover, name: `${p.id}-cover.${extFromUrl(cover, 'jpg')}` });
    }
  }
  if (!jobs.length) return uploads;
  const started = await Promise.all(
    jobs.map((j) =>
      c.notion
        .importUrl(j.src, j.name)
        .then((id) => ({ ...j, id }))
        .catch((e) => {
          S.log('warn', `Media import refused: ${j.name}`, e.message);
          return null;
        }),
    ),
  );
  const ok = started.filter(Boolean);
  const status = await c.notion.waitUploads(ok.map((j) => j.id), ok.some((j) => j.video) ? 300000 : 60000);
  for (const j of ok) {
    if (status.get(j.id)) uploads.set(j.key, j.id);
    else S.log('warn', `Media import failed, linking instead: ${j.name}`);
  }
  return uploads;
}

// ---------- saving ----------

const inflight = new Set();

function mergeFocal(base, fresh) {
  const out = { ...base };
  for (const [k, v] of Object.entries(fresh)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && !v.length && base[k]?.length) continue;
    out[k] = v;
  }
  return out;
}

function wantsDetail(t, settings) {
  if (settings.threads === 'off') return false;
  if (settings.threads === 'always') return true;
  return looksLikeThread(t) || (settings.replyContext && !!t.replyTo) || (!!t.article && !t.article.text);
}

function safeBlocks(blocks) {
  return blocks
    .map((b) => {
      if (b.type === 'video' && b.video.type === 'external') return { object: 'block', type: 'bookmark', bookmark: { url: b.video.external.url, caption: [] } };
      if ((b.type === 'image' || b.type === 'video') && b[b.type].type === 'file_upload') return null;
      return b;
    })
    .filter(Boolean);
}

function minimalProps(t) {
  return {
    [P.title]: { title: rt(titleFor(t)) },
    [P.kind]: { select: { name: X_TYPE } },
    [P.platform]: { select: { name: 'X' } },
    [P.key]: { rich_text: rt(xKey(t.id)) },
    [P.url]: { url: t.url },
    [P.id]: { rich_text: rt(t.id) },
    [P.text]: { rich_text: rt(t.text || '').slice(0, 100) },
  };
}

async function createPage(c, t, props, blocks) {
  const parent = { type: 'data_source_id', data_source_id: c.settings.dataSourceId };
  const icon = t.author?.avatar ? { type: 'external', external: { url: t.author.avatar } } : { type: 'emoji', emoji: '🐦' };
  const minimal = [para(rt(`${t.author?.name || ''} @${t.author?.handle || ''}`)), ...(t.text || '').split(/\n{2,}/).filter(Boolean).map((p) => para(linkify(p)))];
  const tiers = [
    () => ({ properties: props, blocks, icon }),
    () => ({ properties: props, blocks: safeBlocks(blocks), icon }),
    () => ({ properties: minimalProps(t), blocks: [...minimal, para(rt('Open on X', { link: t.url }))], icon: { type: 'emoji', emoji: '🐦' } }),
  ];
  let page;
  let tier = 0;
  for (; tier < tiers.length; tier++) {
    const { properties, blocks: b, icon: ic } = tiers[tier]();
    const [first, ...rest] = chunk(b, 100);
    try {
      page = await c.notion.createPage({ parent, icon: ic, properties, children: first || [] }, { create: true });
      for (const part of rest) {
        // Once the page exists, never throw: a retry would create a duplicate page.
        try {
          await c.notion.appendChildren(page.id, part);
        } catch (e) {
          S.log('warn', `Could not append all content to ${t.id}`, e.message);
          await c.notion
            .appendChildren(page.id, safeBlocks(part))
            .catch(() => c.notion.appendChildren(page.id, [para(rt('⚠️ Part of this post could not be archived. Open it on X.', { link: t.url }))]))
            .catch(() => {});
        }
      }
      break;
    } catch (e) {
      if (page || !(e instanceof NotionError) || e.status !== 400 || tier === tiers.length - 1) throw e;
      S.log('warn', `Notion rejected ${t.id}, retrying simpler version`, e.message);
    }
  }
  return page;
}

/**
 * Archive one post. opts: { source, sortIndex, forceThread, prefetched }.
 * Returns 'saved' | 'dup' | 'skip'.
 */
export async function savePost(c, t, opts = {}) {
  const { source = 'Bookmark', sortIndex, forceThread = false, prefetched, approxNow = false } = opts;
  if (!t || t.unavailable) return 'skip';
  if (inflight.has(t.id) || (await S.savedIds([t.id])).has(t.id)) return 'dup';
  inflight.add(t.id);
  try {
    let focal = t;
    let chainPosts = [];
    let parent = null;
    let unroll = false;
    if (prefetched || forceThread || wantsDetail(t, c.settings)) {
      try {
        const th = prefetched || (await X.fetchThread(t.id));
        if (th.focal) focal = mergeFocal(t, th.focal);
        chainPosts = th.chain.length > 1 ? th.chain.map((p) => (p.id === focal.id ? focal : p)) : [];
        parent = c.settings.replyContext ? th.parent : null;
      } catch (e) {
        if (e.code === 'not_logged_in' || e.code === 'auth') throw e;
        unroll = looksLikeThread(t) || forceThread;
        S.log('warn', `Thread fetch deferred for ${t.id}`, e.message);
      }
    }
    const uploads = await importMedia(c, [focal, ...chainPosts.filter((p) => p.id !== focal.id), parent]);
    const bookmarkedAt = source === 'Bookmark' ? bookmarkedAtFromSortIndex(sortIndex, focal) || (approxNow ? new Date().toISOString() : null) : null;
    const tags = autoTags(focal, c.rules, chainPosts);
    const props = buildProperties(focal, { chain: chainPosts, source, bookmarkedAt, tags, unroll });
    const blocks = buildBlocks(focal, { chain: chainPosts, parent, uploads, raw: c.settings.rawJson });
    const page = await createPage(c, focal, props, blocks);
    await S.markSaved(t.id, page.id, { id: t.id, title: titleFor(focal), url: page.url, handle: focal.author?.handle, at: Date.now() });
    if (c.settings.removeFromX && source === 'Bookmark') {
      X.deleteBookmark(t.id).catch((e) => S.log('warn', `Could not remove bookmark ${t.id} from X`, e.message));
    }
    return 'saved';
  } finally {
    inflight.delete(t.id);
  }
}

/** Save many timeline items with a small worker pool. Non-fatal failures go to the retry list. */
async function saveMany(c, items, source, { approxNow = false } = {}) {
  const queue = [...items];
  let saved = 0;
  let fatal = null;
  const worker = async () => {
    while (queue.length && !fatal) {
      const it = queue.shift();
      try {
        if ((await savePost(c, it.tweet, { source, sortIndex: it.sortIndex, approxNow })) === 'saved') saved++;
      } catch (e) {
        if (isFatal(e) && !(e.code === 'rate_limited')) {
          fatal = e;
          break;
        }
        await S.log('error', `Failed to save ${it.tweet.id}`, e.message);
        await S.updateState((s) => {
          s.retry = [...(s.retry || []).filter((r) => r.tweet.id !== it.tweet.id), { tweet: it.tweet, sortIndex: it.sortIndex, source, attempts: 1 }].slice(-200);
          return s;
        });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (fatal) throw fatal;
  return saved;
}

async function processRetries(c) {
  const { retry = [] } = await S.getState();
  if (!retry.length) return 0;
  let ok = 0;
  const left = [];
  for (const r of retry) {
    try {
      const found = await c.notion.query(c.settings.dataSourceId, { filter: { property: P.id, rich_text: { equals: r.tweet.id } }, page_size: 1 });
      if (found.results[0]) {
        await S.markSaved(r.tweet.id, found.results[0].id);
        continue;
      }
      if ((await savePost(c, r.tweet, { source: r.source, sortIndex: r.sortIndex })) !== 'skip') ok++;
    } catch (e) {
      if (isFatal(e)) {
        left.push(r);
        continue;
      }
      if (r.attempts < 5) left.push({ ...r, attempts: r.attempts + 1 });
      else S.log('error', `Giving up on ${r.tweet.id} after 5 attempts`, e.message);
    }
  }
  await S.updateState((s) => ({ ...s, retry: left }));
  return ok;
}

// ---------- jobs ----------

async function finishOk(added) {
  await S.updateState((s) => ({ ...s, lastSyncAt: Date.now(), lastSyncAdded: added, lastError: null }));
}

async function recordFailure(e) {
  // Rate limits are expected and self-healing: log them without flagging an error.
  if (e.code === 'rate_limited') return S.log('warn', `${e.message}; resuming ${e.resetAt ? 'at ' + new Date(e.resetAt).toLocaleTimeString() : 'later'}`);
  await S.log('error', e.message || String(e), e.code);
}

/** Fetch newest bookmarks until we reach ones we already have. */
export function syncNew(reason = 'manual') {
  return schedule('sync', async () => {
    let added = 0;
    try {
      const c = await context();
      const approxNow = (await S.getState()).backfill.status === 'done';
      let cursor = null;
      for (let pages = 0; pages < 30; pages++) {
        const { items, cursors } = await X.fetchBookmarks(cursor, pages === 0 ? 20 : 100);
        const posts = items.filter((i) => i.tweet && !i.tweet.unavailable);
        const known = await S.savedIds(posts.map((i) => i.tweet.id));
        const fresh = posts.filter((i) => !known.has(i.tweet.id));
        added += await saveMany(c, fresh.reverse(), 'Bookmark', { approxNow });
        if (!posts.length || fresh.length < posts.length || !cursors.bottom || cursors.bottom === cursor) break;
        cursor = cursors.bottom;
      }
      added += await processRetries(c);
      await processUnrollRequests(c);
      await finishOk(added);
      if (added) S.log('info', `Sync (${reason}): ${added} new post${added === 1 ? '' : 's'} saved`);
      return { added };
    } catch (e) {
      await recordFailure(e);
      if (e.code === 'rate_limited') return { added, rateLimited: true };
      throw e;
    }
  });
}

/** Walk the entire bookmark list (resumable). */
export function backfill({ restart = false } = {}) {
  return schedule('backfill', async () => {
    let st = (await S.getState()).backfill;
    if (restart || st.status === 'idle' || st.status === 'done') {
      st = { status: 'running', cursor: null, scanned: 0, saved: 0, pages: 0, startedAt: Date.now(), finishedAt: null, pausedUntil: null };
    }
    if (st.status === 'paused' && !restart && st.pausedUntil && st.pausedUntil > Date.now()) return st;
    st.status = 'running';
    st.pausedUntil = null;
    const persist = () =>
      S.updateState((s) => ({ ...s, backfill: s.backfill.status === 'stopped' && st.status === 'running' ? { ...st, status: 'stopped' } : { ...st } }));
    await persist();
    try {
      const c = await context();
      let empty = 0;
      for (;;) {
        if ((await S.getState()).backfill.status === 'stopped') {
          st.status = 'stopped';
          return st;
        }
        let page;
        try {
          page = await X.fetchBookmarks(st.cursor, 100);
        } catch (e) {
          if (e.code === 'rate_limited') {
            st.status = 'paused';
            st.pausedUntil = e.resetAt;
            S.log('info', `Backfill paused by X rate limit until ${new Date(e.resetAt).toLocaleTimeString()}`);
            return st;
          }
          throw e;
        }
        const posts = page.items.filter((i) => i.tweet && !i.tweet.unavailable);
        st.pages++;
        st.scanned += posts.length;
        const known = await S.savedIds(posts.map((i) => i.tweet.id));
        st.saved += await saveMany(c, posts.filter((i) => !known.has(i.tweet.id)), 'Bookmark');
        empty = posts.length ? 0 : empty + 1;
        const next = page.cursors.bottom;
        if (!next || next === st.cursor || empty >= 2) {
          Object.assign(st, { status: 'done', finishedAt: Date.now(), cursor: null });
          S.log('info', `Backfill complete: scanned ${st.scanned}, saved ${st.saved}`);
          await processUnrollRequests(c).catch(() => {});
          return st;
        }
        st.cursor = next;
        await persist();
        if (othersWaiting()) {
          // Let a quick sync or manual save run, then continue where we left off.
          queueMicrotask(() => backfill());
          return st;
        }
      }
    } catch (e) {
      st.status = isFatal(e) ? 'error' : 'paused';
      st.pausedUntil = Date.now() + 5 * 60 * 1000;
      await recordFailure(e);
      throw e;
    } finally {
      await persist();
    }
  });
}

export async function stopBackfill() {
  await S.updateState((s) => ({ ...s, backfill: { ...s.backfill, status: 'stopped' } }));
}

/** Pages where "Unroll thread" is ticked (by the user, or deferred by a rate limit). */
async function processUnrollRequests(c, limit = 40) {
  const res = await c.notion.query(c.settings.dataSourceId, { filter: { property: P.unroll, checkbox: { equals: true } }, page_size: limit });
  for (const page of res.results) {
    const pid = (page.properties?.[P.id]?.rich_text || []).map((t) => t.plain_text).join('').trim();
    const id = pid || tweetIdFromUrl(page.properties?.[P.url]?.url);
    try {
      if (!id) {
        await c.notion.updatePage(page.id, { properties: { [P.unroll]: { checkbox: false } } });
        continue;
      }
      const th = await X.fetchThread(id);
      const focal = th.focal;
      const props = { [P.unroll]: { checkbox: false }, [P.threadLen]: { number: Math.max(1, th.chain.length) } };
      if (focal && (th.chain.length > 1 || th.parent)) {
        const uploads = await importMedia(c, [...th.chain, th.parent]);
        for (const part of chunk(threadAppendBlocks(focal, th.chain.length > 1 ? th.chain : [focal], th.parent, uploads), 100)) {
          await c.notion.appendChildren(page.id, part);
        }
        props[P.type] = { multi_select: postTypes(focal, th.chain.length).map((name) => ({ name })) };
        props[P.text] = { rich_text: linkify(fullText(focal, th.chain)) };
      }
      await c.notion.updatePage(page.id, { properties: props });
      S.log('info', `Unrolled thread for ${id} (${th.chain.length} posts)`);
    } catch (e) {
      if (e.code === 'rate_limited' || isFatal(e)) break;
      S.log('warn', `Could not unroll ${id}`, e.message);
    }
  }
}

/** Save any post by URL (context menu / popup / shortcut), with its thread. */
export function saveFromUrl(url, { thread = true } = {}) {
  const id = tweetIdFromUrl(url);
  if (!id) return Promise.reject(new Error('Not an X post URL'));
  return schedule('manual', async () => {
    const c = await context();
    const existing = await S.pageIdFor(id);
    if (existing) {
      if (thread && existing !== '1') {
        await c.notion.updatePage(existing, { properties: { [P.unroll]: { checkbox: true } } });
        await processUnrollRequests(c, 3);
      }
      return { status: 'exists', id };
    }
    const th = await X.fetchThread(id);
    if (!th.focal) throw new Error('Post not found (deleted, private or unavailable)');
    const prefetched = thread ? th : { focal: th.focal, chain: [], parent: th.parent };
    const r = await savePost(c, th.focal, { source: 'Manual', prefetched });
    return { status: r, id, title: titleFor(th.focal) };
  });
}

/** Rebuild the dedupe index from what is already in the Notion database. */
export function rebuildIndex() {
  return schedule('index', async () => {
    const c = await context();
    const map = {};
    let n = 0;
    for await (const page of c.notion.queryAll(c.settings.dataSourceId, { filter: { property: P.id, rich_text: { is_not_empty: true } } })) {
      const id = (page.properties?.[P.id]?.rich_text || []).map((t) => t.plain_text).join('').trim();
      if (id) map[id] = page.id;
      if (++n % 500 === 0) await S.updateState((s) => ({ ...s, running: { kind: 'index', startedAt: s.running?.startedAt, progress: n } }));
    }
    const added = await S.mergeIndex(map);
    S.log('info', `Index rebuilt from Notion: ${Object.keys(map).length} posts (${added} new to this browser)`);
    return { found: Object.keys(map).length, added };
  });
}
