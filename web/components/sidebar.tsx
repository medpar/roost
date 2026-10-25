'use client';
import {
  AlarmClock, Archive, BookmarkCheck, Folder, FolderOpen, Hash, Heart, Highlighter, Inbox, Layers, Link2Off, Monitor, Moon, NotebookPen, Search, Settings, Sun, Tags, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Scope, Stats } from './types';
import { NOTION_COLORS, TypeIcon, TYPE_ORDER } from './ui';

type Props = {
  stats?: Stats;
  scope: Scope;
  onScope: (s: Scope) => void;
  onSearch: () => void;
  theme: string;
  onTheme: () => void;
  open: boolean;
  onClose: () => void;
};

const PLURAL: Record<string, string> = { Article: 'Articles', Video: 'Videos', Post: 'Posts', Link: 'Links', Image: 'Images', Document: 'Documents', Audio: 'Audio', Repo: 'Repos', Paper: 'Papers', Product: 'Products', Note: 'Notes' };
export const plural = (t: string) => PLURAL[t] || t;

export function Sidebar({ stats, scope, onScope, onSearch, theme, onTheme, open, onClose }: Props) {
  const [allTags, setAllTags] = useState(false);
  const is = (k: Scope['kind'], v?: string) => scope.kind === k && (v === undefined || scope.value === v);
  const nav = (s: Scope) => {
    onScope(s);
    onClose();
  };

  const collections = useMemo(() => {
    const list = stats?.collections || [];
    return list.map((c) => {
      const parts = c.name.split('/').map((p) => p.trim());
      return { ...c, depth: parts.length - 1, label: parts[parts.length - 1] };
    });
  }, [stats]);
  const tags = stats?.tags || [];
  const types = [...(stats?.types || [])].sort((a, b) => TYPE_ORDER.indexOf(a.name) - TYPE_ORDER.indexOf(b.name));

  const Item = ({ s, icon, label, count, child }: { s: Scope; icon: React.ReactNode; label: string; count?: number; child?: boolean }) => (
    <button className={`nav ${is(s.kind, s.value) ? 'active' : ''} ${child ? 'child' : ''}`} onClick={() => nav(s)} aria-current={is(s.kind, s.value) ? 'page' : undefined}>
      {icon}
      <span className="label">{label}</span>
      {count !== undefined && <span className="count">{count.toLocaleString()}</span>}
    </button>
  );

  return (
    <>
      {open && <div className="scrim only-mobile" onClick={onClose} />}
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Library navigation">
        <div className="side-head">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/logo.svg" alt="" />
            Trove
          </div>
          <span style={{ flex: 1 }} />
          <button className="icon-btn only-mobile" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <button className="side-search" onClick={onSearch}>
          <Search size={15} />
          <span style={{ flex: 1, textAlign: 'left' }}>Search or jump to…</span>
          <span className="kbd">⌘K</span>
        </button>
        <nav className="side-body scroll">
          <Item s={{ kind: 'all' }} icon={<Layers size={16} />} label="Everything" count={stats?.total} />
          <Item s={{ kind: 'unsorted' }} icon={<Inbox size={16} />} label="Unsorted" count={stats?.unsorted} />
          <Item s={{ kind: 'unread' }} icon={<BookmarkCheck size={16} />} label="Read later" count={stats?.unread} />
          <Item s={{ kind: 'favorites' }} icon={<Heart size={16} />} label="Favorites" count={stats?.favorites} />
          {!!stats?.highlights && <Item s={{ kind: 'highlights' }} icon={<Highlighter size={16} />} label="Highlights" count={stats.highlights} />}
          {!!stats?.notes && <Item s={{ kind: 'notes' }} icon={<NotebookPen size={16} />} label="With notes" count={stats.notes} />}
          {!!stats?.reminders && <Item s={{ kind: 'reminders' }} icon={<AlarmClock size={16} />} label="Reminders" count={stats.reminders} />}

          <div className="side-section">
            <div className="side-title">Collections</div>
            {collections.length === 0 && <p className="muted" style={{ padding: '2px 8px', fontSize: 12.5 }}>Set a collection on any item to create one.</p>}
            {collections.map((c) => (
              <button
                key={c.name}
                className={`nav ${is('collection', c.name) ? 'active' : ''}`}
                style={{ paddingLeft: 8 + c.depth * 16 }}
                onClick={() => nav({ kind: 'collection', value: c.name })}
                title={c.name}
              >
                {is('collection', c.name) ? <FolderOpen size={16} color={NOTION_COLORS[c.color]} /> : <Folder size={16} color={NOTION_COLORS[c.color]} />}
                <span className="label">{c.label}</span>
                <span className="count">{c.count}</span>
              </button>
            ))}
          </div>

          <div className="side-section">
            <div className="side-title">Sources</div>
            <Item s={{ kind: 'source', value: 'library' }} icon={<Archive size={16} />} label="Library" count={stats?.library} />
            <Item s={{ kind: 'source', value: 'x' }} icon={<span style={{ width: 16, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>𝕏</span>} label="X Bookmarks" count={stats?.x} />
          </div>

          {types.length > 0 && (
            <div className="side-section">
              <div className="side-title">Types</div>
              {types.map((t) => (
                <Item key={t.name} s={{ kind: 'type', value: t.name }} icon={<TypeIcon type={t.name} size={16} />} label={plural(t.name)} count={t.count} />
              ))}
            </div>
          )}

          {tags.length > 0 && (
            <div className="side-section">
              <div className="side-title">
                <span>Tags</span>
                {tags.length > 14 && (
                  <button className="btn ghost" style={{ height: 20, padding: '0 6px', fontSize: 11 }} onClick={() => setAllTags(!allTags)}>
                    {allTags ? 'Less' : `All ${tags.length}`}
                  </button>
                )}
              </div>
              {(allTags ? tags : tags.slice(0, 14)).map((t) => (
                <Item key={t.name} s={{ kind: 'tag', value: t.name }} icon={<Hash size={15} />} label={t.name} count={t.count} />
              ))}
            </div>
          )}

          <div className="side-section">
            <div className="side-title">Tidy up</div>
            {!!stats?.noTags && <Item s={{ kind: 'notag' }} icon={<Tags size={16} />} label="Untagged" count={stats.noTags} />}
            <Item s={{ kind: 'broken' }} icon={<Link2Off size={16} />} label="Broken links" count={stats?.broken} />
          </div>
        </nav>
        <div className="side-foot">
          <a className="icon-btn" href="/settings" aria-label="Settings" title="Settings & integrations">
            <Settings size={17} />
          </a>
          <button className="icon-btn" onClick={onTheme} aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`}>
            {theme === 'dark' ? <Moon size={17} /> : theme === 'light' ? <Sun size={17} /> : <Monitor size={17} />}
          </button>
          <span style={{ flex: 1 }} />
          <span className="mono muted" style={{ paddingRight: 6 }}>
            {stats ? `${stats.total.toLocaleString()} saved` : ''}
          </span>
        </div>
      </aside>
    </>
  );
}
