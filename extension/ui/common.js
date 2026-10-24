export async function send(cmd, data = {}) {
  const res = await chrome.runtime.sendMessage({ cmd, ...data });
  if (!res?.ok) {
    const err = new Error(res?.error || 'Unknown error');
    err.code = res?.code;
    throw err;
  }
  return res;
}

export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function until(ts) {
  const s = Math.max(0, Math.round((ts - Date.now()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export const fmt = (n) => (n ?? 0).toLocaleString('en-US');

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** Human message for an error code coming from the service worker. */
export function explain(err) {
  const map = {
    not_logged_in: 'Log in to x.com in this browser.',
    setup_needed: 'Connect your Notion database in Settings.',
    auth: 'X rejected the request. Open x.com once, then retry.',
    rate_limited: 'X rate limit reached — Roost will continue automatically.',
  };
  return map[err?.code] || err?.msg || err?.message || String(err);
}
