import { guarded, json } from '@/lib/auth';
import { readBody } from '@/lib/input';
import { addHighlight, invalidateStats } from '@/lib/store';

/** POST /api/items/:id/highlights  {text, note?} */
export const POST = guarded<{ params: Promise<{ id: string }> }>(async (req, _who, { params }) => {
  const { id } = await params;
  const body = await readBody(req);
  if (!body.text?.trim()) return json({ error: 'text is required' }, { status: 400 });
  const item = await addHighlight(id, String(body.text), body.note ? String(body.note) : undefined);
  invalidateStats();
  return json({ item });
});
