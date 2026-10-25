'use client';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

const EMBED_HOSTS = /^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com|open\.spotify\.com|w\.soundcloud\.com|www\.tiktok\.com)\//;

function embedSrc(url: string): string | null {
  const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = /vimeo\.com\/(\d+)/.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  const sp = /open\.spotify\.com\/(track|episode|show|album|playlist)\/(\w+)/.exec(url);
  if (sp) return `https://open.spotify.com/embed/${sp[1]}/${sp[2]}`;
  const tt = /tiktok\.com\/@[\w.]+\/video\/(\d+)/.exec(url);
  if (tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  return null;
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function notionToHtmlish(md: string) {
  return md
    .replace(/<video src="([^"]+)"[^>]*><\/video>/g, (_m, src) => {
      const e = embedSrc(src);
      return e ? `\n\n<iframe src="${attr(e)}" allowfullscreen loading="lazy"></iframe>\n\n` : `\n\n<video src="${attr(src)}" controls preload="metadata"></video>\n\n`;
    })
    .replace(/<embed src="([^"]+)"[^>]*><\/embed>/g, (_m, src) => {
      const e = embedSrc(src);
      return e ? `\n\n<iframe src="${attr(e)}" allowfullscreen loading="lazy"></iframe>\n\n` : `\n\n<a class="bookmark" href="${attr(src)}">${attr(src)}</a>\n\n`;
    })
    .replace(/<bookmark url="([^"]+)"[^>]*>(?:<\/bookmark>)?/g, (_m, u) => `\n\n<a class="bookmark" href="${attr(u)}">${attr(u.replace(/^https?:\/\//, ''))}</a>\n\n`)
    .replace(/<callout(?: icon="([^"]*)")?[^>]*>([\s\S]*?)<\/callout>/g, (_m, icon, body) => `\n\n<div class="callout"><span>${icon || '💡'}</span><div>${marked.parseInline(body.trim())}</div></div>\n\n`)
    .replace(/<span color="([\w_]+)">/g, (_m, c) => `<span class="${/gray/.test(c) ? 'gray' : ''}">`)
    .replace(/<\/?(details|summary|columns|column|mention-[\w-]+|page|database|table_of_contents|unknown)[^>]*>/g, '');
}

let hooked = false;
function purify(html: string) {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
      if (node.tagName === 'IFRAME' && !EMBED_HOSTS.test(node.getAttribute('src') || '')) node.remove();
      if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy');
    });
  }
  return DOMPurify.sanitize(html, { ADD_TAGS: ['iframe', 'video'], ADD_ATTR: ['allowfullscreen', 'target', 'controls', 'preload', 'loading'] });
}

export function Reader({ markdown, highlights = [] }: { markdown: string; highlights?: string[] }) {
  const html = useMemo(() => {
    const body = markdown.replace(/^\*Saved with Trove[^\n]*\n*/, '');
    let out = purify(marked.parse(notionToHtmlish(body), { async: false, gfm: true, breaks: false }) as string);
    for (const h of highlights) {
      const needle = h.trim().slice(0, 140);
      if (needle.length > 12) out = out.replace(needle.replace(/&/g, '&amp;'), `<mark>${needle}</mark>`);
    }
    return out;
  }, [markdown, highlights]);
  return <article className="reader" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Pull highlight quotes out of the archived markdown ("## Highlights" section). */
export function highlightsOf(md: string | null | undefined): string[] {
  if (!md) return [];
  const m = /^#{1,3}\s+Highlights\s*$([\s\S]*)/m.exec(md);
  if (!m) return [];
  return m[1]
    .split('\n')
    .filter((l) => l.startsWith('>'))
    .map((l) => l.replace(/^>\s?/, '').trim())
    .filter(Boolean);
}
