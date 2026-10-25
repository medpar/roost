import { openapi } from '@/lib/openapi';

export async function GET(req: Request) {
  const base = process.env.TROVE_PUBLIC_URL || new URL(req.url).origin;
  return Response.json(openapi(base.replace(/\/$/, '')), { headers: { 'access-control-allow-origin': '*' } });
}
