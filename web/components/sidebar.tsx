'use client';
import {
  AlarmClock, Archive, Bot, BookmarkCheck, Folder, FolderOpen, Hash, Heart, Highlighter, Inbox, Layers, Link2Off, Moon, NotebookPen, Search, Settings, Sun, Tags, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Scope, Stats } from './types';
import { NOTION_COLORS, TypeIcon, TYPE_ORDER } from './ui';

type Props = {
  stats?: Stats;
  scope: Scope;
  onScope: (s: Scope) => void;
  onSearch: () => void;
  onAgent: () => void;
  theme: 'light' | 'dark';
  onTheme: () => void;
  open: boolean;
  onClose: () => void;
};

const PLURAL: Record<string, string> = { Article: 'Articles', Video: 'Videos', Post: 'Posts', Link: 'Links', Image: 'Images', Document: 'Documents', Audio: 'Audio', Repo: 'Repos', Paper: 'Papers', Product: 'Products', Note: 'Notes' };
export const plural = (t: string) => PLURAL[t] || t;

const TAG_PREVIEW = 12;

export function Sidebar({ stats, scope, onScope, onSearch, onAgent, theme, onTheme, open, onClose }: Props) {
  const [allTags, setAllTags] = useState(false);
  const is = (k: Scope['kind'], v?: string) => scope.kind === k && (v === undefined || scope.value === v);
  const nav = (s: Scope) => {
    onScope(s);
    onClose();
  };

  // Nest under existing parents only; "Reading/Tech" without a "Reading" collection stays a top-level row.
  const collections = useMemo(() => {
    const list = stats?.collections || [];
    const names = new Set(list.map((c) => c.name));
    return list.map((c) => {
      const parts = c.name.split('/').map((p) => p.trim());
      let depth = 0;
      let start = 0;
      for (let i = 1; i < parts.length; i++) {
        if (names.has(parts.slice(0, i).join('/'))) {
          depth++;
          start = i;
        }
      }
      return { ...c, depth, label: parts.slice(start).join(' / ') };
    });
  }, [stats]);
  const tags = stats?.tags || [];
  const types = [...(stats?.types || [])].sort((a, b) => TYPE_ORDER.indexOf(a.name) - TYPE_ORDER.indexOf(b.name));

  const Item = ({ s, icon, label, count }: { s: Scope; icon: React.ReactNode; label: string; count?: number }) => {
    const active = is(s.kind, s.value);
    return (
      <button className={`nav ${active ? 'active' : ''}`} onClick={() => nav(s)} aria-current={active ? 'page' : undefined}>
        {icon}
        <span className="label">{label}</span>
        {count !== undefined && <span className="count">{count.toLocaleString()}</span>}
      </button>
    );
  };

  return (
    <>
      {open && <div className="scrim only-mobile" onClick={onClose} />}
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Library">
        <div className="side-head">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/logo.svg" alt="" />
            Trove
          </div>
          <span style={{ flex: 1 }} />
          <button className="icon-btn sm only-mobile" onClick={onClose} aria-label="Close menu">
            <X size={16} />
          </button>
        </div>
        <button className="side-search" onClick={onSearch}>
          <Search size={15} />
          <span>Search</span>
          <span className="kbd">⌘K</span>
        </button>
        <nav className="side-body scroll">
          <Item s={{ kind: 'all' }} icon={<Layers size={16} />} label="All items" count={stats?.total} />
          <Item s={{ kind: 'unsorted' }} icon={<Inbox size={16} />} label="Unsorted" count={stats?.unsorted} />
          <Item s={{ kind: 'unread' }} icon={<BookmarkCheck size={16} />} label="Read later" count={stats?.unread} />
          <Item s={{ kind: 'favorites' }} icon={<Heart size={16} />} label="Favorites" count={stats?.favorites} />
          {!!stats?.highlights && <Item s={{ kind: 'highlights' }} icon={<Highlighter size={16} />} label="Highlights" count={stats.highlights} />}
          {!!stats?.notes && <Item s={{ kind: 'notes' }} icon={<NotebookPen size={16} />} label="With notes" count={stats.notes} />}
          {!!stats?.reminders && <Item s={{ kind: 'reminders' }} icon={<AlarmClock size={16} />} label="Reminders" count={stats.reminders} />}

          <div className="side-section">
            <div className="side-title">Collections</div>
            {collections.length === 0 && <p className="side-empty">Give any item a collection to start one.</p>}
            {collections.map((c) => {
              const active = is('collection', c.name);
              const color = c.color && c.color !== 'default' ? NOTION_COLORS[c.color] : undefined;
              return (
                <button
                  key={c.name}
                  className={`nav ${active ? 'active' : ''}`}
                  style={{ paddingInlineStart: 8 + c.depth * 16 }}
                  onClick={() => nav({ kind: 'collection', value: c.name })}
                  aria-current={active ? 'page' : undefined}
                  title={c.name}
                >
                  {active ? <FolderOpen size={16} style={color ? { color } : undefined} /> : <Folder size={16} style={color ? { color } : undefined} />}
                  <span className="label">{c.label}</span>
                  <span className="count">{c.count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>

          <div className="side-section">
            <div className="side-title">Sources</div>
            <Item s={{ kind: 'source', value: 'library' }} icon={<Archive size={16} />} label="Library" count={stats?.library} />
            <Item s={{ kind: 'source', value: 'x' }} icon={<span className="glyph" aria-hidden="true">𝕏</span>} label="X bookmarks" count={stats?.x} />
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
                {tags.length > TAG_PREVIEW && (
                  <button className="btn ghost sm" onClick={() => setAllTags(!allTags)} aria-expanded={allTags}>
                    {allTags ? 'Show less' : `All ${tags.length}`}
                  </button>
                )}
              </div>
              {(allTags ? tags : tags.slice(0, TAG_PREVIEW)).map((t) => (
                <Item key={t.name} s={{ kind: 'tag', value: t.name }} icon={<Hash size={15} />} label={t.name} count={t.count} />
              ))}
            </div>
          )}

          <div className="side-section">
            <div className="side-title">Maintenance</div>
            {!!stats?.noTags && <Item s={{ kind: 'notag' }} icon={<Tags size={16} />} label="Untagged" count={stats.noTags} />}
            <Item s={{ kind: 'broken' }} icon={<Link2Off size={16} />} label="Broken links" count={stats?.broken} />
          </div>
        </nav>
        <div className="side-foot">
          <a className="icon-btn" href="/settings" aria-label="Settings" title="Settings">
            <Settings size={17} />
          </a>
          <button className="icon-btn" onClick={onTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button className="icon-btn" onClick={onAgent} aria-label="Agent" title="Agent">
            <Bot size={17} />
          </button>
          <span className="total">{stats ? `${stats.total.toLocaleString()} saved` : ''}</span>
        </div>
      </aside>
    </>
  );
}
