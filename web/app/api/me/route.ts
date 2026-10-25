import { caller, json, unauthorized } from '@/lib/auth';
import { env } from '@/lib/env';

const notionUrl = (id: string) => (id ? `https://www.notion.so/${id.replace(/-/g, '')}` : '');

/** GET /api/me -> settings for the web app (session only: includes API keys for wiring up agents). */
export async function GET(req: Request) {
  const who = caller(req);
  if (!who) return unauthorized();
  const e = env();
  return json({
    publicUrl: e.publicUrl,
    notion: { library: notionUrl(e.libraryDb) },
    apiKeys: who.kind === 'session' ? e.apiKeys : e.apiKeys.filter((k) => k.name === who.via).map((k) => ({ name: k.name, key: '' })),
    cron: !!e.cronSecret,
  });
}
