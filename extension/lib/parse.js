// Parse X (Twitter) GraphQL timeline responses into compact, normalized posts.
// Pure module: no chrome.* APIs, so it runs in Node tests as-is.

import { decodeEntities, findKey, snowflakeDate, stripTags, toNumber, tweetUrl, hostOf } from './util.js';

// ---------- timeline ----------

/**
 * Walk any timeline response (Bookmarks, TweetDetail, ...) and return
 * { items: [{ tweet, raw, entryId, sortIndex, moduleId }], cursors: { bottom, top, showMore: [{ value, moduleId }] } }.
 */
export function parseTimeline(json) {
  const instructions = findKey(json?.data ?? json, 'instructions', Array.isArray) || [];
  const items = [];
  const cursors = { bottom: null, top: null, showMore: [] };

  const onCursor = (c, moduleId) => {
    const type = c?.cursorType || c?.cursor_type;
    const value = c?.value;
    if (!value) return;
    if (type === 'Bottom') cursors.bottom = value;
    else if (type === 'Top') cursors.top = value;
    else if (type === 'ShowMore' || type === 'ShowMoreThreads' || type === 'ShowMoreThreadsPrompt') cursors.showMore.push({ value, moduleId });
  };

  const onItemContent = (ic, entryId, sortIndex, moduleId) => {
    if (!ic) return;
    const t = ic.itemType || ic.__typename;
    if (t === 'TimelineTweet' || ic.tweet_results) {
      const raw = ic.tweet_results?.result;
      const tweet = normalizeTweet(raw);
      if (tweet) items.push({ tweet, entryId, sortIndex, moduleId, promoted: !!ic.promotedMetadata });
    } else if (t === 'TimelineTimelineCursor' || ic.cursorType) {
      onCursor(ic, moduleId);
    }
  };

  const onEntry = (entry, moduleIdOverride) => {
    if (!entry) return;
    const c = entry.content || entry.item?.content || {};
    const kind = c.entryType || c.__typename;
    const entryId = entry.entryId || '';
    if (kind === 'TimelineTimelineItem') onItemContent(c.itemContent, entryId, entry.sortIndex, moduleIdOverride);
    else if (kind === 'TimelineTimelineModule') {
      for (const it of c.items || []) onItemContent(it.item?.itemContent, it.entryId || entryId, entry.sortIndex, entryId);
    } else if (kind === 'TimelineTimelineCursor' || c.cursorType) onCursor(c, moduleIdOverride);
  };

  for (const ins of instructions) {
    switch (ins.type) {
      case 'TimelineAddEntries':
        (ins.entries || []).forEach((e) => onEntry(e));
        break;
      case 'TimelineReplaceEntry':
        onEntry(ins.entry);
        break;
      case 'TimelineAddToModule':
        for (const it of ins.moduleItems || []) onItemContent(it.item?.itemContent, it.entryId, undefined, ins.moduleEntryId);
        break;
      case 'TimelinePinEntry':
        onEntry(ins.entry);
        break;
      default:
        break;
    }
  }
  return { items: items.filter((i) => !i.promoted), cursors };
}

// ---------- users ----------

export function normalizeUser(u) {
  if (!u || u.__typename === 'UserUnavailable') return null;
  const l = u.legacy || {};
  const handle = u.core?.screen_name ?? l.screen_name ?? '';
  let avatar = u.avatar?.image_url ?? l.profile_image_url_https ?? '';
  if (avatar) avatar = avatar.replace(/_normal(\.\w+)$/, '_400x400$1');
  return {
    id: u.rest_id || l.id_str || '',
    name: u.core?.name ?? l.name ?? handle,
    handle,
    avatar,
    verified: !!(u.verification?.verified ?? l.verified),
    blueVerified: !!u.is_blue_verified,
    verifiedType: u.verification?.verified_type ?? l.verified_type ?? null,
    followers: toNumber(l.followers_count ?? u.relationship_counts?.followers),
    following: toNumber(l.friends_count ?? u.relationship_counts?.following),
    description: l.description ?? u.profile_bio?.description ?? '',
    location: u.location?.location ?? l.location ?? '',
    protected: !!(u.privacy?.protected ?? l.protected),
    createdAt: toIso(u.core?.created_at ?? l.created_at),
  };
}

