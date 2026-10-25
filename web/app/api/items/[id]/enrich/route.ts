import { guarded, json } from '@/lib/auth';
import { readBody } from '@/lib/input';
import { enrichYouTube, invalidateStats } from '@/lib/store';

export const maxDuration = 60;

/** POST /api/items/:id/enrich {youtube:{description,duration,published,author,transcript}} (sent by the extension) */
export const POST = guarded<{ params: Promise<{ id: string }> }>(async (req, _who, { params }) => {
  const { id } = await params;
  const body = await readBody(req);
  if (!body.youtube || typeof body.youtube !== 'object') return json({ error: 'youtube data required' }, { status: 400 });
  const item = await enrichYouTube(id, body.youtube);
  invalidateStats();
  return json({ item });
});
