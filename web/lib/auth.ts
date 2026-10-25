// Auth: a signed session cookie for the web app, named API keys for agents and integrations.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export const SESSION_COOKIE = 'trove_session';
export const SESSION_DAYS = 120;

const hmac = (v: string, secret: string) => createHmac('sha256', secret).update(v).digest('base64url');

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signSession(secret = env().sessionSecret) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${exp}.${hmac(String(exp), secret)}`;
}

export function verifySession(value: string | undefined | null, secret = env().sessionSecret) {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, hmac(exp, secret));
}

export function checkPassword(pw: string) {
  const want = env().password;
  return !!want && safeEqual(hmac(pw, 'pw'), hmac(want, 'pw'));
}

export function apiKeyName(token: string | null | undefined): string | null {
  if (!token) return null;
  for (const k of env().apiKeys) if (safeEqual(hmac(token, 'k'), hmac(k.key, 'k'))) return k.name;
  return null;
}

function cookieValue(header: string | null, name: string) {
  return header?.split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1) || null;
}

export type Caller = { kind: 'session' | 'key'; via: string };

/** Who is calling? Session cookie (web app, extension popup), or an API key (agents, Shortcuts, extension). */
export function caller(req: Request): Caller | null {
  const auth = req.headers.get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const key = bearer || req.headers.get('x-api-key') || new URL(req.url).searchParams.get('key');
  const name = apiKeyName(key);
  if (name) return { kind: 'key', via: name };
  if (verifySession(cookieValue(req.headers.get('cookie'), SESSION_COOKIE))) return { kind: 'session', via: '' };
  return null;
}

export const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, { ...init, headers: { 'cache-control': 'no-store', ...(init.headers || {}) } });

export const unauthorized = () => json({ error: 'Unauthorized: sign in or pass Authorization: Bearer <api key>' }, { status: 401, headers: { 'www-authenticate': 'Bearer realm="trove"' } });

/** Wrap a route handler with auth + JSON error handling. */
export function guarded<C>(handler: (req: Request, who: Caller, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    const who = caller(req);
    if (!who) return unauthorized();
    try {
      return await handler(req, who, ctx);
    } catch (e: any) {
      const status = e?.status && e.status >= 400 && e.status < 600 ? (e.status === 401 ? 502 : e.status) : 500;
      return json({ error: e?.message || String(e) }, { status });
    }
  };
}
