'use client';
import { ArrowUpRight, Bot, CalendarDays, CheckCircle2, Circle, Clock, Copy, ExternalLink, Folder, Hash, Heart, Highlighter, Inbox, NotebookPen, Trash2, User, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { mutate } from 'swr';
import { api, fmtDate, fmtDuration, patchItem, useItem } from './api';
import { highlightsOf, Reader } from './reader';
import { CollectionInput, TagInput } from './taginput';
import type { Item, Stats } from './types';
import { Favicon, TypeIcon, useToast } from './ui';

type Props = { id: string; seed?: Item; stats?: Stats; onClose: () => void; onDelete: (it: Item) => void; onAsk: (it: Item) => void };

export function Detail({ id, seed, stats, onClose, onDelete, onAsk }: Props) {
  const { data, isLoading } = useItem(id);
  const item = data?.item || seed;
  const toast = useToast();
  const [tab, setTab] = useState<'read' | 'highlights'>('read');
  const [title, setTitle] = useState(item?.title || '');
  const [note, setNote] = useState(item?.note || '');
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(item?.title || '');
    setNote(item?.note || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.title, item?.note]);

  useEffect(() => {
    setTab('read');
    setSel(null);
    bodyRef.current?.scrollTo({ top: 0 });
  }, [id]);

  if (!item) return null;
  const highlights = highlightsOf(data?.markdown);

  const save = async (patch: Partial<Item>) => {
    try {
      await patchItem(item.id, patch);
    } catch (e: any) {
      toast.push({ text: `Couldn’t save: ${e.message}` });
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
      toast.update(t, { text: `Couldn’t save the highlight: ${e.message}`, busy: false });
    }
  };

  const saved = `${fmtDate(item.created)}${item.via ? ` via ${item.via}` : item.source ? ` from ${item.source}` : ''}`;
  const length = item.duration ? fmtDuration(item.duration) : item.readingTime ? `${item.readingTime} min read` : '';
  const engagement =
    item.stats?.likes !== undefined && item.stats?.likes !== null
      ? [`${item.stats.likes?.toLocaleString()} likes`, `${(item.stats.reposts ?? 0).toLocaleString()} reposts`, item.stats.views ? `${item.stats.views.toLocaleString()} views` : ''].filter(Boolean).join(' · ')
      : '';

  return (
    <aside className="panel" aria-label="Item details">
      <div className="panel-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <X size={18} />
        </button>
        <span className="spacer" />
        <button className={`icon-btn ${item.favorite ? 'on' : ''}`} onClick={() => save({ favorite: !item.favorite })} aria-label={item.favorite ? 'Remove favorite' : 'Favorite'} aria-pressed={item.favorite} title="Favorite (F)">
          <Heart size={17} fill={item.favorite ? 'currentColor' : 'none'} />
        </button>
        <button className={`icon-btn ${item.read ? 'on' : ''}`} onClick={() => save({ read: !item.read })} aria-label={item.read ? 'Mark unread' : 'Mark read'} title={item.read ? 'Mark unread (R)' : 'Mark read (R)'}>
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
        <button className="icon-btn" onClick={() => onAsk(item)} aria-label="Ask the agent about this item" title="Ask the agent">
          <Bot size={17} />
        </button>
        <a className="icon-btn" href={item.notionUrl} target="_blank" rel="noreferrer" aria-label="Open in Notion" title="Open in Notion">
          <ExternalLink size={16} />
        </a>
        <button className="icon-btn" onClick={() => onDelete(item)} aria-label="Move to trash" title="Move to trash">
          <Trash2 size={16} />
        </button>
        {item.url && (
          <a className="btn primary" href={item.url} target="_blank" rel="noreferrer">
            Open <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      <div className="panel-body scroll" ref={bodyRef} onMouseUp={onSelect} onScroll={() => sel && setSel(null)}>
        {item.cover && item.type !== 'Video' && (
          <div className="panel-cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.cover} alt="" />
          </div>
        )}
        <div className="panel-inner">
          <div>
            {item.url && (
              <a className="source-link" href={item.url} target="_blank" rel="noreferrer">
                <Favicon domain={item.domain} size={14} />
                <span>{item.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
              </a>
            )}
            <textarea
              className="title-edit"
              value={title}
              rows={1}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
              onBlur={() => title.trim() && title !== item.title && save({ title: title.trim() })}
              aria-label="Title"
            />
          </div>

          <div className="props">
            <span className="prop-label"><Folder size={15} /> Collection</span>
            <div className="prop-value">
              <CollectionInput key={item.id + (item.collection || '')} value={item.collection || ''} known={stats?.collections} onChange={(v) => save({ collection: v || null })} />
            </div>
            <span className="prop-label"><Hash size={15} /> Tags</span>
            <div className="prop-value" style={{ display: 'block' }}>
              <TagInput value={item.tags} known={stats?.tags} onChange={(tags) => save({ tags })} placeholder="Add tags" />
            </div>
            <span className="prop-label"><NotebookPen size={15} /> Note</span>
            <div className="prop-value">
              <textarea className="textarea" rows={1} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== item.note && save({ note })} aria-label="Note" />
            </div>
            <span className="prop-label"><TypeIcon type={item.type} size={15} /> Type</span>
            <div className="prop-value text">{item.type}{item.platform && item.platform !== 'Web' ? ` · ${item.platform}` : ''}</div>
            {item.author && (
              <>
                <span className="prop-label"><User size={15} /> Author</span>
                <div className="prop-value text">{item.author}</div>
              </>
            )}
            {item.published && (
              <>
                <span className="prop-label"><CalendarDays size={15} /> Published</span>
                <div className="prop-value text">{fmtDate(item.published)}</div>
              </>
            )}
            <span className="prop-label"><Inbox size={15} /> Saved</span>
            <div className="prop-value text">{saved}</div>
            {length && (
              <>
                <span className="prop-label"><Clock size={15} /> Length</span>
                <div className="prop-value text num">{length}</div>
              </>
            )}
            {engagement && (
              <>
                <span className="prop-label"><Heart size={15} /> Engagement</span>
                <div className="prop-value text num">{engagement}</div>
              </>
            )}
            {item.status === 'Broken' && (
              <>
                <span className="prop-label" style={{ color: 'var(--danger)' }}><ExternalLink size={15} /> Status</span>
                <div className="prop-value text" style={{ color: 'var(--danger)' }}>The original link looks broken. The archived copy below is safe.</div>
              </>
            )}
          </div>

          <div className="tabs" role="tablist" aria-label="Content">
            <button className={tab === 'read' ? 'on' : ''} onClick={() => setTab('read')} role="tab" aria-selected={tab === 'read'}>
              Archived copy
            </button>
            <button className={tab === 'highlights' ? 'on' : ''} onClick={() => setTab('highlights')} role="tab" aria-selected={tab === 'highlights'}>
              Highlights{highlights.length > 0 && <span className="count">{highlights.length}</span>}
            </button>
          </div>

          <div ref={readerRef} role="tabpanel">
            {isLoading && !data ? (
              <div style={{ display: 'grid', gap: 10 }} aria-label="Loading content">
                {[92, 100, 96, 74, 100, 86].map((w, i) => (
                  <div key={i} className="skeleton" style={{ height: 14, width: `${w}%`, borderRadius: 6 }} />
                ))}
              </div>
            ) : tab === 'read' ? (
              data?.markdown ? (
                <Reader markdown={data.markdown} highlights={highlights} note={item.note} />
              ) : (
                <p className="muted">No archived content for this item.</p>
              )
            ) : highlights.length ? (
              <div className="highlights-list">
                {highlights.map((h, i) => (
                  <blockquote key={i}>{h}</blockquote>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ lineHeight: 1.6 }}>Select text in the archived copy to highlight it. Highlights saved from the browser extension show up here too.</p>
            )}
          </div>
        </div>
      </div>
      {sel && (
        <button className="btn primary highlight-pop" style={{ left: sel.x, top: Math.max(10, sel.y - 44) }} onMouseDown={(e) => e.preventDefault()} onClick={highlight}>
          <Highlighter size={14} /> Highlight
        </button>
      )}
    </aside>
  );
}
