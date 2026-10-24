// X (Twitter) web GraphQL client.
//
// X's web API needs values that rotate (query ids, feature flags, and an
// x-client-transaction-id bound to method + path). Instead of reverse
// engineering them, Roost passively records the request templates your own
// x.com tabs send (webRequest, no content scripts) and replays them from the
// service worker with your session cookies. If nothing was captured yet, it
// opens x.com once in a background tab to record one, then closes it.

import { assembleThread, parseTimeline } from './parse.js';
import { sleep, jitter } from './util.js';

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
export const OPS = ['Bookmarks', 'TweetDetail', 'CreateBookmark', 'DeleteBookmark'];
const KEEP_HEADERS = new Set([
  'authorization', 'x-csrf-token', 'x-client-transaction-id', 'x-client-uuid', 'x-twitter-auth-type',
  'x-twitter-active-user', 'x-twitter-client-language', 'content-type', 'x-xp-forwarded-for',
]);
const STORE_KEY = 'xcap';
const TAB_CAPTURE_COOLDOWN = 10 * 60 * 1000;

// Used only when nothing could be captured (last resort).
const DEFAULT_FEATURES = {
  graphql_timeline_v2_bookmark_timeline: true, rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true, verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true, articles_preview_enabled: true, responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true, view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true, responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false, freedom_of_speech_not_reach_fetch_enabled: true, standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true, rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true, longform_notetweets_inline_media_enabled: true, responsive_web_enhance_cards_enabled: false,
};
const FALLBACK = {
  Bookmarks: { qid: 'QUjXply7fA7fk05FRyajEg', variables: { count: 20, includePromotedContent: false } },
  TweetDetail: {
    qid: 'nBS-WpgA6ZG0CyNHD517JQ',
    variables: { with_rux_injections: false, rankingMode: 'Relevance', includePromotedContent: false, withCommunity: true, withQuickPromoteEligibilityTweetFields: false, withBirdwatchNotes: true, withVoice: true },
    fieldToggles: { withArticleRichContentState: false, withArticlePlainText: true, withGrokAnalyze: false, withDisallowedReplyControls: false },
  },
  DeleteBookmark: { qid: 'Wlmlj2-xzyS1GN3a6cj-mQ', post: true },
};

export class XError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    Object.assign(this, extra);
  }
}

const opFromUrl = (url) => /\/i\/api\/graphql\/[^/]+\/(\w+)/.exec(url)?.[1] || null;
const parseJSON = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

// ---------- capture ----------

let cache = null; // { [op]: template, _meta: {...} }
const waiters = new Set();

async function load() {
  if (!cache) cache = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] || {};
  return cache;
}

async function saveTemplate(op, tpl) {
  const c = await load();
  c[op] = tpl;
  await chrome.storage.local.set({ [STORE_KEY]: c });
  for (const w of waiters) w(op);
}

function tweetIdFromBody(body) {
  const b = parseJSON(body);
  return b?.variables?.tweet_id || b?.variables?.tweetId || null;
}

/** Register webRequest listeners. Must run synchronously at service worker start. */
export function installCapture({ onBookmarkCreated, onBookmarkDeleted } = {}) {
  const urls = OPS.map((op) => `https://x.com/i/api/graphql/*/${op}*`);
  const pending = new Map();
  chrome.webRequest.onBeforeRequest.addListener(
    (d) => {
      if (d.tabId < 0) return; // our own service worker requests
      const raw = d.requestBody?.raw?.[0]?.bytes;
      const body = raw ? new TextDecoder().decode(raw) : null;
      pending.set(d.requestId, body);
      if (pending.size > 50) pending.delete(pending.keys().next().value);
      const op = opFromUrl(d.url);
      const id = (op === 'CreateBookmark' || op === 'DeleteBookmark') && tweetIdFromBody(body);
      if (id && op === 'CreateBookmark') onBookmarkCreated?.(id);
      if (id && op === 'DeleteBookmark') onBookmarkDeleted?.(id);
    },
    { urls },
    ['requestBody'],
  );
  chrome.webRequest.onSendHeaders.addListener(
    (d) => {
      if (d.tabId < 0) return;
      const headers = {};
      for (const h of d.requestHeaders || []) {
        const n = h.name.toLowerCase();
        if (KEEP_HEADERS.has(n) && h.value) headers[n] = h.value;
      }
      const body = pending.get(d.requestId) ?? null;
      pending.delete(d.requestId);
      const op = opFromUrl(d.url);
      if (!op || !headers.authorization) return;
      saveTemplate(op, { method: d.method, url: d.url, body, headers, at: Date.now() });
    },
    { urls },
    ['requestHeaders'],
  );
}

/** Make our service-worker requests look like they come from x.com (Origin/Referer). */
export async function installHeaderRules() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'set', value: 'https://x.com' },
            { header: 'referer', operation: 'set', value: 'https://x.com/i/bookmarks' },
          ],
        },
        condition: { urlFilter: '|https://x.com/i/api/', tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] },
      },
    ],
  });
}

