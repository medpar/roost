import { caller, json, unauthorized } from '@/lib/auth';
import { env } from '@/lib/env';
import { checkLinks } from '@/lib/store';

export const maxDuration = 300;

/** Daily broken-link check (Vercel Cron sends Authorization: Bearer $CRON_SECRET). */
export async function GET(req: Request) {
  const cron = env().cronSecret && req.headers.get('authorization') === `Bearer ${env().cronSecret}`;
  if (!cron && !caller(req)) return unauthorized();
  return json(await checkLinks(Number(new URL(req.url).searchParams.get('limit')) || 100));
}
