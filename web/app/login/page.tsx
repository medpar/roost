'use client';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';

export default function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return setErr('Enter your password.');
    setBusy(true);
    setErr('');
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (res.ok) {
      const next = new URLSearchParams(location.search).get('next') || '/';
      location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } else {
      setErr((await res.json().catch(() => ({}))).error || 'That didn’t work. Check the password and try again.');
      setBusy(false);
    }
  };
  return (
    <main className="center-page">
      <form className="login" onSubmit={submit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/logo.svg" alt="" width={36} height={36} style={{ borderRadius: 9 }} />
        <h1>Sign in to Trove</h1>
        <p>Your personal library, archived in Notion.</p>
        <label className="sr" htmlFor="pw">Password</label>
        <input id="pw" className="input" type="password" placeholder="Password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!err} aria-describedby={err ? 'pw-error' : undefined} />
        {err && <p id="pw-error" className="form-error">{err}</p>}
        <button className="btn primary lg" disabled={busy}>
          {busy ? <span className="spinner" aria-label="Signing in" /> : <>Continue <ArrowRight size={16} /></>}
        </button>
      </form>
    </main>
  );
}
