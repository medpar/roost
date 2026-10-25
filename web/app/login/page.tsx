'use client';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';

export default function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (res.ok) {
      const next = new URLSearchParams(location.search).get('next') || '/';
      location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } else {
      setErr((await res.json().catch(() => ({}))).error || 'Something went wrong');
      setBusy(false);
    }
  };
  return (
    <main className="center-page">
      <form className="login" onSubmit={submit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/logo.svg" alt="" width={44} height={44} />
        <h1 className="word">
          Tro<em>v</em>e
        </h1>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.5, marginTop: -4 }}>Save anything, keep everything. Your personal library, archived in Notion.</p>
        <input className="input" style={{ height: 44, fontSize: 15 }} type="password" placeholder="Password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
        {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}
        <button className="btn primary" style={{ height: 44, justifyContent: 'center', fontSize: 14 }} disabled={busy || !pw}>
          {busy ? <span className="spinner" /> : <>Enter <ArrowRight size={16} /></>}
        </button>
      </form>
    </main>
  );
}
