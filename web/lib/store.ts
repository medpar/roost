// Trove data layer. Two Notion data sources behind one item model:
//   library: everything you save (links, articles, videos, posts, notes, files)
//   x:       X/Twitter posts (synced bookmarks + posts saved from anywhere)
import 'server-only';
import { createHash } from 'node:crypto';
import { Notion, NotionError } from '../../extension/lib/notion.js';
import { P as XP, ensureSchema as ensureXSchema } from '../../extension/lib/schema.js';
import { buildBlocks, buildProperties, titleFor } from '../../extension/lib/render.js';
import { chunk } from '../../extension/lib/util.js';
import { env } from './env';
import { extract, fxTweet, mergeClientMeta, plain, youtubeSections, type Extracted, type YouTubeData } from './extract';
import { fxToPost } from './fx';
import { parseQuery, type Query } from './query';
import { cleanUrl, domainOf, findUrls, isUrl, platformOf, tweetId, urlKey } from './url';

// ---------- schema ----------

export { L, TYPES, librarySchema } from './library-schema.js';
import { L, librarySchema } from './library-schema.js';

// ---------- client ----------

let notionClient: Notion | null = null;
export const notion = () => (notionClient ||= new Notion(env().notionToken, { rps: 2.6 }));

const schemaReady: Record<string, Promise<Record<string, any>>> = {};
const ensured = new Set<string>();

/** Make sure every property exists (once per instance); returns the data source schema (cached). */
export function schemaOf(db: 'library' | 'x', force = false): Promise<Record<string, any>> {
  if (!schemaReady[db] || force) {
    schemaReady[db] = (async () => {
      const id = db === 'library' ? env().libraryDs : env().xDs;
      if (!ensured.has(db)) {
        if (db === 'x') await ensureXSchema(notion(), id);
        else await ensureLibrary(id);
        ensured.add(db);
      }
      const ds = await notion().getDataSource(id);
      return ds.properties as Record<string, any>;
    })().catch((e) => {
      delete schemaReady[db];
      throw e;
    });
  }
  return schemaReady[db];
}

async function ensureLibrary(id: string) {
  const ds = await notion().getDataSource(id);
  const missing: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(librarySchema())) if (!ds.properties[k] && k !== L.title) missing[k] = v;
  if (Object.keys(missing).length) await notion().updateDataSource(id, { properties: missing });
}

// ---------- items ----------

export type Item = {
  id: string;
  db: 'library' | 'x';
  url: string;
  title: string;
  excerpt: string;
  domain: string;
  type: string;
  platform: string;
  collection: string | null;
  tags: string[];
  cover: string | null;
  icon: string | null;
  author: string;
  published: string | null;
  created: string;
  updated: string;
  favorite: boolean;
  read: boolean;
  note: string;
  status: string | null;
  highlights: number;
  readingTime: number | null;
  duration: number | null;
  remind: string | null;
  source: string | null;
  via: string;
  notionUrl: string;
  stats?: Record<string, number | null>;
};

const txt = (p: any) => (p?.rich_text || p?.title || []).map((t: any) => t.plain_text).join('');
const sel = (p: any) => p?.select?.name || null;
const multi = (p: any) => (p?.multi_select || []).map((x: any) => x.name);
const fileUrl = (f: any) => f?.file?.url || f?.external?.url || null;

function coverOf(page: any) {
  const c = page.cover;
  return c ? c.file?.url || c.external?.url || null : null;
}

export function toItem(page: any): Item {
  const pr = page.properties || {};
  const isX = page.parent?.data_source_id?.replace(/-/g, '') === env().xDs.replace(/-/g, '');
  if (isX) {
    const files = pr[XP.media]?.files || [];
    const types: string[] = multi(pr[XP.type]);
    const type = types.includes('Video') || types.includes('GIF') ? 'Video' : types.includes('Article') ? 'Article' : 'Post';
    return {
      id: page.id,
      db: 'x',
      url: pr[XP.url]?.url || '',
      title: txt(pr[XP.title]),
      excerpt: txt(pr[XP.text]).slice(0, 400),
      domain: 'x.com',
      type,
      platform: 'X',
      collection: sel(pr[XP.collection]),
      tags: multi(pr[XP.tags]),
      cover: files.map(fileUrl).find((u: string) => u && !/\.mp4/.test(u)) || null,
      icon: page.icon?.external?.url || null,
      author: [txt(pr[XP.author]), txt(pr[XP.handle])].filter(Boolean).join(' '),
      published: pr[XP.posted]?.date?.start || null,
      created: page.created_time,
      updated: page.last_edited_time,
      favorite: !!pr[XP.favorite]?.checkbox,
      read: !!pr[XP.read]?.checkbox,
      note: txt(pr[XP.note]),
      status: null,
      highlights: 0,
      readingTime: null,
      duration: null,
      remind: null,
      source: sel(pr[XP.source]),
      via: '',
      notionUrl: page.url,
      stats: { likes: pr[XP.likes]?.number ?? null, reposts: pr[XP.reposts]?.number ?? null, views: pr[XP.views]?.number ?? null, thread: pr[XP.threadLen]?.number ?? null },
    };
  }
  return {
    id: page.id,
    db: 'library',
    url: pr[L.url]?.url || '',
    title: txt(pr[L.title]),
    excerpt: txt(pr[L.description]).slice(0, 400),
    domain: txt(pr[L.domain]),
    type: sel(pr[L.type]) || 'Link',
    platform: sel(pr[L.platform]) || 'Web',
    collection: sel(pr[L.collection]),
    tags: multi(pr[L.tags]),
    cover: coverOf(page) || pr[L.cover]?.url || null,
    icon: page.icon?.external?.url || page.icon?.file?.url || null,
    author: txt(pr[L.author]),
    published: pr[L.published]?.date?.start || null,
    created: page.created_time,
    updated: page.last_edited_time,
    favorite: !!pr[L.favorite]?.checkbox,
    read: !!pr[L.read]?.checkbox,
    note: txt(pr[L.note]),
    status: sel(pr[L.status]),
    highlights: pr[L.highlights]?.number || 0,
    readingTime: pr[L.readingTime]?.number ?? null,
    duration: pr[L.duration]?.number ?? null,
    remind: pr[L.remind]?.date?.start || null,
    source: sel(pr[L.source]),
    via: txt(pr[L.via]),
    notionUrl: page.url,
  };
}

