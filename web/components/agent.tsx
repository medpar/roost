'use client';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ArrowUp, Copy, FolderTree, Layers, ListChecks, RefreshCw, RotateCcw, Square, Tags, Telescope, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshAll } from './api';
import { CodeBox } from './ui';

type Engine = 'claude' | 'codex';
type Health = { ok: boolean; busy: boolean; engines: Record<Engine, { installed: boolean; loggedIn: boolean }> };
type Turn =
  | { role: 'user'; text: string }
  | { role: 'agent'; text: string[]; steps: string[]; error?: string; running: boolean; status?: string };

const DEFAULT_BRIDGE = 'http://127.0.0.1:7878';
const ENGINE_NAME: Record<Engine, string> = { claude: 'Claude', codex: 'Codex' };

const PRESETS: { icon: React.ReactNode; label: string; prompt: string }[] = [
  { icon: <Tags size={16} />, label: 'Tag everything that has no tags', prompt: 'Find every item without tags and give each one 1–4 fitting tags, reusing my existing tags where possible.' },
  { icon: <FolderTree size={16} />, label: 'Sort Unsorted into collections', prompt: 'Go through my Unsorted items and move each one into the best existing collection. Suggest new collections only where a clear group of at least 3 items has no home, and create them.' },
  { icon: <Layers size={16} />, label: 'Clean up my tags', prompt: 'Review all my tags. Merge duplicates, synonyms, plural/singular pairs and typos into one tag each, then summarize the merges.' },
  { icon: <ListChecks size={16} />, label: 'Find duplicates', prompt: 'Find items that look like duplicates or near-duplicates (same content, different URLs) and list them. Do not delete anything.' },
  { icon: <Telescope size={16} />, label: 'What did I save this week?', prompt: 'Summarize what I saved in the last 7 days, grouped by theme, with links to the most interesting items.' },
];

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch { /* private mode */ }
};

function Markdown({ text, onOpen }: { text: string; onOpen: (id: string) => void }) {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }) as string);
  return (
    <div
      className="msg-agent"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        const id = a && /[?&]item=([\w-]+)/.exec(a.getAttribute('href') || '')?.[1];
        if (id) {
          e.preventDefault();
          onOpen(id);
        } else if (a) {
          e.preventDefault();
          window.open(a.href, '_blank', 'noopener');
        }
      }}
    />
  );
}

