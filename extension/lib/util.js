// Small shared helpers. Pure functions only (safe to import from Node tests).

// globalThis.__ROOST_TIME_SCALE__ lets tests run pacing/backoff faster.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (globalThis.__ROOST_TIME_SCALE__ ?? 1)));

export const jitter = (base, spread = base) => base + Math.random() * spread;

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Truncate on code points so emoji/surrogate pairs never get split.
export function truncate(str, max, ellipsis = '…') {
  if (!str) return '';
  const cps = Array.from(str);
  return cps.length <= max ? str : cps.slice(0, max - ellipsis.length).join('') + ellipsis;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
export const decodeEntities = (s) => (s ? s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m]) : '');

const TWITTER_EPOCH = 1288834974657n;

// Snowflake id -> Date (null if not a snowflake).
export function snowflakeDate(id) {
  try {
    if (!/^\d{15,20}$/.test(String(id))) return null;
    const ms = Number((BigInt(id) >> 22n) + TWITTER_EPOCH);
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const stripTags = (html) => (html ? html.replace(/<[^>]*>/g, '').trim() : '');

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const tweetUrl = (handle, id) => `https://x.com/${handle || 'i/web'}/status/${id}`;

// Parse "https://x.com/user/status/123?s=20" (or twitter.com) -> "123".
export function tweetIdFromUrl(url) {
  const m = /(?:x|twitter)\.com\/(?:[^/]+|i\/web)\/status(?:es)?\/(\d{1,25})/.exec(url || '');
  return m ? m[1] : null;
}

// Depth-first search for the first value under `key` that satisfies `pred`.
export function findKey(obj, key, pred = () => true, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key) && pred(obj[key])) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findKey(v, key, pred, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

export function compactNumber(n) {
  if (n === null || n === undefined) return '';
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}
