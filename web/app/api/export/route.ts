import { guarded } from '@/lib/auth';
import { everything, type Item } from '@/lib/store';

export const maxDuration = 300;

const csvCell = (v: unknown) => {
  const s = Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function netscape(items: Item[]) {
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const k = it.collection || (it.type === 'X bookmark' ? 'X bookmarks' : 'Unsorted');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const ts = (d: string) => Math.floor(Date.parse(d) / 1000);
  const out = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Trove</TITLE>', '<H1>Trove</H1>', '<DL><p>'];
  for (const [name, list] of groups) {
    out.push(`  <DT><H3>${esc(name)}</H3>`, '  <DL><p>');
    for (const it of list) out.push(`    <DT><A HREF="${esc(it.url)}" ADD_DATE="${ts(it.created)}" TAGS="${esc(it.tags.join(','))}">${esc(it.title || it.url)}</A>${it.note ? `\n    <DD>${esc(it.note)}` : ''}`);
    out.push('  </DL><p>');
  }
  out.push('</DL><p>');
  return out.join('\n');
}

/** GET /api/export?format=json|csv|html|txt&q=  (q uses the search syntax, e.g. "#ai type:article") */
export const GET = guarded(async (req) => {
  const p = new URL(req.url).searchParams;
  const format = (p.get('format') || 'json').toLowerCase();
  const items: Item[] = [];
  for await (const it of everything(p.get('q') || '')) items.push(it);
  const date = new Date().toISOString().slice(0, 10);
  const file = (ext: string, type: string, body: string) =>
    new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, 'content-disposition': `attachment; filename="trove-${date}.${ext}"`, 'cache-control': 'no-store' } });
  if (format === 'csv') {
    const cols = ['id', 'title', 'note', 'excerpt', 'url', 'folder', 'tags', 'created', 'cover', 'highlights', 'favorite', 'type', 'source'];
    const rows = items.map((i) => [i.id, i.title, i.note, i.excerpt, i.url, i.collection || '', i.tags, i.created, i.cover && !/amazonaws/.test(i.cover) ? i.cover : '', i.highlights, i.favorite, i.type, i.db].map(csvCell).join(','));
    return file('csv', 'text/csv', [cols.join(','), ...rows].join('\n'));
  }
  if (format === 'html') return file('html', 'text/html', netscape(items));
  if (format === 'txt') return file('txt', 'text/plain', items.map((i) => i.url).filter(Boolean).join('\n'));
  return file('json', 'application/json', JSON.stringify({ exported: new Date().toISOString(), count: items.length, items }, null, 1));
});