// ---------- filters ----------

type F = Record<string, unknown>;

function textOr(db: 'library' | 'x', word: string): F {
  const props = db === 'library' ? [L.title, L.text, L.description, L.note, L.author, L.domain] : [XP.title, XP.text, XP.note, XP.author, XP.handle];
  const ors: F[] = props.map((p) => ({ property: p, rich_text: { contains: word } }));
  ors.push({ property: db === 'library' ? L.url : XP.url, url: { contains: word } });
  return { or: ors };
}

/** Build a Notion filter for one data source. Returns null when the query can't match that source. */
function buildFilter(db: 'library' | 'x', q: Query, props: Record<string, any> = {}): F | null | undefined {
  const and: F[] = [];
  const T = db === 'library' ? L : XP;
  // Notion rejects select filters on options that don't exist yet; such a source simply can't match.
  const has = (prop: string, name: string) => {
    const p = props[prop];
    const opts = p?.select?.options || p?.multi_select?.options;
    return !opts || opts.some((o: any) => o.name === name);
  };
  if (q.tags.some((t) => !has(T.tags, t))) return null;
  if (q.collection && !has(T.collection, q.collection)) return null;
  if (db === 'library' && q.types.some((t) => !has(L.type, t))) return null;
  if (db === 'library' && q.platform && !has(L.platform, q.platform)) return null;
  if (q.lang && !has(db === 'library' ? L.lang : XP.lang, q.lang)) return null;
  if (q.source && q.source !== 'all' && q.source !== db) return null;
  if (q.platform && (db === 'x' ? q.platform !== 'X' : q.platform === 'X')) return null;
  if (q.platform && db === 'library') and.push({ property: L.platform, select: { equals: q.platform } });
  for (const t of q.types) {
    if (db === 'library') and.push({ property: L.type, select: { equals: t } });
    else if (t === 'Post') continue;
    else if (['Video', 'Article', 'Link', 'Poll'].includes(t)) and.push({ property: XP.type, multi_select: { contains: t } });
    else if (t === 'Image') and.push({ property: XP.type, multi_select: { contains: 'Photo' } });
    else return null;
  }
  for (const t of q.notTypes) {
    if (db === 'library' && has(L.type, t)) and.push({ property: L.type, select: { does_not_equal: t } });
    else if (t === 'Post') return null;
  }
  for (const s of q.sites) {
    if (db === 'library') and.push({ property: L.domain, rich_text: { contains: s.replace(/^www\./, '') } });
    else if (!/^(x|twitter)\.com$/.test(s)) return null;
  }
  for (const f of q.fields) {
    if (f.field === 'link') and.push({ property: T.url, url: { contains: f.value } });
    else if (f.field === 'title') and.push({ property: T.title, title: { contains: f.value } });
    else if (f.field === 'note') and.push({ property: T.note, rich_text: { contains: f.value } });
    else if (f.field === 'excerpt') and.push({ property: db === 'library' ? L.description : XP.text, rich_text: { contains: f.value } });
  }
  const words = q.terms.map((w) => textOr(db, w));
  if (words.length) {
    if (q.matchAny) and.push({ or: words.flatMap((w) => (w.or as F[])).slice(0, 100) });
    else and.push(...words);
  }
  for (const w of q.exclude) {
    and.push({ property: T.title, title: { does_not_contain: w } });
    and.push({ property: db === 'library' ? L.text : XP.text, rich_text: { does_not_contain: w } });
  }
  for (const t of q.tags) and.push({ property: T.tags, multi_select: { contains: t } });
  for (const t of q.notTags) if (has(T.tags, t)) and.push({ property: T.tags, multi_select: { does_not_contain: t } });
  if (q.noTags) and.push({ property: T.tags, multi_select: { is_empty: true } });
  if (q.collection === null) and.push({ property: T.collection, select: { is_empty: true } });
  else if (q.collection) and.push({ property: T.collection, select: { equals: q.collection } });
  if (q.favorite !== undefined) and.push({ property: T.favorite, checkbox: { equals: q.favorite } });
  if (q.read !== undefined) and.push({ property: T.read, checkbox: { equals: q.read } });
  if (q.hasNote !== undefined) and.push({ property: T.note, rich_text: q.hasNote ? { is_not_empty: true } : { is_empty: true } });
  if (q.hasHighlights) {
    if (db === 'x') return null;
    and.push({ property: L.highlights, number: { greater_than: 0 } });
  }
  if (q.broken !== undefined) {
    if (db === 'x') return q.broken ? null : undefined;
    and.push(q.broken ? { property: L.status, select: { equals: 'Broken' } } : { property: L.status, select: { does_not_equal: 'Broken' } });
  }
  if (q.reminder) {
    if (db === 'x') return null;
    and.push({ property: L.remind, date: { is_not_empty: true } });
  }
  if (q.lang) and.push({ property: db === 'library' ? L.lang : XP.lang, select: { equals: q.lang } });
  if (q.createdAfter) and.push({ timestamp: 'created_time', created_time: { on_or_after: q.createdAfter } });
  if (q.createdBefore) and.push({ timestamp: 'created_time', created_time: { before: q.createdBefore } });
  if (!and.length) return undefined;
  return and.length === 1 ? and[0] : { and: and.slice(0, 100) };
}

