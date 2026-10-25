import { guarded, json } from '@/lib/auth';
import { readBody } from '@/lib/input';
import { renameFacet } from '@/lib/store';

export const maxDuration = 60;

/** PATCH /api/facets {kind:'collection'|'tag', from, to}  rename or merge (to = existing name). to = '' removes it. */
export const PATCH = guarded(async (req) => {
  const { kind, from, to } = await readBody(req);
  if (!['collection', 'tag'].includes(kind) || !from) return json({ error: 'kind and from are required' }, { status: 400 });
  return json(await renameFacet(kind, String(from), String(to ?? '')));
});
