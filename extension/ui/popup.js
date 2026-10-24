import { $, ago, el, explain, fmt, send, until } from './common.js';

let activeUrl = null;

async function render() {
  let s;
  try {
    s = await send('status');
  } catch (e) {
    $('alert').hidden = false;
    $('alert').textContent = e.message;
    return;
  }
  const { state, settings, job, loggedIn } = s;
  const bf = state.backfill;
  const configured = s.hasToken && settings.dataSourceId;

  // status pill
  const pill = $('status');
  pill.className = 'pill';
  let label = 'Idle';
  if (job) {
    pill.classList.add('busy');
    label = { sync: 'Syncing', backfill: 'Archiving', manual: 'Saving', index: 'Indexing' }[job] || 'Working';
  } else if (!configured || !loggedIn || (state.lastError && Date.now() - state.lastError.t < 6 * 3600e3)) {
    pill.classList.add('err');
    label = 'Needs attention';
  } else {
    pill.classList.add('ok');
    label = 'Up to date';
  }
  $('statusText').textContent = label;

  // alert
  const alert = $('alert');
  alert.hidden = true;
  alert.replaceChildren();
  if (!configured) {
    alert.hidden = false;
    alert.append('Connect your Notion database. ', el('button', { class: 'link', onclick: () => chrome.runtime.openOptionsPage() }, 'Open settings'));
  } else if (!loggedIn) {
    alert.hidden = false;
    alert.append('Log in to ', el('a', { href: 'https://x.com/login', target: '_blank' }, 'x.com'), ' in this browser so Roost can read your bookmarks.');
  } else if (state.lastError && Date.now() - state.lastError.t < 6 * 3600e3 && !job) {
    alert.hidden = false;
    alert.textContent = explain({ code: state.lastError.extra, msg: state.lastError.msg });
  }

  $('total').textContent = fmt(state.total);
  const next = settings.intervalMin;
  $('syncInfo').innerHTML = '';
  $('syncInfo').append(
    el('div', {}, `Last sync ${ago(state.lastSyncAt)}${state.lastSyncAdded ? ` · +${state.lastSyncAdded}` : ''}`),
    el('div', {}, `Auto-sync every ${next >= 60 ? next / 60 + 'h' : next + 'm'}`),
  );

  // backfill
  const box = $('backfill');
  box.hidden = !configured || bf.status === 'idle';
  const toggle = $('bfToggle');
  const bar = $('bfBar');
  bar.classList.toggle('indeterminate', bf.status === 'running');
  bar.firstElementChild.style.width = bf.status === 'done' ? '100%' : '0';
  if (bf.status === 'done') {
    $('bfTitle').textContent = 'Full archive complete ✓';
    $('bfInfo').textContent = `${fmt(bf.scanned)} bookmarks checked · ${fmt(bf.saved)} added · ${ago(bf.finishedAt)}`;
    toggle.textContent = 'Re-scan';
    toggle.onclick = () => send('backfill', { restart: true }).then(render);
  } else {
    $('bfTitle').textContent =
      bf.status === 'running' ? 'Archiving all bookmarks…' : bf.status === 'paused' ? 'Archive paused' : bf.status === 'stopped' ? 'Archive stopped' : 'Archive interrupted';
    const why = bf.status === 'paused' && bf.pausedUntil ? ` · resumes in ${until(bf.pausedUntil)}` : '';
    $('bfInfo').textContent = `${fmt(bf.scanned)} checked · ${fmt(bf.saved)} added${why}`;
    toggle.textContent = bf.status === 'running' ? 'Stop' : 'Resume';
    toggle.onclick = () => send(bf.status === 'running' ? 'stopBackfill' : 'backfill').then(render);
  }

  // recent
  $('recentWrap').hidden = !state.recent.length;
  $('recent').replaceChildren(
    ...state.recent.slice(0, 5).map((r) =>
      el('li', {}, el('a', { href: r.url || '#', target: '_blank', title: r.title }, el('span', { class: 't' }, r.title), el('span', { class: 'when' }, ago(r.at)))),
    ),
  );

  $('syncBtn').disabled = !configured || job === 'sync';
  $('saveBtn').disabled = !configured || !activeUrl;
  $('openDb').onclick = (e) => {
    e.preventDefault();
    if (settings.databaseUrl) chrome.tabs.create({ url: settings.databaseUrl });
  };
}

$('syncBtn').onclick = async () => {
  $('syncBtn').disabled = true;
  $('syncBtn').textContent = 'Syncing…';
  try {
    const r = await send('sync');
    $('syncBtn').textContent = r.added ? `+${r.added} saved` : 'Up to date';
  } catch (e) {
    $('syncBtn').textContent = 'Sync now';
    $('alert').hidden = false;
    $('alert').textContent = explain(e);
  }
  setTimeout(() => ($('syncBtn').textContent = 'Sync now'), 2500);
  render();
};

$('saveBtn').onclick = async () => {
  const b = $('saveBtn');
  b.disabled = true;
  b.textContent = 'Saving…';
  try {
    const r = await send('saveUrl', { url: activeUrl });
    b.textContent = r.status === 'exists' ? 'Already saved' : 'Saved ✓';
  } catch (e) {
    b.textContent = 'Failed';
    $('alert').hidden = false;
    $('alert').textContent = explain(e);
  }
  render();
};

$('openOptions').onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};
$('openLog').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html#activity') });
};

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  activeUrl = /^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(tab?.url || '') ? tab.url : null;
  render();
});
let queued = null;
chrome.storage.onChanged.addListener((ch) => {
  if (!(ch.state || ch.settings) || queued) return;
  queued = setTimeout(() => {
    queued = null;
    render();
  }, 400);
});
