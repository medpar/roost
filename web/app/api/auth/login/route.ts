import { checkPassword, json, SESSION_COOKIE, SESSION_DAYS, signSession } from '@/lib/auth';

const attempts = new Map<string, { n: number; at: number }>();

/** POST /api/auth/login {password} -> session cookie */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const a = attempts.get(ip);
  if (a && a.n >= 8 && Date.now() - a.at < 10 * 60 * 1000) return json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  if (!checkPassword(String(body.password || ''))) {
    attempts.set(ip, { n: (a?.n || 0) + 1, at: Date.now() });
    await new Promise((r) => setTimeout(r, 600));
    return json({ error: 'Wrong password' }, { status: 401 });
  }
  attempts.delete(ip);
  const res = json({ ok: true });
  res.headers.append('set-cookie', `${SESSION_COOKIE}=${signSession()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  return res;
}
