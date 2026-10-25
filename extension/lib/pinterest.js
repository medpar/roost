// Pinterest saves: reads your boards and pins through pinterest.com's own web API with the session
// you are logged in with in this browser (no Pinterest API keys), and turns pins into Trove items.
// Every board becomes a sub-collection of "Pinterest".

import { PINTEREST_COLLECTION } from './schema.js';

const ORIGIN = 'https://www.pinterest.com';

export class PinterestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let rulesReady = null;

/** Requests from the service worker look like they come from pinterest.com itself. */
async function installHeaderRules() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [2],
    addRules: [
      {
        id: 2,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'set', value: ORIGIN },
            { header: 'referer', operation: 'set', value: `${ORIGIN}/` },
          ],
        },
        // Pinterest may redirect to a country host (es.pinterest.com), so match every subdomain.
        condition: { urlFilter: '||pinterest.com/resource/', tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] },
      },
    ],
  });
}

async function resource(name, options, sourceUrl = '/') {
  await (rulesReady ||= installHeaderRules().catch((e) => console.warn('[trove] pinterest header rule', e)));
  const q = `source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify({ options, context: {} }))}&_=${Date.now()}`;
  const res = await fetch(`${ORIGIN}/resource/${name}/get/?${q}`, {
    credentials: 'include',
    headers: { accept: 'application/json, text/javascript, */*; q=0.01', 'x-requested-with': 'XMLHttpRequest', 'x-pinterest-pws-handler': 'www/[username]/[slug].js' },
  });
  if (res.status === 401 || res.status === 403) throw new PinterestError('not_logged_in', 'Log in to pinterest.com in this browser so Trove can read your saves.');
  if (res.status === 429) throw new PinterestError('rate_limited', 'Pinterest is rate limiting requests. Trove will try again later.');
  let body;
  try {
    body = await res.json();
  } catch {
    throw new PinterestError('bad_response', `Pinterest answered ${res.status} with something unexpected.`);
  }
  const rr = body.resource_response || {};
  if (rr.status && rr.status !== 'success') throw new PinterestError(rr.error?.code || 'error', rr.error?.message || rr.message || `Pinterest ${name} failed`);
  return { data: rr.data, bookmark: rr.bookmark };
}

/** Username of the logged-in Pinterest account, or null. */
export async function me() {
  try {
    return (await resource('UserSettingsResource', {})).data?.username || null;
  } catch (e) {
    if (e.code === 'not_logged_in') return null;
    throw e;
  }
}

/** All boards you own or collaborate on (secret ones too), plus your "Quick saves". */
export async function boards(username) {
  const out = [];
  let bookmark;
  do {
    const r = await resource('BoardsResource', { username, page_size: 250, privacy_filter: 'all', sort: 'last_pinned_to', field_set_key: 'profile_grid_item', ...(bookmark ? { bookmarks: [bookmark] } : {}) }, `/${username}/`);
    out.push(...(r.data || []));
    bookmark = r.bookmark;
  } while (bookmark && bookmark !== '-end-');
  try {
    const quick = (await resource('BoardResource', { username, slug: '_quick_saves' }, `/${username}/_quick_saves/`)).data;
    if (quick?.id && !out.some((b) => b.id === quick.id)) out.push({ ...quick, quickSaves: true });
  } catch { /* no quick saves */ }
  return out.filter((b) => b.id && b.url);
}

/** Every pin on a board, oldest page last. */
export async function* pins(board) {
  let bookmark;
  do {
    const r = await resource('BoardFeedResource', { board_id: board.id, board_url: board.url, page_size: 250, field_set_key: 'react_grid_pin', currentFilter: -1, filter_section_pins: false, sort: 'default', layout: 'default', ...(bookmark ? { bookmarks: [bookmark] } : {}) }, board.url);
    for (const p of r.data || []) if (p?.type === 'pin' && p.id) yield p;
    bookmark = r.bookmark;
  } while (bookmark && bookmark !== '-end-');
}

export const boardCollection = (board) => `${PINTEREST_COLLECTION}/${board.quickSaves || /\/_quick_saves\/?$/.test(board.url) ? 'Quick saves' : (board.name || 'Board').replace(/\//g, '-').trim()}`.slice(0, 100);

const mp4Of = (list) => Object.values(list || {}).find((v) => /\.mp4(\?|$)/.test(v?.url || ''))?.url || null;

/** The Trove save request for a pin (the server archives the image and video into Notion). */
export function pinToItem(pin, board) {
  const video = mp4Of(pin.videos?.video_list) || mp4Of((pin.story_pin_data?.pages || []).flatMap((pg) => pg.blocks || []).find((b) => b.video)?.video?.video_list);
  const image = pin.images?.orig?.url || pin.images?.['736x']?.url || null;
  const description = (pin.description || '').trim();
  // Uploaded pins report "Uploaded by user" as their domain; only a real outbound link has one.
  const domain = pin.link && pin.domain && !/uploaded by/i.test(pin.domain) ? pin.domain : null;
  const title =
    (pin.title || pin.grid_title || '').trim() ||
    description.split('\n')[0].slice(0, 120) ||
    (pin.seo_alt_text || pin.auto_alt_text || '').trim().slice(0, 120) ||
    (domain ? `Pin from ${domain}` : `Pin on ${boardCollection(board).split('/').pop()}`);
  return {
    url: `${ORIGIN}/pin/${pin.id}/`,
    title,
    collection: boardCollection(board),
    source: 'Pinterest',
    type: video ? 'Video' : 'Image',
    meta: {
      title,
      description,
      image,
      author: pin.native_creator?.full_name || pin.native_creator?.username || pin.pinner?.full_name || '',
      published: pin.created_at || null,
      siteName: 'Pinterest',
      pin: { id: pin.id, link: pin.link || null, domain, board: board.name || null, video, color: pin.dominant_color || null },
    },
  };
}