export type Sort = 'newest' | 'oldest' | 'title' | 'title_desc' | 'site' | 'published';

function sortsFor(db: 'library' | 'x', sort: Sort) {
  const T = db === 'library' ? L : XP;
  switch (sort) {
    case 'oldest':
      return [{ timestamp: 'created_time', direction: 'ascending' }];
    case 'title':
      return [{ property: T.title, direction: 'ascending' }];
    case 'title_desc':
      return [{ property: T.title, direction: 'descending' }];
    case 'site':
      return db === 'library' ? [{ property: L.domain, direction: 'ascending' }, { timestamp: 'created_time', direction: 'descending' }] : [{ timestamp: 'created_time', direction: 'descending' }];
    case 'published':
      return [{ property: db === 'library' ? L.published : XP.posted, direction: 'descending' }, { timestamp: 'created_time', direction: 'descending' }];
    default:
      return [{ timestamp: 'created_time', direction: 'descending' }];
  }
}

type Cursor = { l?: string | null; x?: string | null; t?: string; ids?: string[] };
const enc = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
const dec = (s?: string | null): Cursor => {
  try {
    return s ? JSON.parse(Buffer.from(s, 'base64url').toString()) : {};
  } catch {
    return {};
  }
};

export type ListOptions = { q?: string; query?: Partial<Query>; sort?: Sort; cursor?: string | null; limit?: number; source?: 'all' | 'library' | 'x' };

/** List items. Merges both sources (newest/oldest) with a stable time cursor. */
export async function list(opts: ListOptions = {}): Promise<{ items: Item[]; cursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit || 40, 1), 100);
  const sort = opts.sort || 'newest';
  const q = parseQuery(opts.q || '', { ...(opts.query || {}), source: opts.query?.source || opts.source || 'all' });
  const [lp, xp] = await Promise.all([schemaOf('library'), schemaOf('x')]);
  const schema = { library: lp, x: xp };
  const sources = (['library', 'x'] as const).filter((db) => buildFilter(db, q, schema[db]) !== null);
  if (!sources.length) return { items: [], cursor: null };
  const c = dec(opts.cursor);

  // Single source (or sorts that can't be merged): use Notion's own cursor.
  const mergeable = sort === 'newest' || sort === 'oldest';
  if (sources.length === 1 || !mergeable) {
    const db = sources.length === 1 ? sources[0] : 'library';
    const key = db === 'library' ? 'l' : 'x';
    if (c[key] === null) return { items: [], cursor: null };
    const res = await notion().query(dsOf(db), clean({ filter: buildFilter(db, q, schema[db]), sorts: sortsFor(db, sort), page_size: limit, start_cursor: c[key] || undefined }));
    return { items: res.results.map(toItem), cursor: res.has_more ? enc({ [key]: res.next_cursor }) : null };
  }

  // Merged: query both up to the boundary minute, skip ids already returned at that minute.
  const desc = sort === 'newest';
  const skip = new Set(c.ids || []);
  const results = await Promise.all(
    sources.map(async (db) => {
      const base = buildFilter(db, q, schema[db]);
      const bound = c.t ? { timestamp: 'created_time', created_time: desc ? { on_or_before: c.t } : { on_or_after: c.t } } : null;
      const filter = bound ? (base ? { and: [...((base as any).and || [base]), bound] } : bound) : base;
      const res = await notion().query(dsOf(db), clean({ filter, sorts: sortsFor(db, sort), page_size: Math.min(100, limit + skip.size + 1) }));
      return { items: res.results.map(toItem), more: res.has_more };
    }),
  );
  const all = results
    .flatMap((r) => r.items)
    .filter((i) => !skip.has(i.id))
    .sort((a, b) => (desc ? cmp(b, a) : cmp(a, b)));
  const page = all.slice(0, limit);
  const more = all.length > limit || results.some((r) => r.more);
  if (!more || !page.length) return { items: page, cursor: null };
  const last = page[page.length - 1].created;
  const ids = [...page, ...(c.t === last ? [...skip].map((id) => ({ id, created: last })) : [])].filter((i) => i.created === last).map((i) => i.id);
  return { items: page, cursor: enc({ t: last, ids }) };
}

