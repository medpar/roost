'use client';
import { ArrowLeft, Bot, Check, Copy, Download, Eye, EyeOff, Globe, Link2, LogOut, MonitorSmartphone, Puzzle, Smartphone, Upload, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { api, refreshAll } from '@/components/api';
import { useToast } from '@/components/ui';

type Me = { publicUrl: string; notion: { library: string; x: string }; apiKeys: { name: string; key: string }[]; cron: boolean };

function Code({ children }: { children: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="codebox">
      {children}
      <button
        className="icon-btn"
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard.writeText(children);
          setOk(true);
          setTimeout(() => setOk(false), 1400);
        }}
      >
        {ok ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

// ---------- import parsers ----------

type Row = { url: string; title?: string; collection?: string; tags?: string[]; note?: string };

function parseNetscape(html: string): Row[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: Row[] = [];
  const skip = /^(bookmarks bar|bookmarks toolbar|barra de marcadores|favorites bar|other bookmarks|otros marcadores|mobile bookmarks|bookmarks menu)$/i;
  const walk = (dl: Element, path: string[]) => {
    for (const dt of Array.from(dl.children)) {
      if (dt.tagName !== 'DT') continue;
      const a = dt.querySelector(':scope > a');
      const h3 = dt.querySelector(':scope > h3');
      if (a) {
        const url = a.getAttribute('href') || '';
        if (/^https?:/.test(url)) out.push({ url, title: a.textContent?.trim(), collection: path.join('/') || undefined, tags: (a.getAttribute('tags') || '').split(',').map((s) => s.trim()).filter(Boolean) });
      } else if (h3) {
        const sub = dt.querySelector(':scope > dl');
        const name = h3.textContent?.trim() || '';
        if (sub) walk(sub, skip.test(name) ? path : [...path, name]);
      }
    }
  };
  const root = doc.querySelector('dl');
  if (root) walk(root, []);
  return out;
}

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      cur.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(cell);
      rows.push(cur);
      cur = [];
      cell = '';
    } else cell += c;
  }
  if (cell || cur.length) rows.push([...cur, cell]);
  const [head, ...body] = rows.filter((r) => r.some(Boolean));
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const u = idx(['url', 'link', 'href']);
  const t = idx(['title', 'name']);
  const f = idx(['folder', 'collection']);
  const g = idx(['tags']);
  const n = idx(['note', 'notes', 'description', 'excerpt']);
  return body
    .map((r) => ({ url: r[u], title: r[t], collection: r[f] || undefined, tags: (r[g] || '').split(/[,|]/).map((s) => s.trim()).filter(Boolean), note: r[n] || undefined }))
    .filter((r) => /^https?:/.test(r.url || ''));
}