async function cookie(name) {
  try {
    return (await chrome.cookies.get({ url: 'https://x.com', name }))?.value || null;
  } catch {
    return null;
  }
}

export async function isLoggedIn() {
  return !!(await cookie('auth_token')) && !!(await cookie('ct0'));
}

/** User id of the logged-in account (from the twid cookie, "u=123"). */
export async function viewerId() {
  const twid = decodeURIComponent((await cookie('twid')) || '');
  return /u=(\d+)/.exec(twid)?.[1] || null;
}

function waitForCapture(op, since, timeoutMs) {
  return new Promise((resolve) => {
    const done = (ok) => {
      waiters.delete(fn);
      clearTimeout(timer);
      resolve(ok);
    };
    const fn = (o) => o === op && cache?.[op]?.at >= since && done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    waiters.add(fn);
  });
}

let tabCapture = null;

/** Open x.com in a background tab just long enough to record a request template. */
export async function captureViaTab(op, hintTweetId, { force = false } = {}) {
  if (op !== 'Bookmarks' && op !== 'TweetDetail') return false;
  const c = await load();
  c._meta ||= {};
  const last = c._meta[`tab_${op}`] || 0;
  if (!force && Date.now() - last < TAB_CAPTURE_COOLDOWN) return false;
  if (tabCapture) return tabCapture;
  tabCapture = (async () => {
    c._meta[`tab_${op}`] = Date.now();
    await chrome.storage.local.set({ [STORE_KEY]: c });
    const url = op === 'Bookmarks' ? 'https://x.com/i/bookmarks' : `https://x.com/i/web/status/${hintTweetId || '20'}`;
    const since = Date.now();
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      return await waitForCapture(op, since, 30000);
    } finally {
      if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
      tabCapture = null;
    }
  })();
  return tabCapture;
}

function fallbackTemplate(op, base) {
  const fb = FALLBACK[op];
  if (!fb) return null;
  const headers = {
    authorization: base?.headers?.authorization || `Bearer ${BEARER}`,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': base?.headers?.['x-twitter-client-language'] || 'en',
    'content-type': 'application/json',
  };
  if (fb.post) {
    return { method: 'POST', url: `https://x.com/i/api/graphql/${fb.qid}/${op}`, body: JSON.stringify({ variables: {}, queryId: fb.qid }), headers, fallback: true };
  }
  const u = new URL(`https://x.com/i/api/graphql/${fb.qid}/${op}`);
  u.searchParams.set('variables', JSON.stringify(fb.variables));
  u.searchParams.set('features', JSON.stringify(DEFAULT_FEATURES));
  if (fb.fieldToggles) u.searchParams.set('fieldToggles', JSON.stringify(fb.fieldToggles));
  return { method: 'GET', url: u.toString(), body: null, headers, fallback: true };
}

// ---------- requests ----------

let nextSlot = 0;
async function pace(minGap) {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + jitter(minGap, minGap * 0.6);
  if (wait) await sleep(wait);
}

function buildRequest(tpl, vars, dropVars, patches, ct0) {
  const u = new URL(tpl.url);
  let body = null;
  if (tpl.method === 'GET') {
    const v = parseJSON(u.searchParams.get('variables')) || {};
    for (const k of dropVars) delete v[k];
    Object.assign(v, vars);
    u.searchParams.set('variables', JSON.stringify(v));
    if (patches && Object.keys(patches).length) {
      const f = parseJSON(u.searchParams.get('features')) || {};
      u.searchParams.set('features', JSON.stringify({ ...f, ...patches }));
    }
  } else {
    const b = parseJSON(tpl.body) || {};
    b.variables = { ...(b.variables || {}) };
    for (const k of dropVars) delete b.variables[k];
    Object.assign(b.variables, vars);
    if (patches && b.features) Object.assign(b.features, patches);
    body = JSON.stringify(b);
  }
  const headers = { ...tpl.headers, 'x-csrf-token': ct0 };
  if (!headers['content-type']) headers['content-type'] = 'application/json';
  return { url: u.toString(), init: { method: tpl.method, headers, body, credentials: 'include', cache: 'no-store' } };
}

/**
 * Call a GraphQL operation using the freshest captured template.
 * vars override template variables; dropVars removes stale ones (e.g. cursor).
 */
let rulesReady = null;
const ensureRules = () => (rulesReady ||= installHeaderRules().catch((e) => {
  rulesReady = null;
  throw e;
}));

