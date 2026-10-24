import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeline, normalizeTweet, assembleThread, looksLikeThread, postTypes, bookmarkedAtFromSortIndex } from '../extension/lib/parse.js';
import { tweet, user, photo, video, pollCard, linkCard, entry, cursorEntry, moduleEntry, bookmarksResponse, detailResponse } from './fixtures.mjs';

test('parses bookmark timeline entries and cursors, skipping promoted items', () => {
  const t1 = tweet({ id: '1800000000000000001', text: 'first' });
  const t2 = tweet({ id: '1800000000000000002', text: 'second', wrap: true });
  const promoted = entry(tweet({ id: '1800000000000000003', text: 'ad' }));
  promoted.content.itemContent.promotedMetadata = { advertiser: 'x' };
  const res = parseTimeline(bookmarksResponse([entry(t1), entry(t2), promoted, cursorEntry('Top', 'TOP'), cursorEntry('Bottom', 'BOTTOM')]));
  assert.deepEqual(res.items.map((i) => i.tweet.id), ['1800000000000000001', '1800000000000000002']);
  assert.equal(res.cursors.bottom, 'BOTTOM');
  assert.equal(res.cursors.top, 'TOP');
});

test('cleans text: expands t.co, drops media links, decodes entities, keeps emoji', () => {
  const t = normalizeTweet(
    tweet({
      id: '1',
      text: 'Read this 🧪 https://t.co/abc &amp; more &lt;3',
      media: [photo('11', 'A cat')],
      urls: [{ url: 'https://t.co/abc', expanded_url: 'https://example.com/article', display_url: 'example.com/article' }],
    }),
  );
  assert.equal(t.text, 'Read this 🧪 https://example.com/article & more <3');
  assert.equal(t.media.length, 1);
  assert.equal(t.media[0].url, 'https://pbs.twimg.com/media/P11?format=jpg&name=orig');
  assert.equal(t.media[0].alt, 'A cat');
  assert.deepEqual(t.urls, [{ url: 'https://example.com/article', display: 'example.com/article' }]);
  assert.equal(t.url, 'https://x.com/alice/status/1');
  assert.equal(t.source, 'Twitter Web App');
  assert.equal(t.stats.views, 1000);
});

test('long posts use note_tweet text; new user shape is supported', () => {
  const long = 'x'.repeat(5000);
  const t = normalizeTweet(tweet({ id: '2', text: 'xxx…', note: long, author: user({ id: '7', handle: 'bob', name: 'Bob', newShape: true }) }));
  assert.equal(t.text.length, 5000);
  assert.equal(t.isLong, true);
  assert.equal(t.author.handle, 'bob');
  assert.equal(t.author.avatar, 'https://pbs.twimg.com/profile_images/7/avatar_400x400.jpg');
  assert.equal(t.author.blueVerified, true);
  assert.equal(t.author.followers, 1234);
  assert.equal(t.author.location, 'Madrid');
});

test('videos keep variants sorted by bitrate; polls, cards and quotes are parsed', () => {
  const v = normalizeTweet(tweet({ id: '3', text: 'clip', media: [video('31')] }));
  assert.equal(v.media[0].type, 'video');
  assert.match(v.media[0].url, /high\.mp4/);
  assert.equal(v.media[0].variants.length, 2);

  const p = normalizeTweet(tweet({ id: '4', text: 'vote', card: pollCard() }));
  assert.deepEqual(p.poll.options.map((o) => o.votes), [30, 10, 0]);
  assert.equal(p.poll.final, true);

  const c = normalizeTweet(tweet({ id: '5', text: 'link https://t.co/zz', urls: [{ url: 'https://t.co/zz', expanded_url: 'https://example.com/a' }], card: linkCard('https://t.co/zz') }));
  assert.equal(c.card.url, 'https://example.com/a');
  assert.equal(c.card.title, 'Great article');

  const q = normalizeTweet(tweet({ id: '6', text: 'look', quoted: tweet({ id: '60', text: 'original', author: user({ id: '9', handle: 'carol' }) }) }));
  assert.equal(q.quoted.text, 'original');
  assert.equal(q.quoted.author.handle, 'carol');
  assert.deepEqual(postTypes(q), ['Quote']);
});

test('tombstones are flagged unavailable', () => {
  const t = normalizeTweet({ __typename: 'TweetTombstone', tombstone: { text: { text: 'This Post was deleted' } } });
  assert.equal(t.unavailable, true);
});

test('thread assembly walks up and down the author chain and keeps reply context', () => {
  const me = user({ id: '1', handle: 'me' });
  const other = user({ id: '2', handle: 'other' });
  const root = tweet({ id: '100', author: other, text: 'question?' });
  const a = tweet({ id: '101', author: me, text: '1/ answer 🧵', replyTo: { id: '100', userId: '2', handle: 'other' } });
  const b = tweet({ id: '102', author: me, text: '2/ more', replyTo: { id: '101', userId: '1', handle: 'me' } });
  const c = tweet({ id: '103', author: me, text: '3/ end', replyTo: { id: '102', userId: '1', handle: 'me' } });
  const stranger = tweet({ id: '104', author: other, text: 'nice', replyTo: { id: '102', userId: '1', handle: 'me' } });
  const { items } = parseTimeline(detailResponse([entry(root), entry(a), entry(b), moduleEntry('103', [c, stranger])]));
  const pool = new Map(items.map((i) => [i.tweet.id, i.tweet]));
  const { chain, parent } = assembleThread(pool, '102');
  assert.deepEqual(chain.map((t) => t.id), ['101', '102', '103']);
  assert.equal(parent.id, '100');
  assert.equal(looksLikeThread(normalizeTweet(a)), true);
  assert.equal(looksLikeThread(normalizeTweet(b)), true);
  assert.equal(looksLikeThread(normalizeTweet(root)), false);
});

test('bookmark time is decoded only from plausible snowflake sort indexes', () => {
  const t = normalizeTweet(tweet({ id: '1800000000000000001', created: 'Wed Jun 10 00:00:00 +0000 2024' }));
  assert.equal(bookmarkedAtFromSortIndex('1800000000000000001', t), null);
  const later = ((BigInt(Date.parse('2025-01-02T03:04:05Z')) - 1288834974657n) << 22n).toString();
  assert.equal(bookmarkedAtFromSortIndex(later, t), '2025-01-02T03:04:05.000Z');
  assert.equal(bookmarkedAtFromSortIndex('12345', t), null);
});
