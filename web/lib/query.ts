// Raindrop-style search syntax -> structured query.
//   words, "exact phrase", -exclude, #tag, #"multi word", -#tag, type:video, -type:post,
//   site:youtube.com, link:/blog, title:foo, note:foo, excerpt:foo, collection:"Dev/AI",
//   created:>2025-01, created:<2025-06-01, is:fav, is:unread, is:read, notag:true,
//   note:true, highlights:true, broken:true, reminder:true, lang:es, source:x, match:OR

export type Query = {
  terms: string[];
  exclude: string[];
  tags: string[];
  notTags: string[];
  types: string[];
  notTypes: string[];
  sites: string[];
  fields: { field: 'title' | 'note' | 'excerpt' | 'link'; value: string }[];
  collection?: string | null; // null => unsorted
  createdAfter?: string;
  createdBefore?: string;
  favorite?: boolean;
  read?: boolean;
  noTags?: boolean;
  hasNote?: boolean;
  hasHighlights?: boolean;
  broken?: boolean;
  reminder?: boolean;
  lang?: string;
  source?: 'all' | 'library' | 'x';
  matchAny?: boolean;
  platform?: string;
};

const tokenRe = /(-?)(#?)(?:(\w+):)?(?:"([^"]+)"|(\S+))/g;

const TYPE_ALIASES: Record<string, string> = {
  article: 'Article', articles: 'Article', video: 'Video', videos: 'Video', post: 'Post', posts: 'Post',
  x: 'X bookmark', tweet: 'X bookmark', tweets: 'X bookmark', twitter: 'X bookmark', 'x bookmark': 'X bookmark', 'x bookmarks': 'X bookmark', 'x-bookmark': 'X bookmark',
  link: 'Link', links: 'Link', image: 'Image', images: 'Image', photo: 'Image', document: 'Document', doc: 'Document',
  pdf: 'Document', audio: 'Audio', podcast: 'Audio', repo: 'Repo', note: 'Note', notes: 'Note', product: 'Product', paper: 'Paper',
};

export function normalizeType(t: string) {
  return TYPE_ALIASES[t.toLowerCase()] || t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function dateBound(v: string) {
  const m = /^([<>]=?)?(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(v);
  if (!m) return null;
  const [, op = '', y, mo = '01', d = '01'] = m;
  const start = `${y}-${mo}-${d}`;
  let end: string;
  if (m[4]) end = start;
  else if (m[3]) end = new Date(Date.UTC(Number(y), Number(mo), 0)).toISOString().slice(0, 10);
  else end = `${y}-12-31`;
  return { op, start, end };
}

export function parseQuery(q: string, base: Partial<Query> = {}): Query {
  const out: Query = { terms: [], exclude: [], tags: [], notTags: [], types: [], notTypes: [], sites: [], fields: [], ...base };
  for (const m of (q || '').matchAll(tokenRe)) {
    const [, neg, hash, key, quoted, bare] = m;
    const value = (quoted ?? bare ?? '').trim();
    if (!value && !hash) continue;
    if (hash) {
      const tag = key ? `${key}:${value}` : value;
      (neg ? out.notTags : out.tags).push(tag);
      continue;
    }
    const k = key?.toLowerCase();
    const bool = /^(true|yes|1)$/i.test(value);
    switch (k) {
      case 'type':
        (neg ? out.notTypes : out.types).push(normalizeType(value));
        break;
      case 'site':
      case 'domain':
        out.sites.push(value.toLowerCase());
        break;
      case 'link':
      case 'url':
        out.fields.push({ field: 'link', value });
        break;
      case 'title':
      case 'note':
      case 'excerpt':
        if (k === 'note' && /^(true|false)$/i.test(value)) out.hasNote = bool;
        else out.fields.push({ field: k, value });
        break;
      case 'collection':
      case 'in':
        out.collection = /^(unsorted|none)$/i.test(value) ? null : value;
        break;
      case 'created': {
        const b = dateBound(value);
        if (b?.op.startsWith('>')) out.createdAfter = b.op === '>=' ? b.start : nextDay(b.end);
        else if (b?.op.startsWith('<')) out.createdBefore = b.op === '<=' ? nextDay(b.end) : b.start;
        else if (b) {
          out.createdAfter = b.start;
          out.createdBefore = nextDay(b.end);
        }
        break;
      }
      case 'is':
        if (/^(fav|favs|favorite|favourite|starred|important)$/i.test(value)) out.favorite = !neg;
        else if (/^unread$/i.test(value)) out.read = !!neg;
        else if (/^read$/i.test(value)) out.read = !neg;
        else if (/^broken$/i.test(value)) out.broken = !neg;
        break;
      case 'notag':
        out.noTags = bool;
        break;
      case 'highlights':
        out.hasHighlights = bool;
        break;
      case 'broken':
        out.broken = bool;
        break;
      case 'reminder':
        out.reminder = bool;
        break;
      case 'lang':
        out.lang = value.toLowerCase();
        break;
      case 'source':
        out.source = /^(x|twitter|tweets?)$/i.test(value) ? 'x' : /^(library|web)$/i.test(value) ? 'library' : 'all';
        break;
      case 'match':
        out.matchAny = /^or$/i.test(value);
        break;
      default: {
        const word = key ? `${key}:${value}` : value;
        if (word === '❤️' || word === '♥') out.favorite = true;
        else (neg ? out.exclude : out.terms).push(word);
      }
    }
  }
  return out;
}

function nextDay(d: string) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** Serialize a structured filter back to the query language (used for sidebar links). */
export function quote(v: string) {
  return /[\s"]/.test(v) ? `"${v.replace(/"/g, '')}"` : v;
}
