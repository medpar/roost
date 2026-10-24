// Minimal Notion REST client: global rate limiting (~3 req/s), retries with
// backoff, and server-side media import (Notion fetches the file itself, so the
// extension never downloads media). Works in the extension and in Node 18+.

import { sleep } from './util.js';

export const NOTION_VERSION = '2026-03-11';
const BASE = 'https://api.notion.com/v1';

export class NotionError extends Error {
  constructor(status, code, message) {
    super(`Notion ${status} ${code || ''}: ${message || ''}`.trim());
    this.status = status;
    this.code = code;
  }
}

export class Notion {
  constructor(token, { rps = 2.8, fetchImpl } = {}) {
    if (!token) throw new NotionError(401, 'no_token', 'Missing Notion token');
    this.token = token;
    this.gap = 1000 / rps;
    this.next = 0;
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  async slot() {
    const now = Date.now();
    const wait = Math.max(0, this.next - now);
    this.next = Math.max(now, this.next) + this.gap;
    if (wait) await sleep(wait);
  }

  async req(method, path, body, { query, retries = 6, create = false } = {}) {
    let url = BASE + path;
    if (query) url += '?' + new URLSearchParams(query).toString();
    for (let attempt = 0; ; attempt++) {
      await this.slot();
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (create || attempt >= retries) throw new NotionError(0, 'network', e.message);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.ok) return res.status === 204 ? null : res.json();
      const err = await res.json().catch(() => ({}));
      // Creating is not idempotent: only retry when Notion certainly did not process it.
      const retryable = create ? [409, 429, 503, 529].includes(res.status) : res.status === 429 || res.status === 409 || res.status >= 500;
      if (retryable && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30000, 800 * 2 ** attempt));
        continue;
      }
      throw new NotionError(res.status, err.code, err.message);
    }
  }

  me() {
    return this.req('GET', '/users/me');
  }

  search(query = '', filter) {
    const body = { page_size: 50 };
    if (query) body.query = query;
    if (filter) body.filter = { property: 'object', value: filter };
    return this.req('POST', '/search', body);
  }

  getDatabase(id) {
    return this.req('GET', `/databases/${id}`);
  }

  getDataSource(id) {
    return this.req('GET', `/data_sources/${id}`);
  }

  updateDataSource(id, body) {
    return this.req('PATCH', `/data_sources/${id}`, body);
  }

  query(dataSourceId, body = {}, filterProperties) {
    let path = `/data_sources/${dataSourceId}/query`;
    if (filterProperties?.length) path += '?' + filterProperties.map((p) => `filter_properties[]=${encodeURIComponent(p)}`).join('&');
    return this.req('POST', path, body);
  }

  /** Iterate every page of a data source query. */
  async *queryAll(dataSourceId, body = {}, filterProperties) {
    let cursor;
    do {
      const res = await this.query(dataSourceId, { page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) }, filterProperties);
      for (const r of res.results) yield r;
      cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
  }

  createPage(body, { create = true } = {}) {
    return this.req('POST', '/pages', body, { create });
  }

  updatePage(id, body) {
    return this.req('PATCH', `/pages/${id}`, body);
  }

  appendChildren(blockId, children) {
    return this.req('PATCH', `/blocks/${blockId}/children`, { children });
  }

  /** Ask Notion to fetch a public URL into a file upload. Returns the upload id. */
  async importUrl(url, filename) {
    const fu = await this.req('POST', '/file_uploads', { mode: 'external_url', external_url: url, filename });
    return fu.id;
  }

  /** Wait until imports finish. Returns Map(id -> true|false). */
  async waitUploads(ids, timeoutMs = 90000) {
    const done = new Map();
    const deadline = Date.now() + timeoutMs;
    let pending = [...ids];
    let delay = 1200;
    while (pending.length && Date.now() < deadline) {
      await sleep(delay);
      delay = Math.min(delay * 1.5, 6000);
      const next = [];
      for (const id of pending) {
        try {
          const fu = await this.req('GET', `/file_uploads/${id}`, null, { retries: 2 });
          if (fu.status === 'uploaded') done.set(id, true);
          else if (fu.status === 'failed' || fu.status === 'expired') done.set(id, false);
          else next.push(id);
        } catch {
          done.set(id, false);
        }
      }
      pending = next;
    }
    for (const id of pending) done.set(id, false);
    return done;
  }
}

/** Notion ids come as 32 hex chars or dashed UUIDs, possibly inside a URL. */
export function parseNotionId(input) {
  const m = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i.exec(String(input || ''));
  if (!m) return null;
  const hex = m[0].replace(/-/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