// ---------- tweets ----------

function toIso(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function unwrap(result) {
  let r = result;
  for (let i = 0; i < 3 && r; i++) {
    if (r.__typename === 'TweetWithVisibilityResults' || (r.tweet && !r.legacy)) r = r.tweet;
    else break;
  }
  return r;
}

function bestVideoVariant(info) {
  const mp4 = (info?.variants || []).filter((v) => (v.content_type || '').includes('mp4'));
  mp4.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return mp4;
}

function normalizeMedia(m) {
  const type = m.type === 'animated_gif' ? 'gif' : m.type === 'video' ? 'video' : 'photo';
  const base = m.media_url_https || '';
  const out = {
    id: m.id_str || m.media_key || '',
    type,
    preview: base,
    url: type === 'photo' ? photoOrig(base) : '',
    width: m.original_info?.width ?? null,
    height: m.original_info?.height ?? null,
    alt: m.ext_alt_text || '',
  };
  if (type !== 'photo') {
    const variants = bestVideoVariant(m.video_info);
    out.durationMs = m.video_info?.duration_millis ?? null;
    out.variants = variants.map((v) => ({ url: v.url, bitrate: v.bitrate || 0 }));
    out.url = variants[0]?.url || '';
  }
  return out;
}

function photoOrig(url) {
  if (!url) return '';
  const m = /^(https:\/\/pbs\.twimg\.com\/media\/[^.?]+)\.(\w+)/.exec(url);
  return m ? `${m[1]}?format=${m[2]}&name=orig` : url;
}

function bindingValues(card) {
  const map = {};
  for (const bv of card?.legacy?.binding_values || card?.binding_values || []) {
    const v = bv.value || {};
    map[bv.key] = v.string_value ?? v.image_value?.url ?? v.boolean_value ?? v.scribe_key ?? v.user_value?.id_str ?? null;
  }
  return map;
}

function normalizeCard(card, urlMap) {
  if (!card) return { card: null, poll: null };
  const name = card.legacy?.name || card.name || '';
  const bv = bindingValues(card);
  const pollMatch = /^poll(\d)choice/.exec(name);
  if (pollMatch) {
    const n = Number(pollMatch[1]);
    const options = [];
    for (let i = 1; i <= n; i++) {
      if (bv[`choice${i}_label`] == null) continue;
      options.push({ label: bv[`choice${i}_label`], votes: toNumber(bv[`choice${i}_count`]) ?? 0 });
    }
    return { card: null, poll: { options, endsAt: toIso(bv.end_datetime_utc), final: bv.counts_are_final === true || bv.counts_are_final === 'true' } };
  }
  let url = bv.card_url || card.legacy?.url || card.url || '';
  if (urlMap[url]) url = urlMap[url];
  if (name.startsWith('unified_card') && bv.unified_card) {
    try {
      const uc = JSON.parse(bv.unified_card);
      const dest = Object.values(uc.destination_objects || {})[0]?.data;
      url = dest?.url_data?.url || url;
    } catch { /* ignore */ }
  }
  const image =
    bv.photo_image_full_size_original || bv.thumbnail_image_original || bv.summary_photo_image_original ||
    bv.player_image_original || bv.thumbnail_image_large || bv.photo_image_full_size_large || null;
  if (!url && !bv.title) return { card: null, poll: null };
  return {
    card: { kind: name, url, title: bv.title || '', description: bv.description || '', domain: bv.vanity_url || bv.domain || hostOf(url), image },
    poll: null,
  };
}

function normalizeArticle(a) {
  const r = a?.article_results?.result;
  if (!r) return null;
  return {
    id: r.rest_id || '',
    title: r.title || '',
    preview: r.preview_text || '',
    text: r.plain_text || '',
    cover: r.cover_media?.media_info?.original_img_url || '',
    url: r.rest_id ? `https://x.com/i/article/${r.rest_id}` : '',
  };
}

/**
 * Convert a GraphQL tweet result into a normalized post. Returns null for
 * non-tweets; returns { id, unavailable: true, reason } for tombstones.
 */
export function normalizeTweet(result, depth = 0) {
  const r = unwrap(result);
  if (!r) return null;
  if (r.__typename === 'TweetTombstone' || r.__typename === 'TweetUnavailable') {
    return { id: r.rest_id || '', unavailable: true, reason: r.tombstone?.text?.text || r.reason || r.__typename };
  }
  const legacy = r.legacy;
  if (!legacy) return null;

  // Bookmarking a repost bookmarks the original.
  const rt = legacy.retweeted_status_result?.result;
  if (rt && depth === 0) return normalizeTweet(rt, depth);

  const author = normalizeUser(r.core?.user_results?.result) || { id: legacy.user_id_str || '', name: '', handle: '', avatar: '' };
  const id = r.rest_id || legacy.id_str;

  const note = r.note_tweet?.note_tweet_results?.result;
  const ents = legacy.entities || {};
  const extMedia = legacy.extended_entities?.media || ents.media || [];
  const noteEnts = note?.entity_set || {};

  let text;
  if (note?.text) text = note.text;
  else {
    text = legacy.full_text || legacy.text || '';
    const range = legacy.display_text_range;
    if (Array.isArray(range) && range.length === 2) text = Array.from(text).slice(range[0], range[1]).join('');
  }

  const urls = [];
  const urlMap = {};
  for (const u of [...(noteEnts.urls || []), ...(ents.urls || [])]) {
    if (!u?.url || urlMap[u.url]) continue;
    const expanded = u.expanded_url || u.url;
    urlMap[u.url] = expanded;
    urls.push({ url: expanded, display: u.display_url || expanded });
  }
  for (const [short, long] of Object.entries(urlMap)) text = text.split(short).join(long);
  for (const m of extMedia) if (m.url) text = text.split(m.url).join('');
  text = decodeEntities(text).replace(/[ \t]+\n/g, '\n').trim();

  const hashtags = [...new Set([...(noteEnts.hashtags || []), ...(ents.hashtags || [])].map((h) => h.text).filter(Boolean))];
  const symbols = [...new Set([...(noteEnts.symbols || []), ...(ents.symbols || [])].map((h) => h.text).filter(Boolean))];
  const mentions = [];
  const seenM = new Set();
  for (const m of [...(noteEnts.user_mentions || []), ...(ents.user_mentions || [])]) {
    if (!m?.screen_name || seenM.has(m.screen_name.toLowerCase())) continue;
    seenM.add(m.screen_name.toLowerCase());
    mentions.push({ handle: m.screen_name, name: m.name || '', id: m.id_str || '' });
  }

  const { card, poll } = normalizeCard(r.card, urlMap);

  let quoted = null;
  if (depth < 1 && r.quoted_status_result?.result) quoted = normalizeTweet(r.quoted_status_result.result, depth + 1);
  const quotedId = legacy.quoted_status_id_str || quoted?.id || null;

  const replyToId = legacy.in_reply_to_status_id_str || null;
  const noteObj = r.birdwatch_pivot;
  const communityNote = noteObj ? [noteObj.title, noteObj.subtitle?.text || noteObj.shorttitle].filter(Boolean).join(' — ') : '';

  return {
    id,
    url: tweetUrl(author.handle, id),
    conversationId: legacy.conversation_id_str || id,
    createdAt: toIso(legacy.created_at) || snowflakeDate(id)?.toISOString() || null,
    lang: legacy.lang || '',
    source: stripTags(r.source || ''),
    text,
    isLong: !!note?.text,
    author,
    stats: {
      likes: toNumber(legacy.favorite_count),
      reposts: toNumber(legacy.retweet_count),
      replies: toNumber(legacy.reply_count),
      quotes: toNumber(legacy.quote_count),
      bookmarks: toNumber(legacy.bookmark_count),
      views: toNumber(r.views?.count),
    },
    media: extMedia.map(normalizeMedia),
    urls,
    hashtags,
    symbols,
    mentions,
    replyTo: replyToId ? { id: replyToId, handle: legacy.in_reply_to_screen_name || '', userId: legacy.in_reply_to_user_id_str || '' } : null,
    quotedId,
    quotedUrl: legacy.quoted_status_permalink?.expanded || (quoted ? quoted.url : null),
    quoted: quoted && !quoted.unavailable ? quoted : null,
    card,
    poll,
    article: normalizeArticle(r.article),
    communityNote,
    possiblySensitive: !!legacy.possibly_sensitive,
  };
}

// ---------- classification ----------

const THREAD_HINT = /(🧵|\bthread\b|\(1\/\d+\)|^1\/\d*\s|\b1\/\d+\b|\b1\/n\b|👇|⬇️|a thread)/i;

/** True if the post is probably part of a self-thread (worth fetching TweetDetail). */
export function looksLikeThread(t) {
  if (!t) return false;
  if (t.replyTo && t.replyTo.userId && t.replyTo.userId === t.author.id) return true;
  return THREAD_HINT.test(t.text || '');
}

export function postTypes(t, threadLen = 0) {
  const types = new Set();
  for (const m of t.media || []) types.add(m.type === 'photo' ? 'Photo' : m.type === 'gif' ? 'GIF' : 'Video');
  if (t.card || t.urls?.some((u) => !/^https?:\/\/(x|twitter)\.com\//.test(u.url))) types.add('Link');
  if (t.quoted || t.quotedId) types.add('Quote');
  if (t.replyTo && t.replyTo.userId !== t.author.id) types.add('Reply');
  if (threadLen > 1) types.add('Thread');
  if (t.article) types.add('Article');
  if (t.poll) types.add('Poll');
  if (t.isLong) types.add('Long post');
  if (!types.size) types.add('Text');
  return [...types];
}

// ---------- threads ----------

/**
 * Build the author's self-thread around `focalId` from every post seen in
 * TweetDetail pages. Returns { chain, parent } where chain is ordered
 * oldest -> newest and parent is the post being replied to when it was
 * written by someone else (useful context).
 */
export function assembleThread(pool, focalId) {
  const focal = pool.get(focalId);
  if (!focal) return { chain: [], parent: null };
  const authorId = focal.author.id;
  const chain = [focal];
  let cur = focal;
  const seen = new Set([focal.id]);
  while (cur.replyTo && pool.has(cur.replyTo.id)) {
    const p = pool.get(cur.replyTo.id);
    if (p.author.id !== authorId || seen.has(p.id)) break;
    chain.unshift(p);
    seen.add(p.id);
    cur = p;
  }
  const childrenOf = new Map();
  for (const t of pool.values()) {
    if (!t.replyTo || t.author.id !== authorId) continue;
    if (!childrenOf.has(t.replyTo.id)) childrenOf.set(t.replyTo.id, []);
    childrenOf.get(t.replyTo.id).push(t);
  }
  cur = focal;
  for (;;) {
    const kids = (childrenOf.get(cur.id) || []).filter((k) => !seen.has(k.id));
    if (!kids.length) break;
    kids.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    cur = kids[0];
    chain.push(cur);
    seen.add(cur.id);
  }
  const root = chain[0];
  const parent = root.replyTo && pool.has(root.replyTo.id) ? pool.get(root.replyTo.id) : null;
  return { chain, parent: parent && parent.author.id !== authorId ? parent : null };
}

/** Bookmark time encoded in the timeline sortIndex (when it is a snowflake newer than the post). */
export function bookmarkedAtFromSortIndex(sortIndex, tweet) {
  if (!sortIndex || sortIndex === tweet?.id) return null;
  const d = snowflakeDate(sortIndex);
  if (!d) return null;
  const created = tweet?.createdAt ? Date.parse(tweet.createdAt) : 0;
  const now = Date.now() + 86400000;
  return d.getTime() >= created - 60000 && d.getTime() <= now ? d.toISOString() : null;
}
