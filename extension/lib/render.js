// Turn normalized posts into Notion page properties + content blocks.
// Pure module (no chrome.*). Respects Notion limits: 2000 chars per text
// object, 100 items per rich_text array, 2 nesting levels per request.

import { P, X_COLLECTION, X_TYPE, xKey } from './schema.js';
import { postTypes } from './parse.js';
import { compactNumber, fmtDate, hostOf, truncate, tweetUrl } from './util.js';

const MAX_TEXT = 1900;

// ---------- rich text ----------

// Notion counts UTF-16 units (an emoji is 2), so measure .length, never split a surrogate pair.
function splitText(s) {
  const out = [];
  let cur = '';
  for (const cp of s) {
    if (cur.length + cp.length > MAX_TEXT) {
      out.push(cur);
      cur = '';
    }
    cur += cp;
  }
  if (cur) out.push(cur);
  return out;
}

const validUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u) && u.length < 2000;

export function rt(content, { link, bold, italic, code, color } = {}) {
  if (content === null || content === undefined || content === '') return [];
  const annotations = {};
  if (bold) annotations.bold = true;
  if (italic) annotations.italic = true;
  if (code) annotations.code = true;
  if (color) annotations.color = color;
  return splitText(String(content)).map((c) => {
    const o = { type: 'text', text: { content: c } };
    if (link && validUrl(link)) o.text.link = { url: link };
    if (Object.keys(annotations).length) o.annotations = annotations;
    return o;
  });
}

