'use client';
import { ArrowUpRight, Check, CheckCircle2, Circle, Heart, MoreHorizontal } from 'lucide-react';
import { memo, useState } from 'react';
import { fmtDuration, timeAgo } from './api';
import type { Item, View } from './types';
import { Favicon, PLATFORM_TINT, TypeIcon } from './ui';

export type ItemHandlers = {
  onOpen: (it: Item) => void;
  onCheck: (it: Item, range: boolean) => void;
  onFavorite: (it: Item) => void;
  onRead: (it: Item) => void;
  onMenu: (e: React.MouseEvent, it: Item) => void;
  onTag: (tag: string) => void;
};

type Props = ItemHandlers & { items: Item[]; view: View; selectedId: string | null; checked: Set<string> };

function Cover({ it }: { it: Item }) {
  const [broken, setBroken] = useState(false);
  const tint = PLATFORM_TINT[it.platform];
  if (it.cover && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={it.cover} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />;
  }
  if ((it.type === 'Post' || it.type === 'Note') && it.excerpt) return <div className="cover-quote">“{it.excerpt.slice(0, 260)}”</div>;
  return (
    <div className="cover-fallback" style={tint ? ({ '--tint': tint } as React.CSSProperties) : undefined}>
      <Favicon domain={it.domain} size={28} className="fav" />
      <span className="host">{it.domain || it.type}</span>
    </div>
  );
}

function badge(it: Item) {
  if (it.db === 'x') return it.stats?.thread && it.stats.thread > 1 ? `𝕏 · ${it.stats.thread}-post thread` : '𝕏';
  if (it.type === 'Video' && it.duration) return `▶ ${fmtDuration(it.duration)}`;
  if (it.readingTime) return `${it.readingTime} min read`;
  return null;
}

const Meta = ({ it }: { it: Item }) => (
  <div className="meta">
    <Favicon domain={it.domain} size={14} />
    <span className="host">{it.db === 'x' ? it.author.split(' ').pop() || 'x.com' : it.domain}</span>
    <span className="sep">·</span>
    <TypeIcon type={it.type} size={12} />
    <span className="sep">·</span>
    <span title={new Date(it.created).toLocaleString()}>{timeAgo(it.created)}</span>
    {it.status === 'Broken' && <span className="chip" style={{ height: 18, color: 'var(--danger)' }}>broken</span>}
  </div>
);

const Tags = ({ it, onTag }: { it: Item; onTag: (t: string) => void }) =>
  it.tags.length ? (
    <div className="tags">
      {it.tags.slice(0, 4).map((t) => (
        <button
          key={t}
          className="tag"
          style={{ border: 0, background: 'none', padding: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            onTag(t);
          }}
        >
          #{t}
        </button>
      ))}
    </div>
  ) : null;

