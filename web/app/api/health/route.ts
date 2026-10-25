import { caller, json } from '@/lib/auth';

/** GET /api/health -> liveness + whether the caller is authenticated (used by the extension to test its key). */
export async function GET(req: Request) {
  const who = caller(req);
  return json({ ok: true, app: 'trove', authenticated: !!who, via: who?.via || null });
}