const TOKEN = /(https?:\/\/[^\s<>"]+)|(?<![\w@/])@(\w{1,15})|(?<![\w&/#])#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)|(?<![\w$])\$([A-Za-z]{1,6})\b/gu;

/** Rich text with clickable URLs, @mentions, #hashtags and $cashtags. */
export function linkify(text, opts = {}) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    let [tok] = m;
    let href;
    if (m[1]) {
      // Drop trailing punctuation, keeping ")" when it closes a "(" inside the URL.
      const opens = (s) => s.split('(').length - s.split(')').length;
      while (/[.,!?;:'"]$/.test(tok) || (tok.endsWith(')') && opens(tok) < 0)) tok = tok.slice(0, -1);
      href = tok;
    } else if (m[2]) href = `https://x.com/${m[2]}`;
    else if (m[3]) href = `https://x.com/hashtag/${encodeURIComponent(m[3])}`;
    else href = `https://x.com/search?q=%24${m[4]}`;
    if (m.index > last) out.push(...rt(text.slice(last, m.index), opts));
    out.push(...rt(tok, { ...opts, link: href }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(...rt(text.slice(last), opts));
  return mergeLimit(out);
}

// Keep rich_text arrays under Notion's 100-item cap by flattening overflow to plain text.
function mergeLimit(arr, max = 100) {
  if (arr.length <= max) return arr;
  const head = arr.slice(0, max - 1);
  const rest = arr.slice(max - 1).map((o) => o.text.content).join('');
  return [...head, ...rt(rest)].slice(0, max);
}

const gray = (s, link) => rt(s, { color: 'gray', link });

// ---------- blocks ----------

const block = (type, body) => ({ object: 'block', type, [type]: body });
export const para = (rich, color) => block('paragraph', color ? { rich_text: rich, color } : { rich_text: rich });
const heading = (lvl, rich) => block(`heading_${lvl}`, { rich_text: rich });
const divider = () => block('divider', {});
const bullet = (rich) => block('bulleted_list_item', { rich_text: rich });
const callout = (rich, emoji, color, children) => block('callout', { rich_text: rich, icon: { type: 'emoji', emoji }, color, ...(children?.length ? { children } : {}) });
const quote = (rich, children) => block('quote', { rich_text: rich, ...(children?.length ? { children } : {}) });
const toggle = (rich, children) => block('toggle', { rich_text: rich, children });
const bookmark = (url, caption) => block('bookmark', { url, caption: caption || [] });

function fileObj(src) {
  return src.upload ? { type: 'file_upload', file_upload: { id: src.upload } } : { type: 'external', external: { url: src.url } };
}

export function mediaBlocks(media, uploads, opts = {}) {
  const out = [];
  for (const m of media || []) {
    const upload = uploads?.get(m.url);
    const caption = m.alt ? rt(truncate(m.alt, 1900)) : [];
    if (m.type === 'photo') {
      if (!upload && !validUrl(m.url)) continue;
      out.push(block('image', { ...fileObj({ upload, url: m.url }), caption }));
    } else if (upload) {
      out.push(block('video', { ...fileObj({ upload }), caption }));
    } else if (validUrl(m.url)) {
      if (opts.safe) out.push(bookmark(m.url, rt(m.type === 'gif' ? 'GIF' : 'Video')));
      else out.push(block('video', { type: 'external', external: { url: m.url }, caption }));
    }
  }
  return out;
}

function textBlocks(text, color) {
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => para(linkify(p), color));
}

function authorLine(p, { prefix = '', showDate = true } = {}) {
  const a = p.author || {};
  const badge = a.verified || a.blueVerified ? ' ✓' : '';
  return [
    ...(prefix ? gray(prefix) : []),
    ...rt(a.name || a.handle || 'Unknown', { bold: true, link: a.handle ? `https://x.com/${a.handle}` : undefined }),
    ...gray(`${badge} @${a.handle || '?'}`),
    ...(showDate && p.createdAt ? gray(' · ' + fmtDate(p.createdAt), p.url) : []),
  ];
}

function pollBlocks(poll, depth) {
  const total = poll.options.reduce((s, o) => s + (o.votes || 0), 0) || 0;
  const items = poll.options.map((o) => {
    const pct = total ? Math.round((o.votes / total) * 100) : 0;
    return bullet([...rt(o.label, { bold: true }), ...gray(` — ${o.votes} vote${o.votes === 1 ? '' : 's'} (${pct}%)`)]);
  });
  const head = rt(`Poll · ${total} votes${poll.final ? ' · final' : poll.endsAt ? ' · ends ' + fmtDate(poll.endsAt) : ''}`);
  return depth === 0 ? [callout(head, '📊', 'gray_background', items)] : [para(head), ...items];
}

function articleBlocks(a, uploads) {
  const out = [heading(3, rt(`📰 ${a.title || 'Article'}`, { link: a.url || undefined }))];
  if (a.cover) {
    const up = uploads?.get(a.cover);
    if (up || validUrl(a.cover)) out.push(block('image', { ...fileObj({ upload: up, url: a.cover }), caption: [] }));
  }
  if (a.text) out.push(...textBlocks(a.text));
  else if (a.preview) out.push(...textBlocks(a.preview, 'gray'));
  return out;
}

/** Body of a single post: text, media, card, poll, article, quoted post. depth 0 = top level. */
export function postBody(p, uploads, depth = 0, opts = {}) {
  const out = [...textBlocks(p.text)];
  out.push(...mediaBlocks(p.media, uploads, opts));
  if (p.article) out.push(...articleBlocks(p.article, uploads));
  if (p.poll) out.push(...pollBlocks(p.poll, depth));
  if (p.card?.url && validUrl(p.card.url)) {
    const cap = [p.card.title, p.card.description].filter(Boolean).join(' — ');
    out.push(bookmark(p.card.url, rt(truncate(cap, 1900))));
  }
  if (p.quoted) {
    const q = p.quoted;
    const head = [...authorLine(q, { prefix: '↪ Quoting ' }), ...rt('\n'), ...linkify(q.text || '')];
    const kids = depth === 0 ? mediaBlocks(q.media, uploads, opts).concat(q.card?.url && validUrl(q.card.url) ? [bookmark(q.card.url)] : []) : [];
    out.push(quote(mergeLimit(head), kids));
  } else if (p.quotedUrl && validUrl(p.quotedUrl)) {
    out.push(para([...gray('↪ Quoting '), ...rt(p.quotedUrl, { link: p.quotedUrl })]));
  }
  return out;
}

function statsLine(t) {
  const s = t.stats || {};
  const parts = [
    ['❤️', s.likes], ['🔁', s.reposts], ['💬', s.replies], ['🗨️', s.quotes], ['🔖', s.bookmarks], ['👁', s.views],
  ].filter(([, v]) => v !== null && v !== undefined).map(([e, v]) => `${e} ${compactNumber(v)}`);
  return parts.length ? para(gray(parts.join('  ·  '))) : null;
}

/**
 * Full page content. ctx = { chain, parent, uploads, raw, savedAt, safe }.
 * chain: the author's thread (oldest -> newest) containing t, or empty.
 */
export function buildBlocks(t, ctx = {}) {
  const { chain = [], parent = null, uploads = new Map(), raw = false, safe = false } = ctx;
  const out = [para(authorLine(t))];
  if (parent) {
    const kids = [para(authorLine(parent)), ...postBody(parent, uploads, 1, { safe })];
    out.push(callout(rt('Replying to ' + (parent.author?.name || '@' + parent.author?.handle)), '💬', 'gray_background', kids.slice(0, 50)));
  } else if (t.replyTo && t.replyTo.userId !== t.author.id) {
    const u = tweetUrl(t.replyTo.handle, t.replyTo.id);
    out.push(para([...gray('↩ Replying to '), ...rt('@' + (t.replyTo.handle || 'post'), { link: u })]));
  }
  if (chain.length > 1) {
    out.push(heading(3, rt(`🧵 Thread · ${chain.length} posts`)));
    chain.forEach((p, i) => {
      if (i) out.push(divider());
      out.push(para([...gray(`${i + 1}/${chain.length}`, p.url), ...(p.id === t.id ? rt('  ★ bookmarked', { color: 'orange' }) : [])]));
      out.push(...postBody(p, uploads, 0, { safe }));
    });
  } else {
    out.push(...postBody(t, uploads, 0, { safe }));
  }
  if (t.communityNote) out.push(callout(rt(truncate(t.communityNote, 1900)), '📝', 'yellow_background'));
  const stats = statsLine(t);
  if (stats) out.push(stats);
  out.push(divider());
  out.push(para([...gray(`Saved by Trove · ${fmtDate(ctx.savedAt || new Date().toISOString())} · `), ...rt('Open on X', { link: t.url, color: 'gray' })]));
  if (raw) out.push(toggle(gray('Raw data (JSON)'), [block('code', { language: 'json', rich_text: rt(JSON.stringify(chain.length > 1 ? { post: t, thread: chain } : t)).slice(0, 30) })]));
  return out;
}

/** Blocks appended to an existing page when a thread is unrolled later. */
export function threadAppendBlocks(t, chain, parent, uploads) {
  const out = [divider(), heading(3, rt(`🧵 Thread · ${chain.length} posts (unrolled ${fmtDate(new Date().toISOString())})`))];
  if (parent) out.push(callout(rt('Replying to ' + (parent.author?.name || '')), '💬', 'gray_background', [para(authorLine(parent)), ...postBody(parent, uploads, 1)]));
  chain.forEach((p, i) => {
    if (i) out.push(divider());
    out.push(para([...gray(`${i + 1}/${chain.length}`, p.url), ...(p.id === t.id ? rt('  ★ bookmarked', { color: 'orange' }) : [])]));
    out.push(...postBody(p, uploads));
  });
  return out;
}

// ---------- properties ----------

function shortUrl(u) {
  try {
    const x = new URL(u);
    return truncate(x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, ''), 80);
  } catch {
    return truncate(u, 80);
  }
}

const selectName = (s) => truncate(String(s).replace(/,/g, ' ').trim(), 90);

export function titleFor(t) {
  if (t.article?.title) return truncate(t.article.title, 180);
  const firstLine = (t.text || '').split('\n').find((l) => l.trim()) || '';
  if (firstLine) return truncate(firstLine.trim(), 140);
  const kind = t.media?.[0] ? (t.media[0].type === 'photo' ? 'Photo' : 'Video') : 'Post';
  return `${kind} by @${t.author?.handle || 'unknown'}`;
}

function joinLinked(items) {
  const out = [];
  items.forEach(([label, href], i) => {
    if (i) out.push(...rt(' '));
    out.push(...rt(label, { link: href }));
  });
  return mergeLimit(out);
}

/** All text of a thread, for the "Text" property (searchable). */
export function fullText(t, chain = []) {
  const parts = chain.length > 1 ? chain.map((p, i) => `${i + 1}/${chain.length} ${p.text}`) : [t.text];
  if (t.quoted?.text) parts.push(`↪ @${t.quoted.author?.handle}: ${t.quoted.text}`);
  if (t.article?.title) parts.unshift(t.article.title);
  return parts.filter(Boolean).join('\n\n');
}

export function buildProperties(t, ctx = {}) {
  const { chain = [], source = 'Bookmark', bookmarkedAt = null, tags = [], unroll = false, collection = X_COLLECTION } = ctx;
  const threadLen = chain.length > 1 ? chain.length : ctx.threadLen || null;
  const a = t.author || {};
  const s = t.stats || {};
  const allUrls = [...new Set([...(t.urls || []).map((u) => u.url), t.card?.url].filter(validUrl))];
  const external = allUrls.filter((u) => !/^https?:\/\/(x|twitter)\.com\//.test(u));
  const media = [...(t.media || []), ...(t.quoted?.media || [])].filter((m) => validUrl(m.url));

  const props = {
    [P.title]: { title: rt(titleFor(t)) },
    [P.kind]: { select: { name: X_TYPE } },
    [P.platform]: { select: { name: 'X' } },
    [P.domain]: { rich_text: rt('x.com') },
    [P.site]: { rich_text: rt('X') },
    [P.key]: { rich_text: rt(xKey(t.id)) },
    [P.author]: { rich_text: rt(a.name || a.handle || '') },
    [P.handle]: { rich_text: a.handle ? rt('@' + a.handle, { link: `https://x.com/${a.handle}` }) : [] },
    [P.url]: { url: t.url },
    [P.id]: { rich_text: rt(t.id) },
    [P.text]: { rich_text: linkify(fullText(t, chain)) },
    [P.type]: { multi_select: postTypes(t, threadLen || 0).map((name) => ({ name })) },
    [P.threadLen]: { number: threadLen },
    [P.likes]: { number: s.likes ?? null },
    [P.reposts]: { number: s.reposts ?? null },
    [P.replies]: { number: s.replies ?? null },
    [P.quotes]: { number: s.quotes ?? null },
    [P.bookmarks]: { number: s.bookmarks ?? null },
    [P.views]: { number: s.views ?? null },
    [P.media]: {
      files: media.slice(0, 20).map((m, i) => ({
        type: 'external',
        name: `${m.type}-${i + 1}${m.type === 'photo' ? '.jpg' : '.mp4'}`,
        external: { url: m.url },
      })),
    },
    [P.links]: { rich_text: joinLinked(external.map((u) => [shortUrl(u), u])) },
    [P.link]: { url: external[0] || null },
    [P.hashtags]: { rich_text: joinLinked((t.hashtags || []).map((h) => ['#' + h, `https://x.com/hashtag/${encodeURIComponent(h)}`])) },
    [P.mentions]: { rich_text: joinLinked((t.mentions || []).map((m) => ['@' + m.handle, `https://x.com/${m.handle}`])) },
    [P.verified]: { checkbox: !!(a.verified || a.blueVerified) },
    [P.followers]: { number: a.followers ?? null },
    [P.quoted]: { url: validUrl(t.quotedUrl) ? t.quotedUrl : null },
    [P.replyTo]: { url: t.replyTo ? tweetUrl(t.replyTo.handle, t.replyTo.id) : null },
    [P.source]: { select: { name: source } },
    [P.unroll]: { checkbox: !!unroll },
    [P.collection]: { select: { name: collection } },
  };
  if (t.createdAt) props[P.posted] = { date: { start: t.createdAt } };
  if (bookmarkedAt) props[P.bookmarked] = { date: { start: bookmarkedAt } };
  if (tags.length) props[P.tags] = { multi_select: [...new Set(tags.map(selectName))].map((name) => ({ name })) };
  if (t.lang && t.lang !== 'und') props[P.lang] = { select: { name: selectName(t.lang) } };
  if (t.source) props[P.client] = { select: { name: selectName(t.source) } };
  return props;
}

// ---------- auto tags ----------

/**
 * Rules text, one per line:  Tag: matcher, matcher, ...
 *   keyword        -> case-insensitive match in text
 *   @handle        -> author handle
 *   domain.com     -> any link on that domain
 *   /regex/flags   -> regex on text
 *   type:Video     -> post type (Photo, Video, Thread, Article, ...)
 */
export function parseRules(text) {
  const rules = [];
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i < 1 || line.trim().startsWith('#')) continue;
    const tag = line.slice(0, i).trim();
    const matchers = line.slice(i + 1).split(',').map((s) => s.trim()).filter(Boolean);
    if (tag && matchers.length) rules.push({ tag, matchers });
  }
  return rules;
}

export function autoTags(t, rules, chain = []) {
  if (!rules?.length) return [];
  const text = fullText(t, chain).toLowerCase();
  const handle = (t.author?.handle || '').toLowerCase();
  const hosts = [...(t.urls || []).map((u) => u.url), t.card?.url].filter(Boolean).map(hostOf);
  const types = postTypes(t, chain.length).map((x) => x.toLowerCase());
  const tags = [];
  for (const { tag, matchers } of rules) {
    const hit = matchers.some((m) => {
      if (m.startsWith('@')) return handle === m.slice(1).toLowerCase();
      if (m.startsWith('type:')) return types.includes(m.slice(5).toLowerCase());
      const re = /^\/(.+)\/([a-z]*)$/.exec(m);
      if (re) {
        try { return new RegExp(re[1], re[2]).test(fullText(t, chain)); } catch { return false; }
      }
      if (/^[\w-]+(\.[\w-]+)+$/.test(m) && !m.includes(' ')) return hosts.some((h) => h === m.toLowerCase() || h.endsWith('.' + m.toLowerCase()));
      return text.includes(m.toLowerCase());
    });
    if (hit) tags.push(tag);
  }
  return tags;
}
