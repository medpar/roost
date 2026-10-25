// Web app logic: URL normalization, platform detection, search syntax, FxTwitter mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, findUrls, guessType, platformOf, tweetId, urlKey, youtubeId } from '../web/lib/url.ts';
import { parseQuery } from '../web/lib/query.ts';
import { fxToPost } from '../web/lib/fx.ts';
import { buildBlocks, buildProperties } from '../extension/lib/render.js';
import { schemaProperties } from '../extension/lib/schema.js';
import { validateBlocks, validateProperties } from './notion-limits.mjs';

test('duplicate keys ignore tracking params, www, trailing slashes and fragments', () => {
  const same = [
    'https://www.example.com/post/?utm_source=x&utm_medium=y#comments',
    'https://example.com/post',
    'http://m.example.com/post?fbclid=123',
  ];
  assert.equal(new Set(same.map(urlKey)).size, 1);
  assert.notEqual(urlKey('https://example.com/post?id=1'), urlKey('https://example.com/post?id=2'));
  assert.equal(urlKey('https://youtu.be/dQw4w9WgXcQ?si=abc'), urlKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share'));
  assert.equal(urlKey('https://youtube.com/shorts/dQw4w9WgXcQ'), 'youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(urlKey('https://twitter.com/jack/status/20?s=20'), urlKey('https://x.com/i/web/status/20'));
  assert.equal(urlKey('https://arxiv.org/pdf/1706.03762v7'), urlKey('https://arxiv.org/abs/1706.03762'));
  assert.equal(cleanUrl('https://a.com/x?utm_campaign=z&q=1'), 'https://a.com/x?q=1');
});

test('platforms, types and ids', () => {
  assert.equal(platformOf('https://www.youtube.com/watch?v=x'), 'YouTube');
  assert.equal(platformOf('https://bsky.app/profile/a.b/post/xyz'), 'Bluesky');
  assert.equal(platformOf('https://mastodon.social/@user/112233445566'), 'Mastodon');
  assert.equal(platformOf('https://news.ycombinator.com/item?id=1'), 'Hacker News');
  assert.equal(platformOf('https://example.com'), 'Web');
  assert.equal(guessType('https://github.com/vercel/next.js', 'GitHub'), 'Repo');
  assert.equal(guessType('https://github.com/vercel/next.js/issues/1', 'GitHub'), 'Link');
  assert.equal(guessType('https://x.com/a/status/1', 'X'), 'Post');
  assert.equal(guessType('https://a.com/file.pdf', 'Web'), 'Document');
  assert.equal(guessType('https://a.com/a.png', 'Web'), 'Image');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(tweetId('https://x.com/jack/status/20'), '20');
  assert.deepEqual(findUrls('look https://a.com/x). and https://b.com'), ['https://a.com/x', 'https://b.com']);
});

test('search syntax', () => {
  const q = parseQuery('llm "exact words" -crypto #ai -#old #"deep learning" type:video -type:post site:youtube.com title:intro collection:"Dev/AI" is:fav is:unread created:>2025-01 highlights:true match:OR');
  assert.deepEqual(q.terms, ['llm', 'exact words']);
  assert.deepEqual(q.exclude, ['crypto']);
  assert.deepEqual(q.tags, ['ai', 'deep learning']);
  assert.deepEqual(q.notTags, ['old']);
  assert.deepEqual(q.types, ['Video']);
  assert.deepEqual(q.notTypes, ['Post']);
  assert.deepEqual(q.sites, ['youtube.com']);
  assert.deepEqual(q.fields, [{ field: 'title', value: 'intro' }]);
  assert.equal(q.collection, 'Dev/AI');
  assert.equal(q.favorite, true);
  assert.equal(q.read, false);
  assert.equal(q.createdAfter, '2025-02-01');
  assert.equal(q.hasHighlights, true);
  assert.equal(q.matchAny, true);
  assert.equal(parseQuery('collection:unsorted').collection, null);
  const d = parseQuery('created:2025-03');
  assert.equal(d.createdAfter, '2025-03-01');
  assert.equal(d.createdBefore, '2025-04-01');
});

test('FxTwitter posts render into valid Notion X pages', () => {
  const fx = {
    id: '20',
    text: 'just setting up my twttr https://example.com #hello @biz',
    created_timestamp: 1142974214,
    lang: 'en',
    likes: 300000,
    retweets: 120000,
    replies: 18000,
    views: null,
    author: { id: '12', name: 'jack', screen_name: 'jack', avatar_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg', followers: 6000000, verification: { verified: true } },
    media: {
      photos: [{ url: 'https://pbs.twimg.com/media/ABC.jpg', width: 800, height: 600, altText: 'a bird' }],
      videos: [{ type: 'video', url: 'https://video.twimg.com/ext_tw_video/1/vid/720x720/x.mp4', thumbnail_url: 'https://pbs.twimg.com/t.jpg', duration: 12.5 }],
    },
    quote: { id: '21', text: 'quoted', author: { screen_name: 'biz', name: 'Biz' }, media: {} },
    poll: { choices: [{ label: 'A', count: 3 }, { label: 'B', count: 1 }], ends_at: '2006-03-22T00:00:00Z', time_left_en: 'Final results' },
  };
  const t = fxToPost(fx);
  assert.equal(t.url, 'https://x.com/jack/status/20');
  assert.equal(t.createdAt, '2006-03-21T20:50:14.000Z');
  assert.equal(t.media[0].url, 'https://pbs.twimg.com/media/ABC?format=jpg&name=orig');
  assert.equal(t.media[1].durationMs, 12500);
  assert.deepEqual(t.hashtags, ['hello']);
  assert.equal(t.mentions[0].handle, 'biz');
  assert.equal(t.poll.final, true);
  assert.equal(t.quoted.author.handle, 'biz');
  const props = buildProperties(t, { source: 'Agent', tags: ['history'] });
  validateProperties(props, schemaProperties());
  validateBlocks(buildBlocks(t, { raw: true }));
});

test('Pinterest pins: one key per pin on any country host, board as sub-collection', async () => {
  const { pinToItem, boardCollection } = await import('../extension/lib/pinterest.js');
  assert.equal(urlKey('https://es.pinterest.com/pin/708613322662554524/'), 'pinterest.com/pin/708613322662554524');
  assert.equal(urlKey('https://www.pinterest.com/pin/708613322662554524/?mt=login'), 'pinterest.com/pin/708613322662554524');
  assert.equal(platformOf('https://www.pinterest.com/pin/1/'), 'Pinterest');
  const board = { id: '1', name: 'Watches', url: '/u/watches/' };
  const pin = { id: '42', type: 'pin', title: '', grid_title: 'Reloj minimalista', description: 'A watch', link: 'https://shop.example/watch', domain: 'shop.example', images: { orig: { url: 'https://i.pinimg.com/originals/a/b.jpg' } }, created_at: 'Tue, 01 Jul 2025 10:00:00 +0000' };
  const item = pinToItem(pin, board);
  assert.equal(item.url, 'https://www.pinterest.com/pin/42/');
  assert.equal(item.collection, 'Pinterest/Watches');
  assert.equal(item.type, 'Image');
  assert.equal(item.title, 'Reloj minimalista');
  assert.equal(item.meta.image, 'https://i.pinimg.com/originals/a/b.jpg');
  assert.equal(item.meta.pin.link, 'https://shop.example/watch');
  assert.equal(boardCollection({ name: 'Guardado rápido', url: '/u/_quick_saves/' }), 'Pinterest/Quick saves');
  assert.equal(boardCollection({ name: 'Cars/Bikes', url: '/u/cars/' }), 'Pinterest/Cars-Bikes');
  const video = pinToItem({ ...pin, videos: { video_list: { V_HLSV3: { url: 'https://v.pinimg.com/a.m3u8' }, V_720P: { url: 'https://v.pinimg.com/a.mp4' } } } }, board);
  assert.equal(video.type, 'Video');
  assert.equal(video.meta.pin.video, 'https://v.pinimg.com/a.mp4');
});
