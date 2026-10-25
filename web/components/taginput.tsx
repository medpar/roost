'use client';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Facet } from './types';

export function TagInput({ value, onChange, known = [], placeholder = 'Add tags…' }: { value: string[]; onChange: (tags: string[]) => void; known?: Facet[]; placeholder?: string }) {
  const [text, setText] = useState('');
  const add = (t: string) => {
    const tag = t.trim().replace(/^#/, '').replace(/,/g, ' ');
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText('');
  };
  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase().replace(/^#/, '');
    return known
      .filter((k) => !value.includes(k.name) && (!q || k.name.toLowerCase().includes(q)))
      .slice(0, q ? 8 : 6);
  }, [known, value, text]);
  return (
    <div>
      <div className="taginput" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
        {value.map((t) => (
          <span className="chip" key={t}>
            #{t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => onChange(value.filter((x) => x !== t))}
              style={{ border: 0, background: 'none', color: 'var(--muted)', display: 'grid', placeItems: 'center' }}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) add(v.slice(0, -1));
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="suggest">
          {suggestions.map((s) => (
            <button type="button" key={s.name} onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.name)}>
              + {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CollectionInput({ value, onChange, known = [] }: { value: string; onChange: (v: string) => void; known?: Facet[] }) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  const q = text.trim().toLowerCase();
  const opts = known.filter((k) => !q || k.name.toLowerCase().includes(q)).slice(0, 8);
  const commit = (v: string) => {
    setText(v);
    if (v !== value) onChange(v);
  };
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        value={text}
        placeholder="Unsorted"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          commit(text.trim());
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      {focus && opts.length > 0 && (
        <div className="menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0 }}>
          {opts.map((o) => (
            <button key={o.name} onMouseDown={(e) => e.preventDefault()} onClick={() => {
              commit(o.name);
              (document.activeElement as HTMLElement)?.blur();
            }}>
              <span style={{ flex: 1 }}>{o.name}</span>
              <span className="mono muted">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