const cmp = (a: Item, b: Item) => (a.created === b.created ? a.id.localeCompare(b.id) : a.created.localeCompare(b.created));
const dsOf = (db: 'library' | 'x') => (db === 'library' ? env().libraryDs : env().xDs);
function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

// ---------- read ----------

export async function getItem(id: string, { content = false } = {}) {
  const page = await notion().req('GET', `/pages/${id}`);
  const item = toItem(page);
  let markdown: string | null = null;
  if (content) {
    try {
      const md = await notion().req('GET', `/pages/${id}/markdown`);
      markdown = md.markdown || '';
    } catch {
      markdown = null;
    }
  }
  return { item, markdown };
}

async function findLibraryByKey(key: string) {
  const res = await notion().query(env().libraryDs, { filter: { property: L.key, rich_text: { equals: key } }, page_size: 1 });
  return res.results[0] || null;
}

async function findTweet(id: string) {
  const res = await notion().query(env().xDs, { filter: { property: XP.id, rich_text: { equals: id } }, page_size: 1 });
  return res.results[0] || null;
}

/** Look up whether URLs are already saved (for the extension's ✓ badge and agents). */
export async function lookup(urls: string[]) {
  const out: Record<string, Item | null> = {};
  for (const u of urls.slice(0, 20)) {
    const tid = tweetId(u);
    const page = tid ? await findTweet(tid) : await findLibraryByKey(urlKey(u));
    out[u] = page ? toItem(page) : null;
  }
  return out;
}

// ---------- write ----------

export type SaveInput = {
  url?: string;
  text?: string;
  title?: string;
  note?: string;
  tags?: string[];
  collection?: string | null;
  highlight?: string;
  type?: string;
  favorite?: boolean;
  read?: boolean;
  remind?: string | null;
  meta?: Partial<{ title: string; description: string; image: string; author: string; published: string; siteName: string; html: string; text: string; lang: string }>;
  source?: string;
  via?: string;
  archive?: boolean;
};

export type SaveResult = { item: Item; created: boolean };

const rt = (s: string | undefined | null, max = 1900) => {
  const out: any[] = [];
  let cur = '';
  for (const cp of String(s || '')) {
    if (cur.length + cp.length > max) {
      out.push({ type: 'text', text: { content: cur } });
      cur = '';
      if (out.length >= 99) break;
    }
    cur += cp;
  }
  if (cur && out.length < 100) out.push({ type: 'text', text: { content: cur } });
  return out;
};
const selName = (s: string) => s.replace(/,/g, ' ').trim().slice(0, 90);
const uniq = (a: string[]) => [...new Set(a.map(selName).filter(Boolean))];

export async function save(input: SaveInput): Promise<SaveResult> {
  let url = input.url?.trim() || '';
  let note = input.note?.trim() || '';
  // Plain text that is (mostly) a link: treat it as that link, keep the rest as a note.
  if (!url && input.text) {
    const urls = findUrls(input.text);
    const rest = urls.reduce((s, u) => s.replace(u, ''), input.text).trim();
    if (urls.length === 1 && rest.length < 280) {
      url = urls[0];
      if (rest) note = [note, rest].filter(Boolean).join('\n\n');
    }
  }
  if (url && !isUrl(url)) url = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url) ? `https://${url}` : '';
  if (!url) {
    if (!input.text?.trim()) throw new Error('Nothing to save: pass a url or some text');
    return saveNote({ ...input, note });
  }
  url = cleanUrl(url);
  const tid = tweetId(url);
  if (tid) return saveTweet(tid, { ...input, note });
  await schemaOf('library');
  const key = urlKey(url);
  const existing = await findLibraryByKey(key);
  if (existing) return { item: await mergeInto(existing, { ...input, note }), created: false };

  let e: Extracted = input.archive === false ? await extractLite(url) : await withTimeout(extract(url), 25000, () => extractLite(url));
  if (input.meta) e = mergeClientMeta(e, input.meta);
  if (input.title) e.title = input.title;
  if (input.type) e.type = input.type as Extracted['type'];
  return createLibraryPage(url, key, e, { ...input, note });
}

async function extractLite(url: string): Promise<Extracted> {
  const platform = platformOf(url);
  return {
    url, title: domainOf(url), description: '', siteName: domainOf(url), author: '', published: null, image: null, type: 'Link', platform,
    lang: '', markdown: '', text: '', words: 0, duration: null, media: [], embed: null, extra: {},
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: () => Promise<T>): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => fallback().then(resolve), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      fallback().then(resolve);
    });
  });
}

async function importFile(url: string, name: string, timeoutMs = 25000): Promise<string | null> {
  try {
    const id = await notion().importUrl(url, name);
    const ok = (await notion().waitUploads([id], timeoutMs)).get(id);
    return ok ? id : null;
  } catch {
    return null;
  }
}