const CardView = memo(function CardView({ it, i, selected, checked, h }: { it: Item; i: number; selected: boolean; checked: boolean; h: ItemHandlers }) {
  const b = badge(it);
  // Text posts and notes without media read better as text than behind a placeholder cover.
  const textual = !it.cover && (it.type === 'Post' || it.type === 'Note');
  const showExcerpt = it.excerpt && !textual && it.excerpt !== it.title;
  return (
    <article
      className={`card ${textual ? 'textual' : ''} ${selected ? 'selected' : ''} ${checked ? 'checked' : ''}`}
      style={{ '--i': Math.min(i, 24) } as React.CSSProperties}
      onClick={(e) => (e.metaKey || e.ctrlKey ? window.open(it.url || it.notionUrl, '_blank') : h.onOpen(it))}
      data-id={it.id}
    >
      {!textual && (
        <div className="cover">
          <Cover it={it} />
          {b && <span className="cover-badge">{b}</span>}
        </div>
      )}
      <button
        className={`check ${checked ? 'on' : ''}`}
        aria-label="Select"
        onClick={(e) => {
          e.stopPropagation();
          h.onCheck(it, e.shiftKey);
        }}
      >
        {checked && <Check size={14} strokeWidth={3} />}
      </button>
      <div className={`card-actions ${it.favorite ? 'show' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button className={it.favorite ? 'on' : ''} aria-label="Favorite" onClick={() => h.onFavorite(it)}>
          <Heart size={15} fill={it.favorite ? 'currentColor' : 'none'} />
        </button>
        <button aria-label={it.read ? 'Mark unread' : 'Mark read'} onClick={() => h.onRead(it)}>
          {it.read ? <CheckCircle2 size={15} /> : <Circle size={15} />}
        </button>
        {it.url && (
          <button aria-label="Open original" onClick={() => window.open(it.url, '_blank', 'noopener')}>
            <ArrowUpRight size={15} />
          </button>
        )}
        <button aria-label="More" onClick={(e) => h.onMenu(e, it)}>
          <MoreHorizontal size={15} />
        </button>
      </div>
      <div className="card-body">
        <h3 className="card-title" style={it.read ? { color: 'var(--ink-2)' } : undefined}>
          {it.title || it.url}
        </h3>
        {showExcerpt && <p className="card-excerpt">{it.excerpt}</p>}
        {it.note && <p className="card-note">{it.note}</p>}
        <Tags it={it} onTag={h.onTag} />
        <Meta it={it} />
      </div>
    </article>
  );
});

const RowView = memo(function RowView({ it, i, selected, checked, h }: { it: Item; i: number; selected: boolean; checked: boolean; h: ItemHandlers }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`row ${selected ? 'selected' : ''} ${checked ? 'checked' : ''}`} style={{ '--i': Math.min(i, 30) } as React.CSSProperties} onClick={() => h.onOpen(it)} data-id={it.id}>
      <div
        onClick={(e) => {
          e.stopPropagation();
          h.onCheck(it, e.shiftKey);
        }}
        style={{ display: 'grid', placeItems: 'center' }}
      >
        {checked ? <span className="check on" style={{ position: 'static', opacity: 1 }}><Check size={13} strokeWidth={3} /></span> : <Favicon domain={it.domain} size={22} className="fav" />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="row-title" style={it.read ? { color: 'var(--ink-2)', fontWeight: 500 } : undefined}>
          {it.favorite && <Heart size={12} fill="var(--accent)" color="var(--accent)" style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />}
          {it.title || it.url}
        </div>
        {(it.note || it.excerpt) && <div className="row-excerpt">{it.note || it.excerpt}</div>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Meta it={it} />
          <Tags it={it} onTag={h.onTag} />
        </div>
      </div>
      <div className="row-thumb">{it.cover && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={it.cover} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : null}</div>
      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        <button className={`icon-btn ${it.favorite ? 'on' : ''}`} aria-label="Favorite" onClick={() => h.onFavorite(it)}>
          <Heart size={15} fill={it.favorite ? 'currentColor' : 'none'} />
        </button>
        <button className="icon-btn" aria-label="Toggle read" onClick={() => h.onRead(it)}>
          {it.read ? <CheckCircle2 size={15} /> : <Circle size={15} />}
        </button>
        <button className="icon-btn" aria-label="More" onClick={(e) => h.onMenu(e, it)}>
          <MoreHorizontal size={15} />
        </button>
      </div>
    </div>
  );
});

const HeadlineView = memo(function HeadlineView({ it, selected, checked, h }: { it: Item; selected: boolean; checked: boolean; h: ItemHandlers }) {
  return (
    <div className={`headline ${selected ? 'selected' : ''} ${checked ? 'checked' : ''}`} onClick={() => h.onOpen(it)} onContextMenu={(e) => { e.preventDefault(); h.onMenu(e, it); }} data-id={it.id}>
      <Favicon domain={it.domain} size={16} />
      <span className="t" style={it.read ? { color: 'var(--ink-2)' } : undefined}>
        {it.favorite && <Heart size={11} fill="var(--accent)" color="var(--accent)" style={{ display: 'inline', marginRight: 6 }} />}
        {it.title || it.url}
        <span className="muted" style={{ marginLeft: 10, fontSize: 12.5 }}>{it.domain}</span>
      </span>
      <span className="d">{it.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}</span>
      <span className="d">{timeAgo(it.created)}</span>
    </div>
  );
});

function Tile({ it, i, h }: { it: Item; i: number; h: ItemHandlers }) {
  const [broken, setBroken] = useState(false);
  if (!it.cover || broken) {
    return (
      <div className="tile text" style={{ '--i': Math.min(i, 30) } as React.CSSProperties} onClick={() => h.onOpen(it)}>
        {it.title}
        <div className="meta" style={{ marginTop: 10 }}>
          <Favicon domain={it.domain} size={14} /> {it.domain}
        </div>
      </div>
    );
  }
  return (
    <div className="tile" style={{ '--i': Math.min(i, 30) } as React.CSSProperties} onClick={() => h.onOpen(it)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={it.cover} alt="" loading="lazy" onError={() => setBroken(true)} />
      <div className="cap">{it.title}</div>
    </div>
  );
}

export function Items({ items, view, selectedId, checked, ...h }: Props) {
  const handlers = h as ItemHandlers;
  if (view === 'list')
    return (
      <div className="list">
        {items.map((it, i) => (
          <RowView key={it.id} it={it} i={i} selected={it.id === selectedId} checked={checked.has(it.id)} h={handlers} />
        ))}
      </div>
    );
  if (view === 'headlines')
    return (
      <div>
        {items.map((it) => (
          <HeadlineView key={it.id} it={it} selected={it.id === selectedId} checked={checked.has(it.id)} h={handlers} />
        ))}
      </div>
    );
  if (view === 'mood')
    return (
      <div className="mood">
        {items.map((it, i) => (
          <Tile key={it.id} it={it} i={i} h={handlers} />
        ))}
      </div>
    );
  return (
    <div className={`grid ${checked.size ? 'selecting' : ''}`}>
      {items.map((it, i) => (
        <CardView key={it.id} it={it} i={i} selected={it.id === selectedId} checked={checked.has(it.id)} h={handlers} />
      ))}
    </div>
  );
}

export function Skeletons({ view }: { view: View }) {
  if (view === 'cards' || view === 'mood')
    return (
      <div className="grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 300 }} />
        ))}
      </div>
    );
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: view === 'list' ? 88 : 34 }} />
      ))}
    </div>
  );
}
