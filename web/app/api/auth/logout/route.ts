import { json, SESSION_COOKIE } from '@/lib/auth';

export async function POST() {
  const res = json({ ok: true });
  res.headers.append('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res;
}
