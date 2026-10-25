// Client for the Trove web app API (everything that isn't an X post goes there).

import { getSettings } from './store.js';

export class TroveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(path, { method = 'GET', body } = {}) {
  const { troveUrl, troveKey } = await getSettings();
  if (!troveUrl || !troveKey) throw new TroveError(0, 'Connect Trove (URL + API key) in the extension settings');
  const res = await fetch(troveUrl.replace(/\/$/, '') + path, {
    method,
    headers: { authorization: `Bearer ${troveKey}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new TroveError(res.status, data.error || `Trove ${res.status}`);
  return data;
}

export const health = () => call('/api/health');
export const save = (payload) => call('/api/items', { method: 'POST', body: { source: 'Extension', ...payload } });
export const saveMany = (items) => call('/api/items', { method: 'POST', body: { items: items.map((i) => ({ source: 'Extension', ...i })) } });
export const list = (q, limit = 30) => call(`/api/items?q=${encodeURIComponent(q)}&limit=${limit}`);
export const enrich = (id, body) => call(`/api/items/${id}/enrich`, { method: 'POST', body });
export const update = (id, patch) => call(`/api/items/${id}`, { method: 'PATCH', body: patch });
export async function lookup(url) {
  const r = await call(`/api/lookup?url=${encodeURIComponent(url)}`);
  return r.results?.[url] || null;
}

/** Runs inside the page: grab metadata + readable HTML so logged-in/paywalled pages can be archived. */
export function captureFromPage() {
  const meta = (...names) => {
    for (const n of names) {
      const v = document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content;
      if (v) return v.trim();
    }
    return '';
  };
  const main = document.querySelector('article') || document.querySelector('main') || document.body;
  let html = '';
  try {
    html = '<html><head><title>' + document.title.replace(/</g, '&lt;') + '</title></head><body>' + (main?.outerHTML || '') + '</body></html>';
    if (html.length > 1_500_000) html = html.slice(0, 1_500_000);
  } catch { /* ignore */ }
  return {
    url: location.href,
    selection: String(getSelection() || '').trim().slice(0, 4000),
    meta: {
      title: meta('og:title', 'twitter:title') || document.title,
      description: meta('og:description', 'description', 'twitter:description'),
      image: meta('og:image', 'twitter:image'),
      author: meta('author', 'article:author'),
      published: meta('article:published_time', 'datePublished'),
      siteName: meta('og:site_name'),
      lang: document.documentElement.lang || '',
      html,
    },
  };
}
