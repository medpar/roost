import { guarded, json } from '@/lib/auth';
import { lookup } from '@/lib/store';

/** GET /api/lookup?url=...&url=...  -> which URLs are already saved (extension badge, agents) */
export const GET = guarded(async (req) => {
  const urls = new URL(req.url).searchParams.getAll('url').filter(Boolean);
  return json({ results: await lookup(urls) });
});
