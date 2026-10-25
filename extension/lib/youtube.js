// Read YouTube video details + transcript from the user's own browser session.
// Cloud servers usually get a "confirm you're not a bot" wall from YouTube, so Trove
// relies on the extension for descriptions, durations and transcripts.

export const videoIdOf = (url) =>
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url || '')?.[1] || null;

const clock = (s) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export function formatTranscript(json3) {
  const lines = [];
  let bucket = '';
  let start = 0;
  for (const ev of json3?.events || []) {
    const txt = (ev.segs || []).map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    const t = Math.floor((ev.tStartMs || 0) / 1000);
    if (!bucket) start = t;
    bucket += (bucket ? ' ' : '') + txt;
    if (t - start >= 60) {
      lines.push(`**${clock(start)}** ${bucket}`);
      bucket = '';
    }
  }
  if (bucket) lines.push(`**${clock(start)}** ${bucket}`);
  return lines.join('\n\n');
}

/** Fetch details for a video id using the browser's YouTube session (consent cookies etc.). */
export async function youtubeData(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { credentials: 'include' });
  const html = await res.text();
  const m = /ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script)/s.exec(html);
  if (!m) return null;
  const p = JSON.parse(m[1]);
  const vd = p.videoDetails || {};
  const mf = p.microformat?.playerMicroformatRenderer || {};
  if (!vd.videoId) return null;
  let transcript = '';
  const tracks = p.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track = tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') || tracks.find((t) => t.kind !== 'asr') || tracks[0];
  if (track?.baseUrl) {
    try {
      const tr = await fetch(`${track.baseUrl}&fmt=json3`, { credentials: 'include' }).then((r) => r.json());
      transcript = formatTranscript(tr);
    } catch { /* no transcript */ }
  }
  const published = mf.publishDate || mf.uploadDate;
  return {
    title: vd.title || '',
    author: vd.author || '',
    description: (vd.shortDescription || '').trim(),
    duration: Number(vd.lengthSeconds) || null,
    published: published ? new Date(published).toISOString() : null,
    views: Number(vd.viewCount) || null,
    transcript,
  };
}
