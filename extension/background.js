// Roost service worker. Event-driven: it sleeps between alarms and only wakes
// for scheduled syncs, x.com bookmark actions, menu clicks and UI messages.

import * as X from './lib/x.js';
import * as Sync from './lib/sync.js';
import * as S from './lib/store.js';
import { Notion, parseNotionId } from './lib/notion.js';
import { createDatabase, createViews, ensureSchema, resolveDataSource } from './lib/schema.js';
import { tweetIdFromUrl } from './lib/util.js';

// ---------- listeners (registered synchronously at startup) ----------

let quickTimer = null;
X.installCapture({
  onBookmarkCreated: () => {
    // Bookmarked something on x.com: archive it a few seconds later.
    clearTimeout(quickTimer);
    quickTimer = setTimeout(() => Sync.syncNew('bookmarked').catch(() => {}), 4000);
  },
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  createMenus();
  const preconfigured = await boot();
  if (reason === 'install') chrome.runtime.openOptionsPage();
  if (preconfigured) kickoff();
  else resumeIfNeeded();
});

chrome.runtime.onStartup.addListener(() => boot().then(resumeIfNeeded));

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === 'sync') Sync.syncNew('scheduled').catch(notifyError);
  if (name === 'tick') resumeIfNeeded();
});

chrome.contextMenus.onClicked.addListener((info) => {
  const url = info.linkUrl && tweetIdFromUrl(info.linkUrl) ? info.linkUrl : info.pageUrl;
  manualSave(url);
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'save-current') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  manualSave(tab?.url);
});

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith('http')) chrome.tabs.create({ url: id });
  chrome.notifications.clear(id);
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  handle(msg)
    .then((r) => reply({ ok: true, ...(r || {}) }))
    .catch((e) => reply({ ok: false, error: e.message || String(e), code: e.code }));
  return true;
});

Sync.onActivity(updateBadge);
chrome.storage.onChanged.addListener((ch) => {
  if (ch.settings) ensureAlarms();
  if (ch.state && ch.state.newValue?.lastError?.t !== ch.state.oldValue?.lastError?.t) updateBadge();
});

// ---------- lifecycle ----------

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'roost-link',
      title: 'Save post to Notion (Roost)',
      contexts: ['link'],
      targetUrlPatterns: ['https://x.com/*/status/*', 'https://twitter.com/*/status/*'],
    });
    chrome.contextMenus.create({
      id: 'roost-page',
      title: 'Save this post to Notion (Roost)',
      contexts: ['page'],
      documentUrlPatterns: ['https://x.com/*/status/*'],
    });
  });
}

/** Load the optional git-ignored config.local.json (preconfigured token + database). */
async function loadLocalConfig() {
  const s = await S.getSettings();
  if (s.notionToken && s.dataSourceId) return false;
  try {
    const res = await fetch(chrome.runtime.getURL('config.local.json'));
    if (!res.ok) return false;
    const cfg = await res.json();
    const keys = ['notionToken', 'databaseId', 'dataSourceId', 'databaseUrl', 'databaseTitle'];
    const patch = Object.fromEntries(keys.filter((k) => cfg[k]).map((k) => [k, cfg[k]]));
    if (!patch.notionToken || !patch.dataSourceId) return false;
    await S.setSettings(patch);
    await S.log('info', 'Loaded preconfigured Notion connection from config.local.json');
    return true;
  } catch {
    return false;
  }
}

async function boot() {
  const pre = await loadLocalConfig();
  await ensureAlarms();
  await X.installHeaderRules().catch(() => {});
  updateBadge();
  return pre;
}

async function ensureAlarms() {
  const { intervalMin } = await S.getSettings();
  const a = await chrome.alarms.get('sync');
  if (!a || a.periodInMinutes !== intervalMin) await chrome.alarms.create('sync', { periodInMinutes: intervalMin, delayInMinutes: Math.min(2, intervalMin) });
  const { backfill } = await S.getState();
  if (['running', 'paused', 'error'].includes(backfill.status)) await chrome.alarms.create('tick', { periodInMinutes: 1 });
}

/** First run after Notion is connected: learn what is already archived, then archive everything. */
async function kickoff() {
  try {
    await Sync.rebuildIndex();
    await chrome.alarms.create('tick', { periodInMinutes: 1 });
    await Sync.backfill();
  } catch (e) {
    notifyError(e);
  }
}

async function resumeIfNeeded() {
  const { backfill } = await S.getState();
  if (!['running', 'paused', 'error'].includes(backfill.status)) {
    chrome.alarms.clear('tick');
    return;
  }
  if (Sync.currentJob()) return;
  if (backfill.pausedUntil && backfill.pausedUntil > Date.now()) return;
  Sync.backfill().catch(notifyError);
}

// ---------- UI feedback ----------

