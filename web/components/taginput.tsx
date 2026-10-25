'use client';
import { Folder, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import type { Facet } from './types';

export function TagInput({ value, onChange, known = [], placeholder = 'Add tags' }: { value: string[]; onChange: (tags: string[]) => void; known?: Facet[]; placeholder?: string }) {
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const add = (t: string) => {
    const tag = t.trim().replace(/^#/, '').replace(/,/g, ' ');
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText('');
  };
  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase().replace(/^#/, '');
    return known.filter((k) => !value.includes(k.name) && (!q || k.name.toLowerCase().includes(q))).slice(0, q ? 8 : 6);
  }, [known, value, text]);
  return (
    <div>
      <div className="taginput" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
        {value.map((t) => (
          <span className="chip" key={t}>
            #{t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={value.length ? '' : placeholder}
          aria-label="Add a tag"
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) add(v.slice(0, -1));
            else setText(v);
          }}
          onFocus={() => setFocus(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => {
            setFocus(false);
            if (text.trim()) add(text);
          }}
        />
      </div>
      {focus && suggestions.length > 0 && (
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
  const [active, setActive] = useState(-1);
  const listId = useId();
  const handled = useRef(false);
  const q = text.trim().toLowerCase();
  const opts = known.filter((k) => !q || k.name.toLowerCase().includes(q)).slice(0, 8);
  const commit = (v: string) => {
    setText(v);
    if (v !== value) onChange(v);
  };
  return (
    <div className="combo">
      <input
        className="input"
        value={text}
        placeholder="Unsorted"
        role="combobox"
        aria-label="Collection"
        aria-expanded={focus && opts.length > 0}
        aria-controls={listId}
        onChange={(e) => {
          setText(e.target.value);
          setActive(-1);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          if (handled.current) handled.current = false;
          else commit(text.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, opts.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, -1));
          } else if (e.key === 'Enter') {
            commit(active >= 0 && opts[active] ? opts[active].name : text.trim());
            handled.current = true;
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(value);
            handled.current = true;
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      {focus && opts.length > 0 && (
        <div className="menu" id={listId} role="listbox">
          {opts.map((o, i) => (
            <button
              key={o.name}
              role="option"
              aria-selected={i === active}
              style={i === active ? { background: 'var(--bg-hover)' } : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                commit(o.name);
                handled.current = true;
                (document.activeElement as HTMLElement)?.blur();
              }}
            >
              <Folder size={15} />
              <span className="label">{o.name}</span>
              <span className="count">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