export function AgentPanel({ initial = '', onClose, onOpen }: { initial?: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [bridge, setBridge] = useState(DEFAULT_BRIDGE);
  const [health, setHealth] = useState<Health | null | 'checking'>('checking');
  const [engine, setEngine] = useState<Engine>('claude');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [session, setSession] = useState<Partial<Record<Engine, string>>>({});
  const [text, setText] = useState(initial);
  const running = turns.some((t) => t.role === 'agent' && t.running);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const ctrl = useRef<AbortController | null>(null);

  const check = useCallback(async (url: string, fresh = false) => {
    setHealth('checking');
    try {
      const r = await fetch(`${url}/health${fresh ? '?fresh=1' : ''}`, { signal: AbortSignal.timeout(25000) });
      const h: Health = await r.json();
      setHealth(h);
      const saved = read('trove-agent-engine') as Engine | null;
      const usable = (e: Engine) => h.engines[e]?.installed && h.engines[e]?.loggedIn;
      setEngine(saved && usable(saved) ? saved : usable('claude') ? 'claude' : usable('codex') ? 'codex' : saved || 'claude');
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    const url = read('trove-agent-url') || DEFAULT_BRIDGE;
    setBridge(url);
    check(url);
    try {
      const s = JSON.parse(sessionStorage.getItem('trove-agent') || 'null');
      if (s) {
        setTurns((s.turns || []).map((t: Turn) => (t.role === 'agent' ? { ...t, running: false } : t)));
        setSession(s.session || {});
      }
    } catch { /* nothing saved */ }
  }, [check]);

  useEffect(() => {
    if (!running) {
      try {
        sessionStorage.setItem('trove-agent', JSON.stringify({ turns: turns.slice(-40), session }));
      } catch { /* quota */ }
    }
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [turns, session, running]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, running]);

  useEffect(() => {
    inputRef.current?.focus();
    const el = inputRef.current;
    if (el && initial) el.setSelectionRange(initial.length, initial.length);
  }, [initial]);

  const pickEngine = (e: Engine) => {
    setEngine(e);
    write('trove-agent-engine', e);
  };

  const send = async (prompt: string) => {
    prompt = prompt.trim();
    if (!prompt || running) return;
    setText('');
    setTurns((t) => [...t, { role: 'user', text: prompt }, { role: 'agent', text: [], steps: [], running: true }]);
    const patch = (fn: (t: Extract<Turn, { role: 'agent' }>) => Partial<Extract<Turn, { role: 'agent' }>>) =>
      setTurns((all) => {
        const next = [...all];
        const last = next[next.length - 1];
        if (last?.role === 'agent') next[next.length - 1] = { ...last, ...fn(last) };
        return next;
      });
    ctrl.current = new AbortController();
    try {
      const res = await fetch(`${bridge}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, engine, session: session[engine] }),
        signal: ctrl.current.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `The agent answered ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === 'session' && e.id) setSession((s) => ({ ...s, [engine]: e.id }));
          else if (e.type === 'text') patch((t) => ({ text: [...t.text, e.text], status: undefined }));
          else if (e.type === 'tool') patch((t) => ({ steps: [...t.steps, e.label], status: undefined }));
          else if (e.type === 'status') patch(() => ({ status: e.text }));
          else if (e.type === 'error') patch((t) => ({ error: t.error ? `${t.error}\n${e.message}` : e.message }));
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') patch(() => ({ error: err?.message === 'Failed to fetch' ? 'Lost the connection to the agent on your computer.' : err?.message || String(err) }));
    } finally {
      patch(() => ({ running: false, status: undefined }));
      ctrl.current = null;
      refreshAll();
    }
  };

  const stop = () => {
    fetch(`${bridge}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' } }).catch(() => {});
    ctrl.current?.abort();
  };

  const reset = () => {
    setTurns([]);
    setSession({});
    try {
      sessionStorage.removeItem('trove-agent');
    } catch { /* ignore */ }
    inputRef.current?.focus();
  };

  const online = health && health !== 'checking';
  const ready = online && (health as Health).engines[engine]?.installed && (health as Health).engines[engine]?.loggedIn;
  const h = online ? (health as Health) : null;

  return (
    <aside className="agent" aria-label="Agent">
      <div className="agent-head">
        <h2>Agent</h2>
        <span className={`agent-status ${online ? 'online' : ''}`} role="status">
          <span className="dot" />
          {health === 'checking' ? 'Connecting…' : online ? `On this computer · ${ENGINE_NAME[engine]}` : 'Not connected'}
        </span>
        <span style={{ flex: 1 }} />
        {turns.length > 0 && (
          <button className="icon-btn" onClick={reset} disabled={running} aria-label="New conversation" title="New conversation">
            <RotateCcw size={16} />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close agent" title="Close (Esc)">
          <X size={18} />
        </button>
      </div>

      <div className="agent-body scroll" ref={bodyRef}>
        {health === null ? (
          <Setup bridge={bridge} onRetry={() => check(bridge, true)} />
        ) : turns.length === 0 ? (
          <div className="agent-intro">
            <h3>Your library, organized for you</h3>
            <p>Ask in plain words. The agent searches, tags, sorts and tidies your Trove using your own {engine === 'codex' ? 'ChatGPT' : 'Claude'} subscription, running on this computer.</p>
            {h && !ready && <EngineHint engine={engine} health={h} onRetry={() => check(bridge, true)} />}
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.label} className="preset" onClick={() => send(p.prompt)} disabled={!ready}>
                  {p.icon}
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="agent-thread" aria-live="polite">
            {turns.map((t, i) =>
              t.role === 'user' ? (
                <div key={i} className="msg-user">{t.text}</div>
              ) : (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {t.steps.length > 0 && (
                    <div className="msg-steps">
                      {t.steps.slice(-6).map((s, j) => (
                        <div key={j} className="msg-step"><span aria-hidden="true">›</span><span>{s}</span></div>
                      ))}
                      {t.steps.length > 6 && <div className="msg-step"><span>{t.steps.length - 6} earlier steps</span></div>}
                    </div>
                  )}
                  {t.text.map((x, j) => <Markdown key={j} text={x} onOpen={onOpen} />)}
                  {t.error && <div className="msg-error" role="alert" style={{ whiteSpace: 'pre-wrap' }}>{t.error}</div>}
                  {t.running && (
                    <div className="agent-status"><span className="spinner" style={{ width: 12, height: 12 }} /> {t.status || (t.steps.length ? 'Working…' : 'Thinking…')}</div>
                  )}
                  {!t.running && t.text.length > 0 && (
                    <div>
                      <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(t.text.join('\n\n'))}>
                        <Copy size={13} /> Copy
                      </button>
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {health !== null && (
        <div className="composer">
          <div className="composer-box">
            <textarea
              ref={inputRef}
              value={text}
              rows={2}
              placeholder={ready || health === 'checking' ? 'Ask about your library, or tell the agent what to organize' : 'Sign in to an engine to start'}
              aria-label="Message the agent"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
            <div className="composer-row">
              <div className="seg text" role="group" aria-label="Engine">
                {(['claude', 'codex'] as const).map((e) => (
                  <button key={e} className={engine === e ? 'on' : ''} aria-pressed={engine === e} onClick={() => pickEngine(e)} disabled={running} title={h && !h.engines[e]?.loggedIn ? `${ENGINE_NAME[e]} is not signed in` : undefined}>
                    {ENGINE_NAME[e]}
                  </button>
                ))}
              </div>
              <span className="spacer" />
              {running ? (
                <button className="btn sm" onClick={stop}>
                  <Square size={11} fill="currentColor" /> Stop
                </button>
              ) : (
                <button className="btn primary sm" onClick={() => send(text)} disabled={!text.trim() || !ready} aria-label="Send">
                  <ArrowUp size={15} /> Send
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function EngineHint({ engine, health, onRetry }: { engine: Engine; health: Health; onRetry: () => void }) {
  const s = health.engines[engine];
  return (
    <div className="agent-setup" style={{ marginBottom: 16 }}>
      <p>{s.installed ? `${ENGINE_NAME[engine]} is installed but not signed in. Sign in with your subscription in a terminal, then check again. You can also switch engine below.` : `${ENGINE_NAME[engine]} isn’t installed on this computer. Install it and sign in, or switch engine below.`}</p>
      <CodeBox>{engine === 'claude' ? (s.installed ? 'claude auth login' : 'npm install -g @anthropic-ai/claude-code\nclaude auth login') : s.installed ? 'codex login' : 'npm install -g @openai/codex\ncodex login'}</CodeBox>
      <div>
        <button className="btn sm" onClick={onRetry}><RefreshCw size={13} /> Check again</button>
      </div>
    </div>
  );
}

function Setup({ bridge, onRetry }: { bridge: string; onRetry: () => void }) {
  return (
    <div className="agent-setup">
      <h3>Connect the agent on this computer</h3>
      <p>The agent runs locally with your Claude or ChatGPT subscription, so no API keys are needed. Set it up once:</p>
      <ol>
        <li>
          Install the Trove CLI and sign in with an API key from Settings.
          <CodeBox>{'npm install -g github:medpar/trove\ntrove login --key <your key>'}</CodeBox>
        </li>
        <li>
          Sign in to Claude Code or Codex with your subscription.
          <CodeBox>{'claude auth login    # Claude Pro or Max\ncodex login          # ChatGPT Plus or Pro'}</CodeBox>
        </li>
        <li>
          Start the agent. On a Mac, <code>install</code> keeps it running in the background.
          <CodeBox>{'trove agent install   # or: trove agent serve'}</CodeBox>
        </li>
      </ol>
      <p className="field-hint" style={{ margin: 0 }}>Looking for it at {bridge}. Your browser may ask to allow access to apps on this device.</p>
      <div>
        <button className="btn" onClick={onRetry}>
          <RefreshCw size={14} /> Check again
        </button>
      </div>
    </div>
  );
}
