// FxTwitter API tweet -> Trove normalized post (same shape as extension/lib/parse.js),
// so X posts saved from the web or agents render exactly like synced bookmarks.

const iso = (v: unknown) => {
  if (!v) return null;
  const d = new Date(typeof v === 'number' ? v * 1000 : String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

function photoUrl(u: string) {
  const m = /^(https:\/\/pbs\.twimg\.com\/media\/[^.?]+)\.(\w+)/.exec(u || '');
  return m ? `${m[1]}?format=${m[2]}&name=orig` : u;
}

export function fxToPost(fx: any, depth = 0): any {
  const a = fx.author || {};
  const text: string = fx.raw_text?.text || fx.text || '';
  const handle = a.screen_name || '';
  const urls = [...new Set((text.match(/https?:\/\/[^\s]+/g) || []).filter((u) => !/^https?:\/\/(x|twitter)\.com\/\w+\/status/.test(u)))].map((u) => ({ url: u, display: u.replace(/^https?:\/\//, '') }));
  const media = [
    ...(fx.media?.photos || []).map((p: any) => ({ id: p.url, type: 'photo', url: photoUrl(p.url), preview: p.url, width: p.width, height: p.height, alt: p.altText || '' })),
    ...(fx.media?.videos || []).map((v: any) => ({
      id: v.url,
      type: v.type === 'gif' ? 'gif' : 'video',
      url: v.url,
      preview: v.thumbnail_url,
      width: v.width,
      height: v.height,
      alt: '',
      durationMs: v.duration ? Math.round(v.duration * 1000) : null,
      variants: [{ url: v.url, bitrate: 0 }],
    })),
  ];
  const poll = fx.poll
    ? { options: (fx.poll.choices || []).map((c: any) => ({ label: c.label, votes: c.count ?? 0 })), endsAt: iso(fx.poll.ends_at), final: /final|ended/i.test(fx.poll.time_left_en || '') }
    : null;
  const article = fx.article
    ? {
        id: fx.article.id || '',
        title: fx.article.title || '',
        preview: fx.article.preview_text || '',
        text: (fx.article.content?.blocks || []).map((b: any) => b.text).filter(Boolean).join('\n\n'),
        cover: fx.article.cover_media?.media_info?.original_img_url || '',
        url: fx.article.id ? `https://x.com/i/article/${fx.article.id}` : '',
      }
    : null;
  return {
    id: String(fx.id),
    url: `https://x.com/${handle || 'i/web'}/status/${fx.id}`,
    conversationId: String(fx.id),
    createdAt: iso(fx.created_timestamp) || iso(fx.created_at),
    lang: fx.lang || '',
    source: fx.source || '',
    text,
    isLong: !!fx.is_note_tweet || text.length > 280,
    author: {
      id: String(a.id || ''),
      name: a.name || handle,
      handle,
      avatar: (a.avatar_url || '').replace(/_normal(\.\w+)$/, '_400x400$1'),
      verified: !!a.verification?.verified,
      blueVerified: a.verification?.type === 'individual' || !!a.verification?.verified,
      followers: a.followers ?? null,
      following: a.following ?? null,
      description: a.description || '',
      location: a.location || '',
    },
    stats: { likes: fx.likes ?? null, reposts: fx.retweets ?? null, replies: fx.replies ?? null, quotes: fx.quotes ?? null, bookmarks: fx.bookmarks ?? null, views: fx.views ?? null },
    media,
    urls,
    hashtags: [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1)))],
    symbols: [...new Set((text.match(/\$[A-Za-z]{1,6}\b/g) || []).map((h) => h.slice(1)))],
    mentions: [...new Set((text.match(/(?<![\w@])@\w{1,15}/g) || []).map((m) => m.slice(1)))].map((h) => ({ handle: h, name: '', id: '' })),
    replyTo: fx.replying_to_status ? { id: String(fx.replying_to_status), handle: fx.replying_to || '', userId: '' } : null,
    quotedId: fx.quote ? String(fx.quote.id) : null,
    quotedUrl: fx.quote ? `https://x.com/${fx.quote.author?.screen_name || 'i/web'}/status/${fx.quote.id}` : null,
    quoted: fx.quote && depth < 1 ? fxToPost(fx.quote, depth + 1) : null,
    card: null,
    poll,
    article,
    communityNote: fx.community_note?.text || '',
    possiblySensitive: !!fx.possibly_sensitive,
  };
}
