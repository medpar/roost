// Database schema for archived posts, plus helpers to create the database,
// add any missing properties (self-healing), and set up handy views.

export const P = {
  title: 'Title',
  author: 'Author',
  handle: 'Handle',
  url: 'URL',
  id: 'Post ID',
  text: 'Text',
  posted: 'Posted',
  bookmarked: 'Bookmarked',
  saved: 'Saved',
  type: 'Type',
  tags: 'Tags',
  read: 'Read',
  unroll: 'Unroll thread',
  threadLen: 'Thread length',
  likes: 'Likes',
  reposts: 'Reposts',
  replies: 'Replies',
  quotes: 'Quotes',
  bookmarks: 'Bookmarks',
  views: 'Views',
  media: 'Media',
  links: 'Links',
  link: 'Link',
  hashtags: 'Hashtags',
  mentions: 'Mentions',
  lang: 'Language',
  verified: 'Verified',
  followers: 'Followers',
  quoted: 'Quoted post',
  replyTo: 'Reply to',
  source: 'Source',
  client: 'Client',
};

const opt = (name, color) => ({ name, color });

export const TYPE_OPTIONS = [
  opt('Text', 'default'), opt('Photo', 'blue'), opt('Video', 'red'), opt('GIF', 'pink'), opt('Link', 'green'),
  opt('Quote', 'purple'), opt('Reply', 'gray'), opt('Thread', 'orange'), opt('Article', 'brown'), opt('Poll', 'yellow'),
  opt('Long post', 'default'),
];

const num = { number: { format: 'number' } };

export function schemaProperties() {
  return {
    [P.title]: { title: {} },
    [P.author]: { rich_text: {} },
    [P.handle]: { rich_text: {} },
    [P.url]: { url: {} },
    [P.id]: { rich_text: {} },
    [P.text]: { rich_text: {} },
    [P.posted]: { date: {} },
    [P.bookmarked]: { date: {} },
    [P.saved]: { created_time: {} },
    [P.type]: { multi_select: { options: TYPE_OPTIONS } },
    [P.tags]: { multi_select: { options: [] } },
    [P.read]: { checkbox: {} },
    [P.unroll]: { checkbox: {} },
    [P.threadLen]: num,
    [P.likes]: num,
    [P.reposts]: num,
    [P.replies]: num,
    [P.quotes]: num,
    [P.bookmarks]: num,
    [P.views]: num,
    [P.media]: { files: {} },
    [P.links]: { rich_text: {} },
    [P.link]: { url: {} },
    [P.hashtags]: { rich_text: {} },
    [P.mentions]: { rich_text: {} },
    [P.lang]: { select: { options: [] } },
    [P.verified]: { checkbox: {} },
    [P.followers]: num,
    [P.quoted]: { url: {} },
    [P.replyTo]: { url: {} },
    [P.source]: { select: { options: [opt('Bookmark', 'blue'), opt('Manual', 'green')] } },
    [P.client]: { select: { options: [] } },
  };
}

/** Create the database. parent: { pageId } or { workspace: true }. */
export async function createDatabase(notion, parent, title = 'X Bookmarks') {
  const db = await notion.req('POST', '/databases', {
    parent: parent.pageId ? { type: 'page_id', page_id: parent.pageId } : { type: 'workspace', workspace: true },
    title: [{ type: 'text', text: { content: title } }],
    icon: { type: 'emoji', emoji: '🐦' },
    description: [{ type: 'text', text: { content: 'Archived by Roost — your X bookmarks, kept safe even if the posts get deleted.' } }],
    initial_data_source: { properties: schemaProperties() },
  });
  const dataSourceId = db.data_sources?.[0]?.id;
  return { databaseId: db.id, dataSourceId, url: db.url };
}

/** Resolve the data source of a database (or accept a data source id directly). */
export async function resolveDataSource(notion, id) {
  try {
    const db = await notion.getDatabase(id);
    return { databaseId: db.id, dataSourceId: db.data_sources?.[0]?.id, url: db.url, title: plain(db.title) };
  } catch (e) {
    const ds = await notion.getDataSource(id);
    return { databaseId: ds.parent?.database_id, dataSourceId: ds.id, url: ds.url, title: plain(ds.title) };
  }
}

const plain = (rt) => (rt || []).map((t) => t.plain_text).join('');

/** Add any properties that are missing (e.g. after an upgrade or a manual delete). Returns property id map. */
export async function ensureSchema(notion, dataSourceId) {
  const ds = await notion.getDataSource(dataSourceId);
  const want = schemaProperties();
  const have = ds.properties || {};
  const missing = {};
  for (const [name, def] of Object.entries(want)) {
    if (name === P.title) continue;
    if (!have[name]) missing[name] = def;
  }
  // The title property may have a different name (e.g. "Name") in a user-picked database.
  const titleName = Object.entries(have).find(([, v]) => v.type === 'title')?.[0];
  if (titleName && titleName !== P.title && !have[P.title]) missing[titleName] = { name: P.title };
  if (Object.keys(missing).length) {
    const updated = await notion.updateDataSource(dataSourceId, { properties: missing });
    return idMap(updated.properties);
  }
  return idMap(have);
}

const idMap = (props) => Object.fromEntries(Object.entries(props || {}).map(([k, v]) => [k, v.id]));

/** Best-effort extra views: Gallery, Unread, Threads, Articles & links. */
export async function createViews(notion, { databaseId, dataSourceId }) {
  const sortNewest = [{ property: P.bookmarked, direction: 'descending' }, { timestamp: 'created_time', direction: 'descending' }];
  const views = [
    { name: 'Gallery', type: 'gallery', configuration: { type: 'gallery', cover: { type: 'page_content' }, cover_size: 'medium', cover_aspect: 'cover', card_layout: 'list' } },
    { name: 'Unread', type: 'table', filter: { property: P.read, checkbox: { equals: false } } },
    { name: 'Threads', type: 'table', filter: { property: P.type, multi_select: { contains: 'Thread' } } },
    { name: 'Media', type: 'gallery', filter: { or: [{ property: P.type, multi_select: { contains: 'Photo' } }, { property: P.type, multi_select: { contains: 'Video' } }] }, configuration: { type: 'gallery', cover: { type: 'page_content' }, cover_size: 'large', cover_aspect: 'cover' } },
  ];
  const created = [];
  for (const v of views) {
    try {
      await notion.req('POST', '/views', { database_id: databaseId, data_source_id: dataSourceId, sorts: sortNewest, ...v });
      created.push(v.name);
    } catch (e) {
      // Sorting by a timestamp may be unsupported in view sorts; retry with property sort only.
      try {
        await notion.req('POST', '/views', { database_id: databaseId, data_source_id: dataSourceId, sorts: [sortNewest[0]], ...v });
        created.push(v.name);
      } catch { /* views are optional */ }
    }
  }
  return created;
}