async function updateBadge() {
  const job = Sync.currentJob();
  const st = await S.getState();
  let text = '';
  let color = '#6b7280';
  if (job) text = '…';
  else if (st.lastError && Date.now() - st.lastError.t < 6 * 3600 * 1000) {
    text = '!';
    color = '#dc2626';
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function notify(id, title, message) {
  chrome.notifications.create(id || '', { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 0 });
}

const ACTIONABLE = {
  not_logged_in: 'Log in to x.com in this browser so Roost can read your bookmarks.',
  setup_needed: 'Open Roost settings to connect your Notion database.',
  auth: 'X rejected the request. Open x.com once (Roost learns the request format from it).',
};

async function notifyError(e) {
  const { notify: on } = await S.getSettings();
  const code = e?.code || (e?.status === 401 ? 'notion_auth' : e?.status === 404 ? 'notion_404' : null);
  const msg =
    ACTIONABLE[code] ||
    (code === 'notion_auth' ? 'Notion token was rejected. Update it in Roost settings.' : code === 'notion_404' ? 'Notion database not found or not shared with the integration.' : null);
  if (!on || !msg) return;
  const st = await S.getState();
  const last = st.notified?.[code] || 0;
  if (Date.now() - last < 6 * 3600 * 1000) return;
  await S.updateState((s) => ({ ...s, notified: { ...(s.notified || {}), [code]: Date.now() } }));
  notify(`err-${code}`, 'Roost needs attention', msg);
}

async function manualSave(url) {
  if (!tweetIdFromUrl(url)) {
    notify('', 'Roost', 'Open a post on x.com (or right-click a post link) to save it.');
    return { status: 'invalid' };
  }
  chrome.action.setBadgeText({ text: '…' });
  try {
    const r = await Sync.saveFromUrl(url);
    const { recent } = await S.getState();
    const page = recent.find((x) => x.id === r.id);
    if (r.status === 'saved') notify(page?.url || '', 'Saved to Notion ✓', r.title || 'Post archived');
    else if (r.status === 'exists') notify('', 'Already in Notion', 'This post is archived already; its thread will be refreshed if it has one.');
    return r;
  } catch (e) {
    notify('', 'Could not save post', e.message || String(e));
    notifyError(e);
    throw e;
  } finally {
    updateBadge();
  }
}

// ---------- messages from popup / options ----------

async function handle(msg) {
  switch (msg.cmd) {
    case 'status': {
      const settings = await S.getSettings();
      return {
        settings: { ...settings, notionToken: settings.notionToken ? '•••' + settings.notionToken.slice(-4) : '' },
        hasToken: !!settings.notionToken,
        state: await S.getState(),
        job: Sync.currentJob(),
        capture: await X.captureStatus(),
        loggedIn: await X.isLoggedIn(),
      };
    }
    case 'sync':
      return Sync.syncNew('manual');
    case 'backfill': {
      await chrome.alarms.create('tick', { periodInMinutes: 1 });
      Sync.backfill({ restart: !!msg.restart }).catch(notifyError);
      return {};
    }
    case 'stopBackfill':
      await Sync.stopBackfill();
      return {};
    case 'saveUrl':
      return manualSave(msg.url);
    case 'rebuildIndex':
      return Sync.rebuildIndex();
    case 'captureNow':
      return { captured: await X.captureViaTab(msg.op || 'Bookmarks', null, { force: true }) };
    case 'resetCapture':
      await X.resetCapture();
      return {};
    case 'saveSettings': {
      const patch = { ...msg.patch };
      delete patch.notionToken;
      delete patch.dataSourceId;
      delete patch.databaseId;
      return { settings: await S.setSettings(patch) };
    }
    case 'testNotion': {
      const token = msg.token || (await S.getSettings()).notionToken;
      const me = await new Notion(token).me();
      return { workspace: me.bot?.workspace_name, bot: me.name, maxUpload: me.bot?.workspace_limits?.max_file_upload_size_in_bytes };
    }
    case 'listParents': {
      const token = msg.token || (await S.getSettings()).notionToken;
      const res = await new Notion(token).search(msg.query || '', 'page');
      return {
        pages: res.results.map((p) => ({
          id: p.id,
          title: Object.values(p.properties || {}).find((v) => v.type === 'title')?.title?.map((t) => t.plain_text).join('') || 'Untitled',
          parent: p.parent?.type,
        })),
      };
    }
    case 'createDatabase': {
      const token = msg.token || (await S.getSettings()).notionToken;
      const notion = new Notion(token);
      const db = await createDatabase(notion, msg.parentId ? { pageId: parseNotionId(msg.parentId) } : { workspace: true }, msg.title || 'X Bookmarks');
      await createViews(notion, db);
      await connect(token, db.databaseId, db.dataSourceId, db.url, msg.title || 'X Bookmarks');
      return { database: db };
    }
    case 'useDatabase': {
      const token = msg.token || (await S.getSettings()).notionToken;
      const notion = new Notion(token);
      const id = parseNotionId(msg.id);
      if (!id) throw new Error('Paste a Notion database link or ID');
      const ds = await resolveDataSource(notion, id);
      if (!ds.dataSourceId) throw new Error('That page is not a database');
      await ensureSchema(notion, ds.dataSourceId);
      await connect(token, ds.databaseId, ds.dataSourceId, ds.url, ds.title);
      return { database: ds };
    }
    case 'setToken': {
      await new Notion(msg.token).me();
      await S.setSettings({ notionToken: msg.token });
      return {};
    }
    default:
      throw new Error(`Unknown command ${msg.cmd}`);
  }
}

async function connect(token, databaseId, dataSourceId, databaseUrl, databaseTitle) {
  const prev = await S.getSettings();
  await S.setSettings({ notionToken: token, databaseId, dataSourceId, databaseUrl, databaseTitle });
  if (prev.dataSourceId !== dataSourceId) {
    await S.clearIndex();
    await S.updateState((s) => ({ ...s, backfill: { status: 'idle', cursor: null, scanned: 0, saved: 0, pages: 0 }, recent: [] }));
  }
  kickoff();
}