export async function gql(op, { vars = {}, dropVars = ['cursor'], hintTweetId, minGap = 1100 } = {}) {
  await ensureRules();
  const ct0 = await cookie('ct0');
  if (!ct0 || !(await cookie('auth_token'))) throw new XError('not_logged_in', 'Not logged in to x.com in this browser');
  const c = await load();
  let tpl = c[op];
  if (!tpl && (await captureViaTab(op, hintTweetId))) tpl = c[op];
  if (!tpl) tpl = fallbackTemplate(op, c.Bookmarks || c.TweetDetail);
  if (!tpl) throw new XError('no_template', `No request template for ${op} yet`);

  const rl = c._meta?.[`rl_${op}`];
  if (rl && rl > Date.now()) throw new XError('rate_limited', `X rate limit for ${op}`, { resetAt: rl });

  let recaptured = false;
  let patched = false;
  for (;;) {
    await pace(minGap);
    const patches = c._meta?.[`feat_${op}`];
    const { url, init } = buildRequest(tpl, vars, dropVars, patches, ct0);
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new XError('network', `Network error calling X: ${e.message}`);
    }
    const remaining = Number(res.headers.get('x-rate-limit-remaining'));
    const reset = Number(res.headers.get('x-rate-limit-reset')) * 1000;
    if (res.status === 429 || (Number.isFinite(remaining) && remaining <= 1 && reset)) {
      c._meta ||= {};
      c._meta[`rl_${op}`] = reset || Date.now() + 15 * 60 * 1000;
      await chrome.storage.local.set({ [STORE_KEY]: c });
      if (res.status === 429) throw new XError('rate_limited', `X rate limit for ${op}`, { resetAt: c._meta[`rl_${op}`] });
    }
    if (res.ok) {
      const json = await res.json();
      if (json?.errors?.length && !json.data) throw new XError('api_error', json.errors.map((e) => e.message).join('; '));
      return json;
    }
    const text = await res.text().catch(() => '');
    const missing = /features cannot be null:\s*([\w ,]+)/i.exec(text);
    if (res.status === 400 && missing && !patched) {
      patched = true;
      c._meta ||= {};
      const p = (c._meta[`feat_${op}`] ||= {});
      for (const name of missing[1].split(',').map((s) => s.trim()).filter(Boolean)) p[name] = true;
      await chrome.storage.local.set({ [STORE_KEY]: c });
      continue;
    }
    if ([400, 401, 403, 404].includes(res.status) && !recaptured) {
      recaptured = true;
      if (await captureViaTab(op, hintTweetId, { force: tpl.fallback || res.status !== 403 })) {
        tpl = c[op];
        continue;
      }
    }
    if (res.status === 401 || res.status === 403) throw new XError('auth', `X rejected the request (${res.status}). Open x.com once and try again.`);
    throw new XError('http', `X ${op} failed: HTTP ${res.status} ${text.slice(0, 160)}`);
  }
}

// ---------- high level ----------

export async function fetchBookmarks(cursor, count = 20) {
  const vars = { count };
  if (cursor) vars.cursor = cursor;
  const json = await gql('Bookmarks', { vars, minGap: 1300 });
  return parseTimeline(json);
}

export async function fetchTweetDetail(id, cursor) {
  const vars = { focalTweetId: id };
  if (cursor) vars.cursor = cursor;
  const json = await gql('TweetDetail', { vars, dropVars: ['cursor', 'controller_data', 'referrer'], hintTweetId: id, minGap: 1500 });
  return parseTimeline(json);
}

/** Fetch the author's thread around `id` (follows "show more" cursors). */
export async function fetchThread(id, maxPages = 6) {
  const pool = new Map();
  const moduleOf = new Map();
  const showMore = [];
  const used = new Set();
  const add = ({ items, cursors }) => {
    for (const it of items) {
      if (!it.tweet || it.tweet.unavailable) continue;
      pool.set(it.tweet.id, it.tweet);
      if (it.moduleId) moduleOf.set(it.tweet.id, it.moduleId);
    }
    showMore.push(...cursors.showMore);
  };
  add(await fetchTweetDetail(id));
  for (let i = 1; i < maxPages; i++) {
    const { chain } = assembleThread(pool, id);
    const tail = chain[chain.length - 1];
    if (!tail) break;
    const next = showMore.find((c) => !used.has(c.value) && c.moduleId && c.moduleId === moduleOf.get(tail.id));
    if (!next) break;
    used.add(next.value);
    add(await fetchTweetDetail(id, next.value));
  }
  const { chain, parent } = assembleThread(pool, id);
  return { focal: pool.get(id) || null, chain, parent };
}

export async function deleteBookmark(id) {
  await gql('DeleteBookmark', { vars: { tweet_id: id }, dropVars: ['tweet_id'], minGap: 1500 });
}

export async function captureStatus() {
  const c = await load();
  const out = {};
  for (const op of OPS) out[op] = c[op]?.at || null;
  out.rateLimits = Object.fromEntries(Object.entries(c._meta || {}).filter(([k, v]) => k.startsWith('rl_') && v > Date.now()));
  return out;
}

export async function resetCapture() {
  cache = {};
  await chrome.storage.local.remove(STORE_KEY);
}
