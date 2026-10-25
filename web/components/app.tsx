'use client';
import { ArrowDownUp, CheckCircle2, Copy, ExternalLink, FolderInput, Heart, HelpCircle, Image as ImageIcon, LayoutGrid, List, Menu as MenuIcon, Plus, Rows3, Search, Tag, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddDialog } from './add';
import { api, patchItem, refreshAll, removeLocal, useItems, useStats } from './api';
import { Detail } from './detail';
import { Items, Skeletons } from './items';
import { Palette } from './palette';
import { plural, Sidebar } from './sidebar';
import { CollectionInput, TagInput } from './taginput';
import type { Item, Scope, Sort, View } from './types';
import { Dialog, useHotkey, useMenu, useToast } from './ui';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'title', label: 'Title A–Z' },
  { id: 'title_desc', label: 'Title Z–A' },
  { id: 'site', label: 'Site' },
  { id: 'published', label: 'Published date' },
];

const scopeKey = (s: Scope) => (s.value ? `${s.kind}:${s.value}` : s.kind);
function parseScope(v: string | null): Scope {
  if (!v) return { kind: 'all' };
  const i = v.indexOf(':');
  return i > 0 ? ({ kind: v.slice(0, i), value: v.slice(i + 1) } as Scope) : ({ kind: v } as Scope);
}

