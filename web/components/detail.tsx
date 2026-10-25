'use client';
import { ArrowUpRight, CheckCircle2, Circle, Copy, ExternalLink, Heart, Highlighter, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { mutate } from 'swr';
import { api, fmtDate, fmtDuration, patchItem, useItem } from './api';
import { highlightsOf, Reader } from './reader';
import { CollectionInput, TagInput } from './taginput';
import type { Item, Stats } from './types';
import { Favicon, TypeIcon, useToast } from './ui';

type Props = { id: string; seed?: Item; stats?: Stats; onClose: () => void; onDelete: (it: Item) => void };

export function Detail({ id, seed, stats, onClose, onDelete }: Props) {
  const { data, isLoading } = useItem(id);
  const item = data?.item || seed;
  const toast = useToast();
  const [tab, setTab] = useState<'read' | 'highlights'>('read');
  const [title, setTitle] = useState(item?.title || '');
  const [note, setNote] = useState(item?.note || '');
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(item?.title || '');
    setNote(item?.note || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.title, item?.note]);

  useEffect(() => {
    setTab('read');
    readerRef.current?.closest('.panel-body')?.scrollTo({ top: 0 });
  }, [id]);

  if (!item) return null;
  const highlights = highlightsOf(data?.markdown);

  const save = async (patch: Partial<Item>) => {
    try {
      await patchItem(item.id, patch);
    } catch (e: any) {
      toast.push({ text: `Couldn't save: ${e.message}` });
    }
  };

  const onSelect = () => {
    const s = window.getSelection();
    const text = s?.toString().trim() || '';
    if (!text || text.length < 3 || !readerRef.current?.contains(s!.anchorNode)) return setSel(null);
    const r = s!.getRangeAt(0).getBoundingClientRect();
    setSel({ text, x: r.left + r.width / 2, y: r.top });
  };

  const highlight = async () => {
    if (!sel) return;
    const text = sel.text;
    setSel(null);
    window.getSelection()?.removeAllRanges();
    const t = toast.push({ text: 'Saving highlight…', busy: true });
    try {
      await api(`/api/items/${item.id}/highlights`, { method: 'POST', json: { text } });
      await mutate(`/api/items/${item.id}?content=1`);
      toast.update(t, { text: 'Highlight saved', busy: false });
    } catch (e: any) {
      toast.update(t, { text: `Couldn't save highlight: ${e.message}`, busy: false });
    }
  };

  const facts: [string, React.ReactNode][] = [
    ['Type', <span key="t" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><TypeIcon type={item.type} /> {item.type}{item.platform !== 'Web' ? ` · ${item.platform}` : ''}</span>],
    ...(item.author ? [['Author', item.author] as [string, React.ReactNode]] : []),
    ...(item.published ? [['Published', fmtDate(item.published)] as [string, React.ReactNode]] : []),
    ['Saved', `${fmtDate(item.created)}${item.via ? ` via ${item.via}` : item.source ? ` · ${item.source}` : ''}`],
    ...(item.readingTime ? [['Length', `${item.readingTime} min read`] as [string, React.ReactNode]] : []),
    ...(item.duration ? [['Duration', fmtDuration(item.duration)] as [string, React.ReactNode]] : []),
    ...(item.stats?.likes !== undefined && item.stats?.likes !== null ? [['Stats', `♥ ${item.stats.likes?.toLocaleString()} · ↻ ${item.stats.reposts?.toLocaleString() ?? 0}${item.stats.views ? ` · ${item.stats.views.toLocaleString()} views` : ''}`] as [string, React.ReactNode]] : []),
    ...(item.status === 'Broken' ? [['Status', <span key="s" style={{ color: 'var(--danger)' }}>Link looks broken — the archived copy below is safe</span>] as [string, React.ReactNode]] : []),
  ];

  return (
    <aside className="panel" aria-label="Item details">
      <div className="panel-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close (Esc)">
          <X size={18} />
        </button>
        <span style={{ flex: 1 }} />
        <button className={`icon-btn ${item.favorite ? 'on' : ''}`} onClick={() => save({ favorite: !item.favorite })} aria-label="Favorite (F)" title="Favorite (F)">
          <Heart size={17} fill={item.favorite ? 'currentColor' : 'none'} />
        </button>
        <button className={`icon-btn ${item.read ? 'on' : ''}`} onClick={() => save({ read: !item.read })} aria-label="Read (R)" title={item.read ? 'Mark unread (R)' : 'Mark read (R)'}>
          {item.read ? <CheckCircle2 size={17} /> : <Circle size={17} />}
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            navigator.clipboard.writeText(item.url || item.notionUrl);
            toast.push({ text: 'Link copied' });
          }}
          aria-label="Copy link"
          title="Copy link"
        >
          <Copy size={16} />
        </button>
        <a className="icon-btn" href={item.notionUrl} target="_blank" rel="noreferrer" aria-label="Open in Notion" title="Open in Notion">
          <ExternalLink size={16} />
        </a>
        <button className="icon-btn" onClick={() => onDelete(item)} aria-label="Delete" title="Delete">
          <Trash2 size={16} />
        </button>
        {item.url && (
          <a className="btn primary" href={item.url} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>
            Open <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      <div className="panel-body scroll" onMouseUp={onSelect} onScroll={() => sel && setSel(null)}>
        {item.cover && item.type !== 'Video' && (
          <div className="panel-cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.cover} alt="" />
          </div>
        )}
        <div className="panel-inner">
          <div>
            {item.url && (
              <a className="meta" href={item.url} target="_blank" rel="noreferrer" style={{ marginBottom: 10 }}>
                <Favicon domain={item.domain} size={16} />
                <span className="host" style={{ color: 'var(--ink-2)' }}>{item.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80)}</span>
              </a>
            )}
            <textarea
              className="title-edit"
              value={title}
              rows={1}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== item.title && save({ title: title.trim() })}
              aria-label="Title"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
            <div>
              <div className="field-label">Collection</div>
              <CollectionInput key={item.id + (item.collection || '')} value={item.collection || ''} known={stats?.collections} onChange={(v) => save({ collection: v || null })} />
            </div>
            <div>
              <div className="field-label">Tags</div>
              <TagInput value={item.tags} known={stats?.tags} onChange={(tags) => save({ tags })} />
            </div>
            <div>
              <div className="field-label">Note</div>
              <textarea className="textarea" placeholder="Why does this matter?" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== item.note && save({ note })} />
            </div>
          </div>

          <dl className="facts">
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="tabs" role="tablist">
            <button className={tab === 'read' ? 'on' : ''} onClick={() => setTab('read')} role="tab" aria-selected={tab === 'read'}>
              Archived copy
            </button>
            <button className={tab === 'highlights' ? 'on' : ''} onClick={() => setTab('highlights')} role="tab" aria-selected={tab === 'highlights'}>
              Highlights {highlights.length ? `· ${highlights.length}` : ''}
            </button>
          </div>

          <div ref={readerRef}>
            {isLoading && !data ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {[90, 100, 96, 70, 100, 84].map((w, i) => (
                  <div key={i} className="skeleton" style={{ height: 16, width: `${w}%` }} />
                ))}
              </div>
            ) : tab === 'read' ? (
              data?.markdown ? (
                <Reader markdown={data.markdown} highlights={highlights} />
              ) : (
                <p className="muted">No archived content for this item.</p>
              )
            ) : highlights.length ? (
              <div className="reader" style={{ fontSize: 16 }}>
                {highlights.map((h, i) => (
                  <blockquote key={i}>{h}</blockquote>
                ))}
              </div>
            ) : (
              <p className="muted">Select text in the archived copy to highlight it. Highlights from the browser extension show up here too.</p>
            )}
          </div>
        </div>
      </div>
      {sel && (
        <button
          className="btn primary"
          style={{ position: 'fixed', left: sel.x, top: Math.max(10, sel.y - 46), transform: 'translateX(-50%)', zIndex: 60, height: 32 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={highlight}
        >
          <Highlighter size={14} /> Highlight
        </button>
      )}
    </aside>
  );
}
