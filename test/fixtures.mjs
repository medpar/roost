// Builders for realistic X GraphQL payloads (shapes as returned by x.com web).

export function user({ id = '100', handle = 'alice', name = 'Alice', newShape = false } = {}) {
  if (newShape) {
    return {
      __typename: 'User',
      rest_id: id,
      core: { name, screen_name: handle, created_at: 'Mon Jan 01 00:00:00 +0000 2018' },
      avatar: { image_url: `https://pbs.twimg.com/profile_images/${id}/avatar_normal.jpg` },
      verification: { verified: false },
      is_blue_verified: true,
      location: { location: 'Madrid' },
      privacy: { protected: false },
      legacy: { followers_count: 1234, friends_count: 10, description: 'bio' },
    };
  }
  return {
    __typename: 'User',
    rest_id: id,
    is_blue_verified: false,
    legacy: { name, screen_name: handle, profile_image_url_https: `https://pbs.twimg.com/profile_images/${id}/avatar_normal.jpg`, followers_count: 50, verified: false, description: '' },
  };
}

export const photo = (id, alt = '') => ({
  id_str: id,
  type: 'photo',
  url: `https://t.co/m${id}`,
  media_url_https: `https://pbs.twimg.com/media/P${id}.jpg`,
  original_info: { width: 1200, height: 800 },
  ext_alt_text: alt,
});

export const video = (id, durationMs = 20000) => ({
  id_str: id,
  type: 'video',
  url: `https://t.co/m${id}`,
  media_url_https: `https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/thumb.jpg`,
  original_info: { width: 1280, height: 720 },
  video_info: {
    duration_millis: durationMs,
    variants: [
      { content_type: 'application/x-mpegURL', url: `https://video.twimg.com/ext_tw_video/${id}/pl/playlist.m3u8` },
      { bitrate: 256000, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/vid/480x270/low.mp4?tag=12` },
      { bitrate: 2176000, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/vid/1280x720/high.mp4?tag=12` },
    ],
  },
});

export function tweet({
  id,
  author = user(),
  text = 'hello',
  created = 'Wed Oct 10 20:19:24 +0000 2024',
  media = [],
  urls = [],
  mentions = [],
  hashtags = [],
  replyTo = null,
  quoted = null,
  note = null,
  card = null,
  conv = null,
  views = '1000',
  wrap = false,
}) {
  const fullText = text + media.map((m) => ' ' + m.url).join('');
  const t = {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: author } },
    views: { count: views, state: 'EnabledWithCount' },
    source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
    legacy: {
      id_str: id,
      full_text: fullText,
      created_at: created,
      display_text_range: [0, Array.from(text).length],
      entities: { hashtags: hashtags.map((h) => ({ text: h })), symbols: [], urls, user_mentions: mentions, ...(media.length ? { media } : {}) },
      ...(media.length ? { extended_entities: { media } } : {}),
      favorite_count: 10,
      retweet_count: 2,
      reply_count: 1,
      quote_count: 0,
      bookmark_count: 5,
      lang: 'en',
      conversation_id_str: conv || id,
      user_id_str: author.rest_id,
      ...(replyTo ? { in_reply_to_status_id_str: replyTo.id, in_reply_to_user_id_str: replyTo.userId, in_reply_to_screen_name: replyTo.handle } : {}),
      ...(quoted ? { is_quote_status: true, quoted_status_id_str: quoted.rest_id, quoted_status_permalink: { expanded: `https://x.com/q/status/${quoted.rest_id}` } } : {}),
    },
  };
  if (note) t.note_tweet = { is_expandable: true, note_tweet_results: { result: { id: 'n' + id, text: note, entity_set: { hashtags: [], symbols: [], urls: [], user_mentions: [] } } } };
  if (quoted) t.quoted_status_result = { result: quoted };
  if (card) t.card = card;
  return wrap ? { __typename: 'TweetWithVisibilityResults', tweet: t } : t;
}

export const pollCard = () => ({
  rest_id: 'card://1',
  legacy: {
    name: 'poll3choice_text_only',
    binding_values: [
      { key: 'choice1_label', value: { type: 'STRING', string_value: 'Yes' } },
      { key: 'choice1_count', value: { type: 'STRING', string_value: '30' } },
      { key: 'choice2_label', value: { type: 'STRING', string_value: 'No' } },
      { key: 'choice2_count', value: { type: 'STRING', string_value: '10' } },
      { key: 'choice3_label', value: { type: 'STRING', string_value: 'Maybe' } },
      { key: 'choice3_count', value: { type: 'STRING', string_value: '0' } },
      { key: 'counts_are_final', value: { type: 'BOOLEAN', boolean_value: true } },
    ],
  },
});

export const linkCard = (tco) => ({
  rest_id: 'card://2',
  legacy: {
    name: 'summary_large_image',
    url: tco,
    binding_values: [
      { key: 'title', value: { type: 'STRING', string_value: 'Great article' } },
      { key: 'description', value: { type: 'STRING', string_value: 'All about it' } },
      { key: 'card_url', value: { type: 'STRING', string_value: tco } },
      { key: 'vanity_url', value: { type: 'STRING', string_value: 'example.com' } },
      { key: 'thumbnail_image_original', value: { type: 'IMAGE', image_value: { url: 'https://pbs.twimg.com/card_img/1/x?format=jpg&name=orig' } } },
    ],
  },
});

export const entry = (t, sortIndex) => ({
  entryId: `tweet-${t.rest_id || t.tweet?.rest_id}`,
  sortIndex: sortIndex || t.rest_id || t.tweet?.rest_id,
  content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result: t } } },
});

export const cursorEntry = (type, value) => ({
  entryId: `cursor-${type.toLowerCase()}-${value}`,
  sortIndex: '1',
  content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', value, cursorType: type },
});

export const moduleEntry = (id, tweets, showMore) => ({
  entryId: `conversationthread-${id}`,
  sortIndex: id,
  content: {
    entryType: 'TimelineTimelineModule',
    __typename: 'TimelineTimelineModule',
    items: [
      ...tweets.map((t) => ({ entryId: `conversationthread-${id}-tweet-${t.rest_id}`, item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: t } } } })),
      ...(showMore ? [{ entryId: `conversationthread-${id}-cursor-showmore-1`, item: { itemContent: { itemType: 'TimelineTimelineCursor', value: showMore, cursorType: 'ShowMore' } } }] : []),
    ],
  },
});

export const bookmarksResponse = (entries) => ({ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } });

export const detailResponse = (entries) => ({ data: { threaded_conversation_with_injections_v2: { instructions: [{ type: 'TimelineAddEntries', entries }] } } });

export const addToModuleResponse = (moduleEntryId, tweets) => ({
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [{ type: 'TimelineAddToModule', moduleEntryId, moduleItems: tweets.map((t) => ({ entryId: `${moduleEntryId}-tweet-${t.rest_id}`, item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: t } } } })) }],
    },
  },
});