function titleFor(s: Scope): { title: React.ReactNode; plain: string } {
  switch (s.kind) {
    case 'all':
      return { title: 'Everything', plain: 'Everything' };
    case 'unsorted':
      return { title: 'Unsorted', plain: 'Unsorted' };
    case 'favorites':
      return { title: 'Favorites', plain: 'Favorites' };
    case 'unread':
      return { title: <>Read <em>later</em></>, plain: 'Read later' };
    case 'highlights':
      return { title: 'Highlights', plain: 'Highlights' };
    case 'notes':
      return { title: 'With notes', plain: 'With notes' };
    case 'reminders':
      return { title: 'Reminders', plain: 'Reminders' };
    case 'broken':
      return { title: 'Broken links', plain: 'Broken links' };
    case 'notag':
      return { title: 'Untagged', plain: 'Untagged' };
    case 'collection': {
      const parts = (s.value || '').split('/');
      return { title: parts[parts.length - 1], plain: s.value || '' };
    }
    case 'tag':
      return { title: <><em>#</em>{s.value}</>, plain: `#${s.value}` };
    case 'type':
      return { title: plural(s.value || ''), plain: plural(s.value || '') };
    case 'source':
      return s.value === 'x' ? { title: <><em>𝕏</em> Bookmarks</>, plain: 'X Bookmarks' } : { title: 'Library', plain: 'Library' };
  }
}

export default function TroveApp() {
  const toast = useToast();
  const menu = useMenu();
  const [ready, setReady] = useState(false);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [view, setView] = useState<View>('cards');
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [bulkDialog, setBulkDialog] = useState<'move' | 'tag' | null>(null);
  const [theme, setTheme] = useState('system');
  const [dragging, setDragging] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // ---- state <-> URL ----
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setScope(parseScope(p.get('s')));
    setInput(p.get('q') || '');
    setQ(p.get('q') || '');
    setSort((p.get('sort') as Sort) || 'newest');
    const savedView = (() => {
      try {
        return localStorage.getItem('trove-view') as View | null;
      } catch {
        return null;
      }
    })();
    setView((p.get('view') as View) || savedView || 'cards');
    setSelected(p.get('item'));
    try {
      setTheme(localStorage.getItem('trove-theme') || 'system');
    } catch { /* private mode */ }
    if (p.get('add')) setAdding(p.get('add') === '1' ? '' : p.get('add'));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const p = new URLSearchParams();
    if (scope.kind !== 'all') p.set('s', scopeKey(scope));
    if (q) p.set('q', q);
    if (sort !== 'newest') p.set('sort', sort);
    if (selected) p.set('item', selected);
    const url = `${location.pathname}${p.toString() ? `?${p}` : ''}`;
    if (url !== location.pathname + location.search) history.replaceState(null, '', url);
    document.title = `${titleFor(scope).plain} · Trove`;
  }, [ready, scope, q, sort, selected]);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 280);
    return () => clearTimeout(t);
  }, [input]);

  // ---- data ----
  const { data: stats } = useStats();
  const list = useItems(scope, q, sort);
  const items = useMemo(() => list.items.filter((i) => !pendingDeletes.current.has(i.id)), [list.items]);
  const selectedItem = items.find((i) => i.id === selected);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && !list.done && !list.isValidating) list.setSize(list.size + 1);
    }, { rootMargin: '900px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.done, list.isValidating, list.size, list.setSize, items.length]);

  // ---- actions ----
  const changeScope = useCallback((s: Scope) => {
    setScope(s);
    setChecked(new Set());
    setInput('');
    setQ('');
    document.querySelector('.main-scroll')?.scrollTo({ top: 0 });
  }, []);

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('trove-view', v);
    } catch { /* ignore */ }
  };

  const cycleTheme = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    try {
      if (next === 'system') {
        localStorage.removeItem('trove-theme');
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem('trove-theme', next);
        document.documentElement.dataset.theme = next;
      }
    } catch { /* ignore */ }
  };

  const toggle = async (it: Item, field: 'favorite' | 'read') => {
    try {
      await patchItem(it.id, { [field]: !it[field] });
    } catch (e: any) {
      toast.push({ text: `Couldn't update: ${e.message}` });
    }
  };

  const del = useCallback(
    (targets: Item[]) => {
      const ids = targets.map((t) => t.id);
      ids.forEach((id) => pendingDeletes.current.set(id, setTimeout(() => {
        pendingDeletes.current.delete(id);
        api(`/api/items/${id}`, { method: 'DELETE' }).catch(() => {}).finally(() => refreshAll());
      }, 5000)));
      removeLocal(ids);
      if (selected && ids.includes(selected)) setSelected(null);
      setChecked(new Set());
      toast.push({
        text: ids.length === 1 ? 'Moved to trash' : `${ids.length} items moved to trash`,
        action: {
          label: 'Undo',
          run: () => {
            ids.forEach((id) => {
              clearTimeout(pendingDeletes.current.get(id));
              pendingDeletes.current.delete(id);
            });
            refreshAll();
          },
        },
      });
    },
    [selected, toast],
  );

  const saveUrls = useCallback(
    async (urls: string[]) => {
      const defaults = scope.kind === 'collection' ? { collection: scope.value } : scope.kind === 'tag' ? { tags: [scope.value!] } : {};
      for (const url of urls.slice(0, 20)) {
        const t = toast.push({ text: `Saving ${url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}…`, busy: true });
        try {
          const r = await api<{ item: Item; created: boolean }>('/api/items', { method: 'POST', json: { url, ...defaults, source: 'Web app' } });
          toast.update(t, { text: r.created ? `Saved “${r.item.title.slice(0, 50)}”` : 'Already in your library', busy: false, action: { label: 'Open', run: () => setSelected(r.item.id) } });
        } catch (e: any) {
          toast.update(t, { text: `Couldn't save: ${e.message}`, busy: false });
        }
      }
      refreshAll();
    },
    [scope, toast],
  );

  const check = (it: Item, range: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (range && lastChecked) {
        const a = items.findIndex((i) => i.id === lastChecked);
        const b = items.findIndex((i) => i.id === it.id);
        if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(items[i].id);
      } else if (next.has(it.id)) next.delete(it.id);
      else next.add(it.id);
      return next;
    });
    setLastChecked(it.id);
  };

  const bulk = async (action: string, value?: unknown) => {
    const ids = [...checked];
    if (action === 'delete') return del(items.filter((i) => checked.has(i.id)));
    const t = toast.push({ text: `Updating ${ids.length} items…`, busy: true });
    try {
      const r = await api<{ done: number }>('/api/items/bulk', { method: 'POST', json: { ids, action, value } });
      toast.update(t, { text: `Updated ${r.done} items`, busy: false });
      setChecked(new Set());
      refreshAll();
    } catch (e: any) {
      toast.update(t, { text: `Bulk update failed: ${e.message}`, busy: false });
    }
  };

  const openMenu = (e: React.MouseEvent, it: Item) => {
    e.stopPropagation();
    menu.open(e, [
      { label: 'Open original', icon: <ExternalLink size={15} />, run: () => window.open(it.url, '_blank') },
      { label: 'Copy link', icon: <Copy size={15} />, run: () => navigator.clipboard.writeText(it.url) },
      { label: 'Open in Notion', icon: <ExternalLink size={15} />, run: () => window.open(it.notionUrl, '_blank') },
      'sep',
      { label: it.favorite ? 'Remove favorite' : 'Favorite', icon: <Heart size={15} />, run: () => toggle(it, 'favorite') },
      { label: it.read ? 'Mark unread' : 'Mark read', icon: <CheckCircle2 size={15} />, run: () => toggle(it, 'read') },
      { label: 'Select', icon: <CheckCircle2 size={15} />, run: () => check(it, false) },
      'sep',
      { label: 'Delete', icon: <Trash2 size={15} />, danger: true, run: () => del([it]) },
    ], 'right');
  };

  // ---- global input: paste & drop to save ----
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const text = e.clipboardData?.getData('text/plain')?.trim() || '';
      if (!text) return;
      const urls = text.match(/https?:\/\/[^\s<>"'`]+/g) || [];
      e.preventDefault();
      if (urls.length && text.replace(/https?:\/\/[^\s<>"'`]+/g, '').trim().length < 3) saveUrls(urls);
      else setAdding(text);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.some((t) => t === 'text/uri-list' || t === 'text/plain')) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      setDragging(false);
      const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
      const urls = text.match(/https?:\/\/[^\s<>"'`]+/g) || [];
      if (urls.length) {
        e.preventDefault();
        saveUrls(urls);
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [saveUrls]);

  // ---- keyboard ----
  useHotkey(
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (palette || adding !== null || help || bulkDialog) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = items.findIndex((i) => i.id === selected);
      const cur = idx >= 0 ? items[idx] : null;
      const move = (d: number) => {
        const next = items[Math.max(0, Math.min(items.length - 1, (idx < 0 ? -1 : idx) + d))];
        if (next) {
          setSelected(next.id);
          document.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      };
      switch (e.key) {
        case 'Escape':
          if (checked.size) setChecked(new Set());
          else if (selected) setSelected(null);
          else if (document.activeElement === searchRef.current) searchRef.current?.blur();
          break;
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case 'n':
        case 'a':
          e.preventDefault();
          setAdding('');
          break;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          move(1);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          move(-1);
          break;
        case 'o':
          if (cur?.url) window.open(cur.url, '_blank');
          break;
        case 'f':
          if (cur) toggle(cur, 'favorite');
          break;
        case 'r':
          if (cur) toggle(cur, 'read');
          break;
        case 'x':
          if (cur) check(cur, false);
          break;
        case 'Delete':
        case 'Backspace':
          if (checked.size) bulk('delete');
          else if (cur) del([cur]);
          break;
        case '1':
          changeView('cards');
          break;
        case '2':
          changeView('list');
          break;
        case '3':
          changeView('headlines');
          break;
        case '4':
          changeView('mood');
          break;
        case '?':
          setHelp(true);
          break;
      }
    },
    [items, selected, checked, palette, adding, help, bulkDialog],
  );

  const head = titleFor(scope);
  const count =
    scope.kind === 'all' ? stats?.total : scope.kind === 'unsorted' ? stats?.unsorted : scope.kind === 'favorites' ? stats?.favorites : scope.kind === 'unread' ? stats?.unread
      : scope.kind === 'collection' ? stats?.collections.find((c) => c.name === scope.value)?.count : scope.kind === 'tag' ? stats?.tags.find((c) => c.name === scope.value)?.count
      : scope.kind === 'type' ? stats?.types.find((c) => c.name === scope.value)?.count : scope.kind === 'source' ? (scope.value === 'x' ? stats?.x : stats?.library) : undefined;

  const loading = !list.data && (list.isLoading || list.isValidating);

  return (
    <div className="app">
      <Sidebar stats={stats} scope={scope} onScope={changeScope} onSearch={() => setPalette(true)} theme={theme} onTheme={cycleTheme} open={sideOpen} onClose={() => setSideOpen(false)} />
      <main className="main">
        <div className="main-scroll scroll" onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 8)}>
          <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
            <div className="topbar-inner">
              <button className="icon-btn only-mobile" onClick={() => setSideOpen(true)} aria-label="Open menu">
                <MenuIcon size={19} />
              </button>
              <label className="search">
                <Search size={16} color="var(--muted)" />
                <input
                  ref={searchRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setQ(input.trim());
                    if (e.key === 'Escape') {
                      setInput('');
                      setQ('');
                    }
                  }}
                  placeholder={`Search ${head.plain.toLowerCase()}…  try #tag, type:video, site:github.com, "phrase"`}
                  aria-label="Search"
                />
                {input ? (
                  <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => { setInput(''); setQ(''); }} aria-label="Clear search">
                    <X size={14} />
                  </button>
                ) : (
                  <span className="kbd hide-mobile">/</span>
                )}
              </label>
              <span style={{ flex: 1 }} className="hide-mobile" />
              <div className="seg hide-mobile" role="group" aria-label="View">
                {([['cards', LayoutGrid, 'Cards'], ['list', List, 'List'], ['headlines', Rows3, 'Headlines'], ['mood', ImageIcon, 'Moodboard']] as const).map(([v, I, label]) => (
                  <button key={v} className={view === v ? 'on' : ''} onClick={() => changeView(v)} aria-label={label} title={label}>
                    <I size={16} />
                  </button>
                ))}
              </div>
              <button className="icon-btn" aria-label="Sort" title="Sort" onClick={(e) => menu.open(e, SORTS.map((s) => ({ label: s.label, on: sort === s.id, run: () => setSort(s.id) })), 'right')}>
                <ArrowDownUp size={17} />
              </button>
              <button className="btn primary" onClick={() => setAdding('')}>
                <Plus size={16} /> <span className="hide-mobile">Add</span>
              </button>
            </div>
          </header>

          <div className="page-head">
            <h1 className="page-title">{head.title}</h1>
            <span className="page-count">{count !== undefined ? `${count.toLocaleString()} item${count === 1 ? '' : 's'}` : items.length ? `${items.length}${list.done ? '' : '+'}` : ''}</span>
            <span style={{ flex: 1 }} />
            <button className="icon-btn hide-mobile" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelp(true)}>
              <HelpCircle size={17} />
            </button>
          </div>

          {(q || scope.kind !== 'all') && (
            <div className="filters">
              {scope.kind !== 'all' && (
                <span className="filter-chip">
                  {head.plain}
                  <button onClick={() => changeScope({ kind: 'all' })} aria-label="Clear filter">
                    <X size={12} />
                  </button>
                </span>
              )}
              {q && (
                <span className="filter-chip">
                  “{q}”
                  <button onClick={() => { setInput(''); setQ(''); }} aria-label="Clear search">
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>
          )}

          <section className="items" aria-busy={loading}>
            {loading ? (
              <Skeletons view={view} />
            ) : list.error && !items.length ? (
              <div className="empty">
                <h2>Couldn’t load your library.</h2>
                <p>{String(list.error.message || list.error)}</p>
                <button className="btn" style={{ marginTop: 14 }} onClick={() => list.mutate()}>Try again</button>
              </div>
            ) : !items.length ? (
              <div className="empty">
                <h2>{q ? 'No matches.' : scope.kind === 'all' ? 'Your trove is empty.' : 'Nothing here yet.'}</h2>
                <p>
                  {q ? (
                    <>Try fewer words, or search operators like <code>#tag</code>, <code>type:article</code>, <code>site:youtube.com</code>, <code>-word</code>.</>
                  ) : (
                    <>Paste a link anywhere (<span className="kbd">⌘V</span>), drop one onto the window, or press <span className="kbd">N</span>. Save from your phone, browser and AI agents — see <a href="/settings" style={{ color: 'var(--accent)' }}>Integrations</a>.</>
                  )}
                </p>
              </div>
            ) : (
              <Items
                items={items}
                view={view}
                selectedId={selected}
                checked={checked}
                onOpen={(it) => setSelected(it.id)}
                onCheck={check}
                onFavorite={(it) => toggle(it, 'favorite')}
                onRead={(it) => toggle(it, 'read')}
                onMenu={openMenu}
                onTag={(t) => changeScope({ kind: 'tag', value: t })}
              />
            )}
            <div ref={sentinel} style={{ height: 1 }} />
            {!loading && items.length > 0 && !list.done && <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}><span className="spinner" style={{ color: 'var(--muted)' }} /></div>}
            {!loading && list.done && items.length > 12 && <p className="mono muted" style={{ textAlign: 'center', padding: 30 }}>— {items.length.toLocaleString()} items —</p>}
          </section>
        </div>
      </main>

      {selected && <Detail key={selected} id={selected} seed={selectedItem} stats={stats} onClose={() => setSelected(null)} onDelete={(it) => del([it])} />}

      {checked.size > 0 && (
        <div className="bulk" role="toolbar" aria-label="Selection">
          <strong style={{ fontSize: 13, marginRight: 6 }}>{checked.size} selected</strong>
          <button className="btn" onClick={() => setBulkDialog('move')}><FolderInput size={15} /> Move</button>
          <button className="btn" onClick={() => setBulkDialog('tag')}><Tag size={15} /> Tag</button>
          <button className="btn" onClick={() => bulk('read')}><CheckCircle2 size={15} /> Read</button>
          <button className="btn" onClick={() => bulk('favorite')}><Heart size={15} /> Favorite</button>
          <button className="btn" onClick={() => bulk('delete')}><Trash2 size={15} /> Delete</button>
          <button className="btn" onClick={() => setChecked(new Set(items.map((i) => i.id)))}>All</button>
          <button className="icon-btn" style={{ color: 'inherit' }} onClick={() => setChecked(new Set())} aria-label="Clear selection"><X size={16} /></button>
        </div>
      )}

      {bulkDialog && <BulkDialog kind={bulkDialog} stats={stats} count={checked.size} onClose={() => setBulkDialog(null)} onApply={(v) => { bulk(bulkDialog === 'move' ? 'move' : 'tag', v); setBulkDialog(null); }} />}
      {adding !== null && (
        <AddDialog
          initial={adding}
          stats={stats}
          defaults={scope.kind === 'collection' ? { collection: scope.value } : scope.kind === 'tag' ? { tags: [scope.value!] } : undefined}
          onClose={() => setAdding(null)}
          onOpen={(it) => setSelected(it.id)}
        />
      )}
      {palette && (
        <Palette
          stats={stats}
          onClose={() => setPalette(false)}
          onScope={changeScope}
          onOpen={(it) => setSelected(it.id)}
          onAdd={(t) => setAdding(t || '')}
          onView={changeView}
          onTheme={cycleTheme}
          onSearch={(term) => {
            setInput(term);
            setQ(term);
          }}
        />
      )}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
      {dragging && <div className="dropzone">Drop to save</div>}
      {menu.node}
    </div>
  );
}

function BulkDialog({ kind, stats, count, onClose, onApply }: { kind: 'move' | 'tag'; stats: any; count: number; onClose: () => void; onApply: (v: any) => void }) {
  const [value, setValue] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  return (
    <Dialog onClose={onClose} label={kind === 'move' ? 'Move items' : 'Tag items'}>
      <div className="dialog-head">
        <h3>{kind === 'move' ? `Move ${count} items` : `Tag ${count} items`}</h3>
      </div>
      <div className="dialog-body">
        {kind === 'move' ? <CollectionInput value={value} onChange={setValue} known={stats?.collections} /> : <TagInput value={tags} onChange={setTags} known={stats?.tags} />}
      </div>
      <div className="dialog-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onApply(kind === 'move' ? value : tags)}>Apply</button>
      </div>
    </Dialog>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['⌘K', 'Search & commands'], ['/', 'Filter this view'], ['N', 'Add link or note'], ['⌘V', 'Paste a link anywhere to save it'],
    ['J / K', 'Next / previous item'], ['Esc', 'Close panel or selection'], ['O', 'Open original'], ['F', 'Favorite'], ['R', 'Mark read / unread'],
    ['X', 'Select'], ['⌫', 'Delete (undo for 5s)'], ['1–4', 'Cards, list, headlines, moodboard'],
  ];
  return (
    <Dialog onClose={onClose} label="Keyboard shortcuts">
      <div className="dialog-head"><h3>Keyboard shortcuts</h3></div>
      <div className="dialog-body" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 18px', alignItems: 'center' }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span><span className="kbd" style={{ fontSize: 12 }}>{k}</span></span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <div className="dialog-body" style={{ paddingTop: 0 }}>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          Search operators: <code>#tag</code> <code>-#tag</code> <code>type:video</code> <code>site:github.com</code> <code>collection:&quot;Dev/AI&quot;</code> <code>is:fav</code> <code>is:unread</code> <code>created:&gt;2025-01</code> <code>&quot;exact phrase&quot;</code> <code>-word</code> <code>match:OR</code>
        </p>
      </div>
    </Dialog>
  );
}
