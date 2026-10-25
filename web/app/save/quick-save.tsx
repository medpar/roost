'use client';
import { Check, CircleAlert } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, patchItem, useStats } from '@/components/api';
import { CollectionInput, TagInput } from '@/components/taginput';
import type { Item } from '@/components/types';
import { Favicon } from '@/components/ui';

export default function QuickSave() {
  const p = useSearchParams();
  const [state, setState] = useState<'saving' | 'saved' | 'exists' | 'error'>('saving');
  const [item, setItem] = useState<Item | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const { data: stats } = useStats();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const url = p.get('url') || p.get('link') || '';
    const text = p.get('text') || '';
    const title = p.get('title') || '';
    const body = {
      url: url || undefined,
      text: !url ? [title, text].filter(Boolean).join('\n') : text || undefined,
      title: url && title ? title : undefined,
      tags: p.get('tags') || undefined,
      collection: p.get('collection') || undefined,
      highlight: p.get('highlight') || undefined,
      source: p.get('source') || (document.referrer ? 'Bookmarklet' : 'Share'),
    };
    api<{ item: Item; created: boolean }>('/api/items', { method: 'POST', json: body })
      .then((r) => {
        setItem(r.item);
        setNote(r.item.note);
        setState(r.created ? 'saved' : 'exists');
      })
      .catch((e) => {
        setErr(e.message);
        setState('error');
      });
  }, [p]);

  const close = () => {
    if (window.opener || history.length <= 1) window.close();
    else location.href = '/';
  };

  return (
    <div className="dialog" style={{ width: 'min(440px, 100%)' }}>
      <div className="dialog-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {state === 'saving' ? <span className="spinner" style={{ color: 'var(--accent)' }} /> : state === 'error' ? <CircleAlert color="var(--danger)" /> : <Check color="var(--ok)" />}
        <h3>{state === 'saving' ? 'Saving to Trove…' : state === 'saved' ? 'Saved to Trove' : state === 'exists' ? 'Already in your Trove' : 'Couldn’t save'}</h3>
      </div>
      <div className="dialog-body">
        {state === 'error' && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        {item && (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Favicon domain={item.domain} size={20} />
              <div style={{ minWidth: 0 }}>
                <div className="serif" style={{ fontSize: 20, lineHeight: 1.15 }}>{item.title}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{item.domain}</div>
              </div>
            </div>
            <div>
              <div className="field-label">Collection</div>
              <CollectionInput value={item.collection || ''} known={stats?.collections} onChange={(v) => patchItem(item.id, { collection: v || null }).then(setItem)} />
            </div>
            <div>
              <div className="field-label">Tags</div>
              <TagInput value={item.tags} known={stats?.tags} onChange={(tags) => { setItem({ ...item, tags }); patchItem(item.id, { tags }); }} />
            </div>
            <div>
              <div className="field-label">Note</div>
              <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== item.note && patchItem(item.id, { note })} placeholder="Optional" />
            </div>
          </>
        )}
      </div>
      <div className="dialog-foot">
        <a className="btn ghost" href={item ? `/?item=${item.id}` : '/'}>Open Trove</a>
        <button className="btn primary" onClick={close} disabled={state === 'saving'}>Done</button>
      </div>
    </div>
  );
}