const extOf = (u: string, fallback: string) => /[?&]format=(\w+)/.exec(u)?.[1] || /\.(jpe?g|png|gif|webp|avif|mp4|mov|webm|pdf|mp3|m4a)(?:$|[?#])/i.exec(u)?.[1]?.toLowerCase() || fallback;

function baseProps(input: SaveInput) {
  const props: Record<string, unknown> = {};
  if (input.tags?.length) props[L.tags] = { multi_select: uniq(input.tags).map((name) => ({ name })) };
  if (input.collection) props[L.collection] = { select: { name: selName(input.collection) } };
  if (input.favorite) props[L.favorite] = { checkbox: true };
  if (input.read) props[L.read] = { checkbox: true };
  if (input.note) props[L.note] = { rich_text: rt(input.note) };
  if (input.remind) props[L.remind] = { date: { start: input.remind } };
  props[L.source] = { select: { name: input.source || (input.via ? 'Agent' : 'API') } };
  if (input.via) props[L.via] = { rich_text: rt(input.via, 200) };
  return props;
}

async function createLibraryPage(url: string, key: string, e: Extracted, input: SaveInput): Promise<SaveResult> {
  const domain = domainOf(url);
  const words = e.words || 0;
  const props: Record<string, unknown> = {
    [L.title]: { title: rt((e.title || domain).slice(0, 2000)) },
    [L.url]: { url },
    [L.key]: { rich_text: rt(key) },
    [L.domain]: { rich_text: rt(domain) },
    [L.type]: { select: { name: e.type } },
    [L.platform]: { select: { name: e.platform } },
    [L.description]: { rich_text: rt(e.description) },
    [L.text]: { rich_text: rt([e.title, e.description, e.text].filter(Boolean).join('\n').slice(0, 12000)) },
    [L.author]: { rich_text: rt(e.author) },
    [L.site]: { rich_text: rt(e.siteName) },
    [L.highlights]: { number: input.highlight ? 1 : 0 },
    [L.words]: { number: words || null },
    [L.readingTime]: { number: words > 120 ? Math.max(1, Math.round(words / 230)) : null },
    [L.duration]: { number: e.duration },
    [L.cover]: { url: e.image || null },
    [L.status]: { select: { name: [404, 410].includes(Number(e.extra.httpStatus)) ? 'Broken' : 'OK' } },
    ...baseProps(input),
  };
  if (e.published) props[L.published] = { date: { start: e.published } };
  if (e.lang) props[L.lang] = { select: { name: e.lang } };

  // Archive the cover and post media inside Notion so they outlive the original.
  const archive = input.archive !== false;
  const [coverId, ...mediaIds] = await Promise.all([
    archive && e.image ? importFile(e.image, `cover.${extOf(e.image, 'jpg')}`) : Promise.resolve(null),
    ...(archive ? e.media.slice(0, 6) : []).map((m) => importFile(m.url, `${m.type === 'file' ? 'document' : m.type}.${extOf(m.url, m.type === 'image' ? 'jpg' : m.type === 'file' ? 'pdf' : 'mp4')}`, m.type === 'image' ? 25000 : 120000)),
  ]);
  let markdown = e.markdown;
  const archivedMedia: { type: string; id: string; url: string; alt?: string }[] = [];
  e.media.slice(0, 6).forEach((m, i) => {
    const id = mediaIds[i];
    if (!id) return;
    archivedMedia.push({ type: m.type, id, url: m.url, alt: m.alt });
    markdown = markdown.split(`](${m.url})`).join('](#archived)').replace(/!\[[^\]]*]\(#archived\)\n*/g, '').replace(`<video src="${m.url}"></video>`, '');
  });
  if (e.media.length) props[L.media] = { files: e.media.slice(0, 10).map((m, i) => (mediaIds[i] ? { type: 'file_upload', file_upload: { id: mediaIds[i] }, name: `${m.type}-${i + 1}` } : { type: 'external', external: { url: m.url }, name: `${m.type}-${i + 1}` })) };

  // Highlights are always the last section, so new ones can simply be appended.
  const parts: string[] = [`*Saved with Trove${input.via ? ` via ${input.via}` : ''} · [Open original](${url})*`];
  if (input.note) parts.push('## Note', input.note);
  if (markdown) parts.push(markdown);
  if (input.highlight) parts.push('## Highlights', `> ${input.highlight.replace(/\n+/g, ' ')}`);

  const body: Record<string, unknown> = {
    parent: { type: 'data_source_id', data_source_id: env().libraryDs },
    properties: props,
    icon: { type: 'external', external: { url: `https://www.google.com/s2/favicons?domain=${domain}&sz=128` } },
  };
  if (coverId) body.cover = { type: 'file_upload', file_upload: { id: coverId } };
  else if (e.image) body.cover = { type: 'external', external: { url: e.image } };

  let page: any;
  const attempts = [parts.join('\n\n'), [input.note ? `## Note\n\n${input.note}` : '', markdown.slice(0, 15000), `[Open original](${url})`].filter(Boolean).join('\n\n'), `[Open original](${url})`];
  for (const [i, md] of attempts.entries()) {
    try {
      page = await notion().createPage({ ...body, ...(i === 2 && !coverId ? { cover: undefined } : {}), markdown: md });
      break;
    } catch (err) {
      if (!(err instanceof NotionError) || err.status !== 400 || i === attempts.length - 1) throw err;
    }
  }
  if (archivedMedia.length) {
    const kind = (m: { type: string; url: string }) =>
      m.type === 'video' ? 'video' : m.type === 'image' ? 'image' : /\.(mp3|m4a|wav|ogg)(\?|$)/i.test(m.url) ? 'audio' : /pdf/i.test(m.url) || e.type === 'Paper' || e.type === 'Document' ? 'pdf' : 'file';
    const blocks = archivedMedia.map((m) => ({ object: 'block', type: kind(m), [kind(m)]: { type: 'file_upload', file_upload: { id: m.id }, caption: m.alt ? rt(m.alt) : [] } }));
    await notion().appendChildren(page.id, blocks).catch(() => {});
  }
  return { item: toItem(page), created: true };
}

async function saveNote(input: SaveInput): Promise<SaveResult> {
  await schemaOf('library');
  const text = input.text!.trim();
  const key = `note:${createHash('sha1').update(text).digest('hex').slice(0, 20)}`;
  const existing = await findLibraryByKey(key);
  if (existing) return { item: await mergeInto(existing, input), created: false };
  const firstLine = text.split('\n').find((l) => l.trim()) || 'Note';
  const props: Record<string, unknown> = {
    [L.title]: { title: rt(input.title || plain(firstLine).slice(0, 120)) },
    [L.key]: { rich_text: rt(key) },
    [L.type]: { select: { name: 'Note' } },
    [L.platform]: { select: { name: 'Web' } },
    [L.text]: { rich_text: rt(text.slice(0, 12000)) },
    [L.description]: { rich_text: rt(plain(text).slice(0, 300)) },
    [L.words]: { number: (text.match(/\S+/g) || []).length },
    ...baseProps({ ...input, note: input.note }),
  };
  const page = await notion().createPage({
    parent: { type: 'data_source_id', data_source_id: env().libraryDs },
    properties: props,
    icon: { type: 'emoji', emoji: '📝' },
    markdown: [text, input.note ? `## Note\n\n${input.note}` : ''].filter(Boolean).join('\n\n'),
  });
  return { item: toItem(page), created: true };
}

/** Saving something that already exists: merge tags, collection, note, highlight instead of duplicating. */
async function mergeInto(page: any, input: SaveInput): Promise<Item> {
  const item = toItem(page);
  const T = item.db === 'library' ? L : XP;
  const props: Record<string, unknown> = {};
  if (input.tags?.length) props[T.tags] = { multi_select: uniq([...item.tags, ...input.tags]).map((name) => ({ name })) };
  if (input.collection && input.collection !== item.collection) props[T.collection] = { select: { name: selName(input.collection) } };
  if (input.note && !item.note.includes(input.note)) props[T.note] = { rich_text: rt([item.note, input.note].filter(Boolean).join('\n\n')) };
  if (input.favorite) props[T.favorite] = { checkbox: true };
  if (Object.keys(props).length) await notion().updatePage(page.id, { properties: props });
  if (input.highlight && item.db === 'library') await addHighlight(page.id, input.highlight);
  return Object.keys(props).length || input.highlight ? (await getItem(page.id)).item : item;
}

async function saveTweet(id: string, input: SaveInput): Promise<SaveResult> {
  await schemaOf('x');
  const existing = await findTweet(id);
  if (existing) return { item: await mergeInto(existing, input), created: false };
  const fx = await fxTweet(id);
  if (!fx) throw new Error(`Could not read X post ${id} (deleted, private, or FxTwitter unavailable)`);
  const t = fxToPost(fx);
  const media = [...t.media, ...(t.quoted?.media || [])];
  const ids = await Promise.all(media.slice(0, 8).map((m: any, i: number) => importFile(m.url, `${t.id}-${i}.${m.type === 'photo' ? extOf(m.url, 'jpg') : 'mp4'}`, m.type === 'photo' ? 25000 : 120000)));
  const uploads = new Map<string, string>();
  media.slice(0, 8).forEach((m: any, i: number) => ids[i] && uploads.set(m.url, ids[i]!));
  const props: Record<string, any> = buildProperties(t, { source: input.via ? 'Agent' : 'Web', tags: input.tags || [] });
  if (input.collection) props[XP.collection] = { select: { name: selName(input.collection) } };
  if (input.note) props[XP.note] = { rich_text: rt(input.note) };
  if (input.favorite) props[XP.favorite] = { checkbox: true };
  const blocks: any[] = buildBlocks(t, { uploads, raw: true });
  const [first, ...rest] = chunk(blocks, 100);
  const page = await notion().createPage({
    parent: { type: 'data_source_id', data_source_id: env().xDs },
    icon: t.author?.avatar ? { type: 'external', external: { url: t.author.avatar } } : { type: 'emoji', emoji: '🐦' },
    properties: props,
    children: first,
  });
  for (const part of rest) await notion().appendChildren(page.id, part).catch(() => {});
  return { item: toItem(page), created: true };
}

export type Patch = Partial<{ title: string; tags: string[]; collection: string | null; note: string; favorite: boolean; read: boolean; remind: string | null; url: string }>;

export async function update(id: string, patch: Patch): Promise<Item> {
  const page = await notion().req('GET', `/pages/${id}`);
  const item = toItem(page);
  const T = item.db === 'library' ? L : XP;
  const props: Record<string, unknown> = {};
  if (patch.title !== undefined) props[T.title] = { title: rt(patch.title) };
  if (patch.tags !== undefined) props[T.tags] = { multi_select: uniq(patch.tags).map((name) => ({ name })) };
  if (patch.collection !== undefined) props[T.collection] = { select: patch.collection ? { name: selName(patch.collection) } : null };
  if (patch.note !== undefined) props[T.note] = { rich_text: rt(patch.note) };
  if (patch.favorite !== undefined) props[T.favorite] = { checkbox: patch.favorite };
  if (patch.read !== undefined) props[T.read] = { checkbox: patch.read };
  if (patch.remind !== undefined && item.db === 'library') props[L.remind] = { date: patch.remind ? { start: patch.remind } : null };
  if (patch.url !== undefined && item.db === 'library' && isUrl(patch.url)) {
    props[L.url] = { url: patch.url };
    props[L.key] = { rich_text: rt(urlKey(patch.url)) };
  }
  const updated = await notion().updatePage(id, { properties: props });
  return toItem(updated);
}

export async function remove(id: string) {
  await notion().updatePage(id, { in_trash: true });
}

/** Fill in YouTube details later (sent by the extension, which can read YouTube from the user's browser). */
export async function enrichYouTube(id: string, d: YouTubeData) {
  const page = await notion().req('GET', `/pages/${id}`);
  const item = toItem(page);
  if (item.db !== 'library') throw new Error('Not a library item');
  const md = youtubeSections(d);
  if (md) await notion().req('PATCH', `/pages/${id}/markdown`, { type: 'insert_content', insert_content: { content: md } });
  const words = ((d.transcript || d.description || '').match(/[\p{L}\p{N}]+/gu) || []).length;
  const props: Record<string, unknown> = {
    [L.duration]: { number: d.duration || null },
    [L.words]: { number: words || null },
    [L.text]: { rich_text: rt([item.title, d.description, d.transcript].filter(Boolean).join('\n').slice(0, 12000)) },
  };
  if (d.description) props[L.description] = { rich_text: rt(d.description) };
  if (d.published) props[L.published] = { date: { start: d.published } };
  if (d.author && !item.author) props[L.author] = { rich_text: rt(d.author) };
  return toItem(await notion().updatePage(id, { properties: props }));
}

export async function addHighlight(id: string, text: string, note?: string) {
  const page = await notion().req('GET', `/pages/${id}`);
  const item = toItem(page);
  const quote = `> ${text.replace(/\n+/g, ' ').trim()}${note ? `\n\n${note}` : ''}`;
  let md = '';
  try {
    md = (await notion().req('GET', `/pages/${id}/markdown`)).markdown || '';
  } catch { /* ignore */ }
  const hasSection = /^#{1,3}\s+Highlights\s*$/m.test(md);
  await notion().req('PATCH', `/pages/${id}/markdown`, { type: 'insert_content', insert_content: { content: hasSection ? quote : `## Highlights\n\n${quote}` } });
  if (item.db === 'library') await notion().updatePage(id, { properties: { [L.highlights]: { number: item.highlights + 1 } } });
  return { ...item, highlights: item.highlights + 1 };
}

// ---------- collections & tags ----------

export type Facet = { name: string; color: string; count: number };

async function options(db: 'library' | 'x', prop: string): Promise<{ id: string; name: string; color: string }[]> {
  const props = await schemaOf(db);
  const p = props[prop];
  return p?.select?.options || p?.multi_select?.options || [];
}

/** Rename (or merge into an existing name) a collection or tag across both sources. */
export async function renameFacet(kind: 'collection' | 'tag', from: string, to: string) {
  to = selName(to);
  let changed = 0;
  for (const db of ['library', 'x'] as const) {
    const T = db === 'library' ? L : XP;
    const prop = kind === 'collection' ? T.collection : T.tags;
    const filter = kind === 'collection' ? { property: prop, select: { equals: from } } : { property: prop, multi_select: { contains: from } };
    for await (const page of notion().queryAll(dsOf(db), { filter })) {
      if (kind === 'collection') await notion().updatePage(page.id, { properties: { [prop]: to ? { select: { name: to } } : { select: null } } });
      else {
        const tags = multi(page.properties[prop]).flatMap((t: string) => (t === from ? (to ? [to] : []) : [t]));
        await notion().updatePage(page.id, { properties: { [prop]: { multi_select: uniq(tags).map((name) => ({ name })) } } });
      }
      changed++;
    }
  }
  delete schemaReady.library;
  delete schemaReady.x;
  statsCache = null;
  return { changed };
}

// ---------- stats (sidebar counts) ----------

export type Stats = {
  total: number;
  library: number;
  x: number;
  unsorted: number;
  favorites: number;
  unread: number;
  notes: number;
  highlights: number;
  broken: number;
  reminders: number;
  noTags: number;
  collections: Facet[];
  tags: Facet[];
  types: Facet[];
  platforms: Facet[];
  at: number;
};

let statsCache: Stats | null = null;
let statsPending: Promise<Stats> | null = null;

export async function stats({ fresh = false } = {}): Promise<Stats> {
  if (statsCache && !fresh && Date.now() - statsCache.at < 5 * 60 * 1000) return statsCache;
  if (statsPending) return statsPending;
  statsPending = (async () => {
    const [lp, xp] = await Promise.all([schemaOf('library'), schemaOf('x')]);
    const s: Stats = { total: 0, library: 0, x: 0, unsorted: 0, favorites: 0, unread: 0, notes: 0, highlights: 0, broken: 0, reminders: 0, noTags: 0, collections: [], tags: [], types: [], platforms: [], at: Date.now() };
    const col = new Map<string, number>();
    const tag = new Map<string, number>();
    const typ = new Map<string, number>();
    const plat = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
    const want = (props: Record<string, any>, names: string[]) => names.map((n) => props[n]?.id).filter(Boolean);
    const scan = async (db: 'library' | 'x', props: Record<string, any>) => {
      const T = db === 'library' ? L : XP;
      const ids = want(props, db === 'library' ? [L.collection, L.tags, L.type, L.platform, L.favorite, L.read, L.note, L.highlights, L.status, L.remind] : [XP.collection, XP.tags, XP.type, XP.favorite, XP.read, XP.note]);
      for await (const page of notion().queryAll(dsOf(db), {}, ids)) {
        const it = toItem({ ...page, properties: page.properties });
        s.total++;
        s[db]++;
        if (it.collection) bump(col, it.collection);
        else s.unsorted++;
        if (!it.tags.length) s.noTags++;
        it.tags.forEach((t) => bump(tag, t));
        bump(typ, it.type);
        bump(plat, it.platform);
        if (it.favorite) s.favorites++;
        if (!it.read) s.unread++;
        if (page.properties[T.note] && txt(page.properties[T.note])) s.notes++;
        if (it.highlights) s.highlights++;
        if (it.status === 'Broken') s.broken++;
        if (it.remind) s.reminders++;
      }
    };
    await Promise.all([scan('library', lp), scan('x', xp)]);
    const colorOf = (opts: any[], name: string) => opts.find((x: any) => x.name === name)?.color || 'default';
    const colOpts = [...(lp[L.collection]?.select?.options || []), ...(xp[XP.collection]?.select?.options || [])];
    const tagOpts = [...(lp[L.tags]?.multi_select?.options || []), ...(xp[XP.tags]?.multi_select?.options || [])];
    const facet = (m: Map<string, number>, opts: any[] = []) => [...m].map(([name, count]) => ({ name, count, color: colorOf(opts, name) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    s.collections = facet(col, colOpts).sort((a, b) => a.name.localeCompare(b.name));
    s.tags = facet(tag, tagOpts);
    s.types = facet(typ);
    s.platforms = facet(plat);
    statsCache = s;
    return s;
  })().finally(() => {
    statsPending = null;
  });
  return statsPending;
}

/** Call after writes: counts and select options (new tags/collections) may have changed. */
export const invalidateStats = () => {
  statsCache = null;
  delete schemaReady.library;
  delete schemaReady.x;
};

// ---------- link health ----------

export async function checkLinks(limit = 120) {
  await schemaOf('library');
  const res = await notion().query(env().libraryDs, {
    filter: { and: [{ property: L.url, url: { is_not_empty: true } }, { property: L.type, select: { does_not_equal: 'Note' } }] },
    sorts: [{ property: L.checked, direction: 'ascending' }],
    page_size: Math.min(limit, 100),
  });
  let broken = 0;
  await Promise.all(
    chunk(res.results, 8).map(async (group: any[]) => {
      for (const page of group) {
        const url = page.properties[L.url]?.url;
        const status = await probe(url);
        if (status === 'Broken') broken++;
        await notion().updatePage(page.id, { properties: { [L.status]: { select: { name: status } }, [L.checked]: { date: { start: new Date().toISOString() } } } }).catch(() => {});
      }
    }),
  );
  invalidateStats();
  return { checked: res.results.length, broken };
}

async function probe(url: string): Promise<'OK' | 'Broken' | 'Redirect'> {
  const attempt = async (method: string) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      return await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' } });
    } finally {
      clearTimeout(t);
    }
  };
  try {
    let res = await attempt('HEAD');
    if (res.status === 405 || res.status === 403 || res.status === 400) res = await attempt('GET');
    res.body?.cancel().catch(() => {});
    if (res.status === 404 || res.status === 410) return 'Broken';
    if (res.status >= 500 && res.status !== 503) return 'Broken';
    return domainOf(res.url) && domainOf(res.url) !== domainOf(url) ? 'Redirect' : 'OK';
  } catch {
    return 'Broken';
  }
}

// ---------- export ----------

export async function* everything(q = ''): AsyncGenerator<Item> {
  let cursor: string | null = null;
  do {
    const page: { items: Item[]; cursor: string | null } = await list({ q, cursor, limit: 100 });
    for (const it of page.items) yield it;
    cursor = page.cursor;
  } while (cursor);
}

export { titleFor };
