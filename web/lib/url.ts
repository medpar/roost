// URL normalization (for duplicate detection) and platform/type detection.

const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|ref_src|ref_url|_hsenc|_hsmi|mkt_tok|yclid|spm|si|s|t|share_id|feature|rcm|trk|trkCampaign|campaign_id|ved|usp)$/i;
const KEEP_FOR = { 'youtube.com': ['v', 'list', 't'], 'youtu.be': ['t'] } as Record<string, string[]>;

export function isUrl(s: string) {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Pull every http(s) URL out of free text (shared notes, messages). */
export function findUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of (text || '').matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    let u = m[0];
    while (/[.,!?;:)\]}>]$/.test(u) && !(u.endsWith(')') && u.includes('('))) u = u.slice(0, -1);
    if (isUrl(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^(www\d?|m|mobile|amp)\./, '');
  } catch {
    return '';
  }
}

/** Canonical form used as the duplicate key: lowercase host, no www, no tracking params, no fragment. */
export function urlKey(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^(www\d?|m|mobile)\./, '');
    let path = u.pathname.replace(/\/+$/, '') || '';
    if (host === 'twitter.com' || host === 'x.com') {
      const id = /\/status(?:es)?\/(\d+)/.exec(path)?.[1];
      if (id) return `x.com/status/${id}`;
    }
    if (host === 'youtu.be') return `youtube.com/watch?v=${path.slice(1)}`;
    if (/(^|\.)pinterest\.[a-z.]+$/.test(host)) {
      const pin = /\/pin\/(\d+)/.exec(path)?.[1];
      if (pin) return `pinterest.com/pin/${pin}`;
    }
    if (host === 'arxiv.org') {
      const id = /\/(?:abs|pdf|html)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?$/.exec(path)?.[1];
      if (id) return `arxiv.org/abs/${id}`;
    }
    if (host === 'youtube.com' && path.startsWith('/shorts/')) return `youtube.com/watch?v=${path.split('/')[2]}`;
    const keep = KEEP_FOR[host];
    const params = [...u.searchParams.entries()]
      .filter(([k]) => (keep ? keep.includes(k) && k !== 't' : !TRACKING.test(k)))
      .sort(([a], [b]) => a.localeCompare(b));
    const q = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
    path = path.replace(/\/index\.html?$/i, '');
    return `${host}${path}${q}`;
  } catch {
    return raw.trim();
  }
}

/** Clean URL to store (tracking removed, original scheme/host kept). */
export function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    for (const k of [...u.searchParams.keys()]) {
      const keep = KEEP_FOR[u.hostname.replace(/^www\./, '')];
      if (keep ? !keep.includes(k) : TRACKING.test(k)) u.searchParams.delete(k);
    }
    u.hash = /^#:~:text=/.test(u.hash) ? '' : u.hash;
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export type Platform =
  | 'Web' | 'YouTube' | 'X' | 'Reddit' | 'Bluesky' | 'Mastodon' | 'LinkedIn' | 'Instagram' | 'TikTok' | 'Threads'
  | 'Facebook' | 'GitHub' | 'Hacker News' | 'Medium' | 'Substack' | 'Spotify' | 'Vimeo' | 'Twitch' | 'Pinterest'
  | 'Dribbble' | 'Behance' | 'Product Hunt' | 'Wikipedia' | 'arXiv' | 'SoundCloud' | 'Apple Podcasts' | 'Figma' | 'Notion';

const HOSTS: [RegExp, Platform][] = [
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'YouTube'],
  [/(^|\.)(x|twitter)\.com$/, 'X'],
  [/(^|\.)reddit\.com$|^redd\.it$/, 'Reddit'],
  [/^bsky\.app$/, 'Bluesky'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)threads\.(net|com)$/, 'Threads'],
  [/(^|\.)facebook\.com$|^fb\.watch$/, 'Facebook'],
  [/^github\.com$|\.github\.io$/, 'GitHub'],
  [/^news\.ycombinator\.com$/, 'Hacker News'],
  [/(^|\.)medium\.com$/, 'Medium'],
  [/\.substack\.com$/, 'Substack'],
  [/^open\.spotify\.com$/, 'Spotify'],
  [/(^|\.)vimeo\.com$/, 'Vimeo'],
  [/(^|\.)twitch\.tv$/, 'Twitch'],
  [/(^|\.)pinterest\.\w+$|^pin\.it$/, 'Pinterest'],
  [/^dribbble\.com$/, 'Dribbble'],
  [/^behance\.net$/, 'Behance'],
  [/^producthunt\.com$/, 'Product Hunt'],
  [/(^|\.)wikipedia\.org$/, 'Wikipedia'],
  [/^arxiv\.org$/, 'arXiv'],
  [/^soundcloud\.com$/, 'SoundCloud'],
  [/^podcasts\.apple\.com$/, 'Apple Podcasts'],
  [/(^|\.)figma\.com$/, 'Figma'],
  [/\.notion\.site$|^notion\.so$/, 'Notion'],
];

const MASTODON_PATH = /^\/@[\w.]+\/\d{6,}$/;

export function platformOf(url: string): Platform {
  const host = domainOf(url);
  for (const [re, p] of HOSTS) if (re.test(host)) return p;
  try {
    if (MASTODON_PATH.test(new URL(url).pathname)) return 'Mastodon';
  } catch { /* ignore */ }
  return 'Web';
}

export type ItemType = 'Article' | 'Video' | 'Post' | 'Link' | 'Image' | 'Document' | 'Audio' | 'Repo' | 'Note' | 'Product' | 'Paper';

export function guessType(url: string, platform: Platform, contentType = ''): ItemType {
  if (contentType.startsWith('image/')) return 'Image';
  if (contentType.includes('pdf') || /\.pdf($|\?)/i.test(url)) return platform === 'arXiv' ? 'Paper' : 'Document';
  if (contentType.startsWith('audio/')) return 'Audio';
  if (contentType.startsWith('video/')) return 'Video';
  if (/\.(png|jpe?g|gif|webp|avif|svg)($|\?)/i.test(url)) return 'Image';
  if (/\.(mp3|m4a|wav|ogg)($|\?)/i.test(url)) return 'Audio';
  if (/\.(mp4|mov|webm)($|\?)/i.test(url)) return 'Video';
  switch (platform) {
    case 'YouTube':
    case 'Vimeo':
    case 'Twitch':
    case 'TikTok':
      return 'Video';
    case 'X':
    case 'Reddit':
    case 'Bluesky':
    case 'Mastodon':
    case 'Threads':
    case 'Instagram':
    case 'LinkedIn':
    case 'Facebook':
    case 'Hacker News':
      return 'Post';
    case 'GitHub':
      return /^\/[^/]+\/[^/]+\/?$/.test(safePath(url)) ? 'Repo' : 'Link';
    case 'Spotify':
    case 'SoundCloud':
    case 'Apple Podcasts':
      return 'Audio';
    case 'arXiv':
      return 'Paper';
    case 'Product Hunt':
      return 'Product';
    case 'Medium':
    case 'Substack':
    case 'Wikipedia':
      return 'Article';
    default:
      return 'Link';
  }
}

function safePath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export const youtubeId = (url: string) =>
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url)?.[1] || null;

export const tweetId = (url: string) => /(?:x|twitter)\.com\/(?:[^/]+|i\/web)\/status(?:es)?\/(\d+)/.exec(url)?.[1] || null;