function parseFile(name: string, text: string): Row[] {
  if (/\.html?$/i.test(name) || /<!DOCTYPE NETSCAPE/i.test(text)) return parseNetscape(text);
  if (/\.csv$/i.test(name)) return parseCsv(text);
  if (/\.json$/i.test(name)) {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j : j.items || [];
    return list.map((x: any) => ({ url: x.url || x.link, title: x.title, collection: x.collection || x.folder, tags: x.tags, note: x.note })).filter((r: Row) => /^https?:/.test(r.url || ''));
  }
  return (text.match(/https?:\/\/[^\s<>"']+/g) || []).map((url) => ({ url }));
}

// ---------- page ----------

export default function SettingsView() {
  const { data: me } = useSWR<Me>('/api/me', (u: string) => api(u));
  const toast = useToast();
  const [reveal, setReveal] = useState<string | null>(null);
  const [imp, setImp] = useState<{ total: number; done: number; saved: number; errors: number; running: boolean } | null>(null);
  const [quick, setQuick] = useState(true);
  const [health, setHealth] = useState<string>('');
  const bookmarklet = useRef<HTMLAnchorElement>(null);
  const base = me?.publicUrl || (typeof location !== 'undefined' ? location.origin : '');
  const key = me?.apiKeys.find((k) => /agent|claude/i.test(k.name)) || me?.apiKeys[0];
  const keyFor = (n: RegExp) => me?.apiKeys.find((k) => n.test(k.name)) || key;
  const mask = (k?: string) => (k ? `${k.slice(0, 6)}…${k.slice(-4)}` : '');

  useEffect(() => {
    // React blocks javascript: URLs in JSX, so set the bookmarklet's href directly.
    const code = `javascript:(()=>{const s=getSelection().toString();open('${base}/save?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+(s?'&highlight='+encodeURIComponent(s):'')+'&source=Bookmarklet','trove','width=460,height=600')})()`;
    bookmarklet.current?.setAttribute('href', code);
  }, [base]);

  const runImport = async (file: File) => {
    const rows = parseFile(file.name, await file.text());
    if (!rows.length) return toast.push({ text: 'No links found in that file' });
    setImp({ total: rows.length, done: 0, saved: 0, errors: 0, running: true });
    for (let i = 0; i < rows.length; i += 10) {
      const batch = rows.slice(i, i + 10).map((r) => ({ ...r, source: 'Import', archive: quick ? false : undefined }));
      try {
        const r = await api<{ results: any[] }>('/api/items', { method: 'POST', json: { items: batch } });
        const saved = r.results.filter((x) => x.created).length;
        const errors = r.results.filter((x) => x.error).length;
        setImp((s) => s && { ...s, done: s.done + batch.length, saved: s.saved + saved, errors: s.errors + errors });
      } catch {
        setImp((s) => s && { ...s, done: s.done + batch.length, errors: s.errors + batch.length });
      }
    }
    setImp((s) => s && { ...s, running: false });
    refreshAll();
  };

  const mcpUrl = `${base}/api/mcp`;
  const claudeKey = keyFor(/claude/i)?.key || '<api key>';
  const hermesKey = keyFor(/hermes/i)?.key || '<api key>';

  return (
    <div className="settings">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <a className="btn ghost" href="/">
          <ArrowLeft size={16} /> Library
        </a>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }}>
          <LogOut size={15} /> Sign out
        </button>
      </div>
      <div>
        <h1 className="page-title" style={{ fontSize: 48 }}>
          Settings <em>&amp;</em> integrations
        </h1>
        <p className="muted" style={{ marginTop: 10, fontSize: 15 }}>Save from every device and every assistant. Everything lands in your Notion databases.</p>
      </div>

      <section>
        <h2>Save from anywhere</h2>
        <div className="cards-2">
          <div className="mini-card">
            <h3><Puzzle size={17} /> Browser extension</h3>
            <p style={{ fontSize: 13 }}>Brave, Chrome, Edge, Arc on macOS, Windows and Linux. One-click save, right-click links/images, save selections as highlights, ✓ badge on saved pages, import + sync browser bookmarks, and your X bookmarks.</p>
            <a className="btn" href="https://github.com/medpar/trove/releases/latest" target="_blank" rel="noreferrer"><Download size={15} /> Download</a>
          </div>
          <div className="mini-card">
            <h3><Smartphone size={17} /> iPhone, iPad & Mac</h3>
            <p style={{ fontSize: 13 }}>Install the “Save to Trove” Shortcut. It appears in the Share sheet of every app (Safari, YouTube, X, Reddit…) and in the macOS Share menu. It asks for your API key once on install.</p>
            <a className="btn" href="/trove.shortcut"><Download size={15} /> Get the Shortcut</a>
          </div>
          <div className="mini-card">
            <h3><MonitorSmartphone size={17} /> Install the app</h3>
            <p style={{ fontSize: 13 }}>Install Trove from your browser (⋯ → Install / Add to Dock / Add to Home Screen). On Android, Windows and ChromeOS it then shows up in the system share sheet.</p>
          </div>
          <div className="mini-card">
            <h3><Link2 size={17} /> Bookmarklet</h3>
            <p style={{ fontSize: 13 }}>Any browser, any OS. Drag this to your bookmarks bar; selected text is saved as a highlight.</p>
            <a ref={bookmarklet} className="btn primary" onClick={(e) => e.preventDefault()} style={{ alignSelf: 'flex-start' }}>
              ＋ Save to Trove
            </a>
          </div>
        </div>
      </section>

      <section>
        <h2>AI agents & assistants</h2>
        <p>Any agent can save links or content to Trove and search your library: through the MCP server (best), the REST API, or the skill file. Each key records its name as “Via”, so you can see which assistant saved what.</p>
        <div className="field-label">API keys</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {me?.apiKeys.map((k) => (
            <div key={k.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }}>
              <Bot size={16} />
              <strong style={{ minWidth: 120 }}>{k.name}</strong>
              <code className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{reveal === k.name ? k.key : mask(k.key)}</code>
              <button className="icon-btn" aria-label="Reveal" onClick={() => setReveal(reveal === k.name ? null : k.name)}>{reveal === k.name ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              <button className="icon-btn" aria-label="Copy key" onClick={() => { navigator.clipboard.writeText(k.key); toast.push({ text: `${k.name} key copied` }); }}><Copy size={15} /></button>
            </div>
          ))}
          {!me && <div className="skeleton" style={{ height: 40 }} />}
        </div>
        <div className="field-label" style={{ marginTop: 6 }}>MCP server</div>
        <Code>{mcpUrl}</Code>
        <div className="field-label">Claude Code</div>
        <Code>{`claude mcp add --transport http --scope user trove ${mcpUrl} --header "Authorization: Bearer ${claudeKey}"`}</Code>
        <div className="field-label">Hermes Agent (~/.hermes/config.yaml)</div>
        <Code>{`mcp_servers:\n  trove:\n    url: ${mcpUrl}\n    headers:\n      Authorization: "Bearer ${hermesKey}"`}</Code>
        <div className="field-label">Claude Desktop, Cursor & other MCP clients</div>
        <Code>{JSON.stringify({ mcpServers: { trove: { url: mcpUrl, headers: { Authorization: `Bearer ${key?.key || '<api key>'}` } } } }, null, 2)}</Code>
        <div className="field-label">REST (any assistant, n8n, Zapier, scripts)</div>
        <Code>{`curl -X POST ${base}/api/items \\\n  -H "Authorization: Bearer ${key?.key || '<api key>'}" \\\n  -H "content-type: application/json" \\\n  -d '{"url":"https://example.com","tags":["ai"],"note":"why it matters"}'`}</Code>
        <p style={{ fontSize: 13 }}>
          Docs for agents: <a href="/llms.txt" style={{ color: 'var(--accent)' }}>/llms.txt</a> · OpenAPI: <a href="/openapi.json" style={{ color: 'var(--accent)' }}>/openapi.json</a> · Skill: <a href="https://github.com/medpar/trove/tree/main/skills/trove" style={{ color: 'var(--accent)' }}>skills/trove/SKILL.md</a>
        </p>
      </section>

      <section>
        <h2>Import</h2>
        <p>Bring in browser bookmarks (HTML export from Brave/Chrome/Safari/Firefox), Raindrop or Pocket CSV, a Trove JSON export, or any text file with links. Folders become collections; duplicates are skipped automatically.</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} style={{ accentColor: 'var(--accent)' }} /> Quick import (metadata only — much faster for big imports)
        </label>
        <label className="btn" style={{ alignSelf: 'flex-start' }}>
          <Upload size={15} /> Choose file…
          <input type="file" accept=".html,.htm,.csv,.json,.txt" hidden onChange={(e) => e.target.files?.[0] && runImport(e.target.files[0])} />
        </label>
        {imp && (
          <div>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--hover)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(imp.done / imp.total) * 100}%`, background: 'var(--accent)', transition: 'width .3s' }} />
            </div>
            <p className="mono muted" style={{ marginTop: 6 }}>
              {imp.done}/{imp.total} processed · {imp.saved} new · {imp.errors} errors {imp.running ? '…' : '✓'}
            </p>
          </div>
        )}
      </section>

      <section>
        <h2>Export & backup</h2>
        <p>Your data already lives in Notion. Export a copy any time:</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['json', 'csv', 'html', 'txt'] as const).map((f) => (
            <a key={f} className="btn" href={`/api/export?format=${f}`}><Download size={15} /> {f.toUpperCase()}</a>
          ))}
        </div>
      </section>

      <section>
        <h2>Library health</h2>
        <p>A daily job checks saved links and flags broken ones (their archived copy stays readable in Trove and Notion).</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="btn"
            onClick={async () => {
              setHealth('Checking…');
              try {
                const r = await api<{ checked: number; broken: number }>('/api/cron/links?limit=60');
                setHealth(`Checked ${r.checked} links · ${r.broken} broken`);
                refreshAll();
              } catch (e: any) {
                setHealth(e.message);
              }
            }}
          >
            <Wrench size={15} /> Check links now
          </button>
          <span className="muted">{health}</span>
        </div>
      </section>

      <section>
        <h2>Notion</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {me?.notion.library && <a className="btn" href={me.notion.library} target="_blank" rel="noreferrer"><Globe size={15} /> Trove library database</a>}
          {me?.notion.x && <a className="btn" href={me.notion.x} target="_blank" rel="noreferrer"><Globe size={15} /> X Bookmarks database</a>}
        </div>
      </section>
    </div>
  );
}
