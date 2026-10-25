import { guarded, json } from '@/lib/auth';
import { stats } from '@/lib/store';

export const maxDuration = 60;

/** GET /api/stats -> counts for the sidebar: collections, tags, types, platforms, filters */
export const GET = guarded(async (req) => {
  const fresh = new URL(req.url).searchParams.has('fresh');
  return json(await stats({ fresh }));
});
