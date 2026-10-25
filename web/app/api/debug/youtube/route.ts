import { guarded, json } from '@/lib/auth';

export const maxDuration = 60;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** Diagnostics: what does YouTube return to this server? (auth required) */
export const GET = guarded(async (req) => {
  const id = new URL(req.url).searchParams.get('id') || 'aircAruvnKk';
  const out: Record<string, unknown> = {};
  const probe = async (name: string, fn: () => Promise<Response>, parse: (t: string) => unknown) => {
    try {
      const r = await fn();
      const t = await r.text();
      out[name] = { status: r.status, len: t.length, ...((parse(t) as object) || {}) };
    } catch (e: any) {
      out[name] = { error: e.message };
    }
  };
  const page = (t: string) => {
    const m = /ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script)/s.exec(t);
    let p: any = null;
    try { p = m ? JSON.parse(m[1]) : null; } catch {}
    return { player: !!p, playability: p?.playabilityStatus?.status, details: !!p?.videoDetails, len: p?.videoDetails?.lengthSeconds, captions: (p?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).length, consent: /consent\.youtube|before you continue/i.test(t) };
  };
  const player = (t: string) => {
    let p: any = null;
    try { p = JSON.parse(t); } catch {}
    return { playability: p?.playabilityStatus?.status, reason: p?.playabilityStatus?.reason?.slice?.(0, 80), details: !!p?.videoDetails, len: p?.videoDetails?.lengthSeconds, desc: (p?.videoDetails?.shortDescription || '').length, captions: (p?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).length };
  };
  await probe('watch', () => fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1; SOCS=CAI' } }), page);
  await probe('mweb', () => fetch(`https://m.youtube.com/watch?v=${id}&hl=en`, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', cookie: 'CONSENT=YES+1; SOCS=CAI' } }), page);
  const clients: Record<string, any> = {
    ANDROID: { clientName: 'ANDROID', clientVersion: '19.44.38', androidSdkVersion: 34 },
    IOS: { clientName: 'IOS', clientVersion: '19.45.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83' },
    WEB: { clientName: 'WEB', clientVersion: '2.20251020.01.00' },
    MWEB: { clientName: 'MWEB', clientVersion: '2.20251020.01.00' },
    TVEMBED: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0' },
    WEB_EMBEDDED: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20251020.01.00' },
    TV: { clientName: 'TVHTML5', clientVersion: '7.20251020.10.00' },
  };
  for (const [name, client] of Object.entries(clients)) {
    await probe(`innertube_${name}`, () =>
      fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': UA },
        body: JSON.stringify({ context: { client: { ...client, hl: 'en' }, ...(name.includes('EMBED') ? { thirdParty: { embedUrl: 'https://www.google.com/' } } : {}) }, videoId: id }),
      }), player);
  }
  await probe('next_WEB', () =>
    fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20251020.01.00', hl: 'en' } }, videoId: id }) }),
    (t) => ({ hasDescription: /attributedDescription|description/.test(t), title: /videoPrimaryInfoRenderer/.test(t) }));
  await probe('timedtext', () => fetch(`https://www.youtube.com/api/timedtext?v=${id}&lang=en&fmt=json3`, { headers: { 'user-agent': UA } }), (t) => ({ events: (t.match(/"tStartMs"/g) || []).length }));
  return json(out);
});
