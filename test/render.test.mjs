import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTweet } from '../extension/lib/parse.js';
import { buildBlocks, buildProperties, linkify, autoTags, parseRules, titleFor } from '../extension/lib/render.js';
import { schemaProperties, P } from '../extension/lib/schema.js';
import { tweet, user, photo, video, pollCard, linkCard } from './fixtures.mjs';
import { validateBlocks, validateProperties } from './notion-limits.mjs';

const big = normalizeTweet(
  tweet({
    id: '1',
    text: `Hey @bob check #AI and $TSLA at https://example.com/x. ${'long '.repeat(900)}`,
    note: `Hey @bob check #AI and $TSLA at https://example.com/x. ${'long '.repeat(900)}`,
    media: [photo('1', 'alt'), video('2')],
    hashtags: ['AI'],
    mentions: [{ screen_name: 'bob', name: 'Bob', id_str: '5' }],
    urls: [{ url: 'https://t.co/q', expanded_url: 'https://example.com/x' }],
    card: pollCard(),
    quoted: tweet({ id: '9', text: 'quoted with pic', media: [photo('3')], author: user({ id: '3', handle: 'q' }) }),
  }),
);

test('linkify turns urls, mentions, hashtags and cashtags into links', () => {
  const rt = linkify('see https://a.com/b). @bob #tag $AAPL email a@b.c');
  const links = rt.filter((r) => r.text.link).map((r) => [r.text.content, r.text.link.url]);
  assert.deepEqual(links, [
    ['https://a.com/b', 'https://a.com/b'],
    ['@bob', 'https://x.com/bob'],
    ['#tag', 'https://x.com/hashtag/tag'],
    ['$AAPL', 'https://x.com/search?q=%24AAPL'],
  ]);
  assert.equal(rt.map((r) => r.text.content).join(''), 'see https://a.com/b). @bob #tag $AAPL email a@b.c');
});

test('properties match the schema and respect Notion limits', () => {
  const props = buildProperties(big, { tags: ['AI, ML'], bookmarkedAt: '2025-01-01T00:00:00.000Z' });
  const schema = schemaProperties();
  for (const name of Object.keys(props)) assert.ok(schema[name], `unknown property ${name}`);
  validateProperties(props, schema);
  assert.deepEqual(props[P.tags].multi_select, [{ name: 'AI  ML' }]);
  assert.ok(props[P.type].multi_select.some((o) => o.name === 'Poll'));
  assert.equal(props[P.media].files.length, 3);
});

test('blocks respect nesting depth, text and item limits (single post, thread, reply context)', () => {
  const uploads = new Map([[big.media[0].url, 'up-1']]);
  validateBlocks(buildBlocks(big, { uploads, raw: true }));
  const chain = [big, normalizeTweet(tweet({ id: '2', text: '2/ next', media: [photo('5')] }))];
  const parent = normalizeTweet(tweet({ id: '0', text: 'parent', quoted: tweet({ id: '8', text: 'q', media: [photo('6')] }), card: pollCard() }));
  const blocks = buildBlocks(big, { chain, parent, uploads, raw: true });
  validateBlocks(blocks);
  const kinds = blocks.map((b) => b.type);
  assert.ok(kinds.includes('heading_3'));
  assert.ok(blocks.some((b) => b.type === 'image' && b.image.type === 'file_upload'));
  assert.ok(blocks.some((b) => b.type === 'video' && b.video.type === 'external'));
});

test('long emoji-heavy text stays under the 2000 UTF-16 unit limit', () => {
  const t = normalizeTweet(tweet({ id: '7', text: 'x', note: '🧵🔥 '.repeat(800) + 'end' }));
  const props = buildProperties(t, {});
  validateProperties(props, schemaProperties());
  assert.equal(props[P.text].rich_text.map((r) => r.text.content).join(''), t.text);
  validateBlocks(buildBlocks(t, {}));
});

test('titles prefer article titles, then first line, then a media label', () => {
  assert.equal(titleFor(normalizeTweet(tweet({ id: '1', text: 'First line\nsecond' }))), 'First line');
  assert.equal(titleFor(normalizeTweet(tweet({ id: '1', text: '', media: [photo('1')] }))), 'Photo by @alice');
});

test('auto-tag rules', () => {
  const rules = parseRules('AI: openai, @karpathy, /gpt-?\\d/i\nNews: nytimes.com\nVisual: type:Photo\n# comment: ignored');
  assert.equal(rules.length, 3);
  const t = normalizeTweet(tweet({ id: '1', text: 'GPT-5 is out https://www.nytimes.com/a', urls: [{ url: 'https://t.co/a', expanded_url: 'https://www.nytimes.com/a' }], media: [photo('1')] }));
  assert.deepEqual(autoTags(t, rules), ['AI', 'News', 'Visual']);
  const k = normalizeTweet(tweet({ id: '2', text: 'hi', author: user({ handle: 'karpathy' }) }));
  assert.deepEqual(autoTags(k, rules), ['AI']);
});

test('link cards render as bookmarks', () => {
  const t = normalizeTweet(tweet({ id: '5', text: 'x https://t.co/zz', urls: [{ url: 'https://t.co/zz', expanded_url: 'https://example.com/a' }], card: linkCard('https://t.co/zz') }));
  const blocks = buildBlocks(t, {});
  assert.ok(blocks.some((b) => b.type === 'bookmark' && b.bookmark.url === 'https://example.com/a'));
});
