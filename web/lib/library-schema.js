// Trove library database schema (shared by the web app and scripts/setup-trove.mjs).

export const L = {
  title: 'Title', url: 'URL', key: 'URL key', domain: 'Domain', type: 'Type', platform: 'Platform', collection: 'Collection',
  tags: 'Tags', description: 'Description', text: 'Text', note: 'Note', author: 'Author', site: 'Site', published: 'Published',
  saved: 'Saved', updated: 'Updated', favorite: 'Favorite', read: 'Read', cover: 'Cover', highlights: 'Highlights', words: 'Words',
  readingTime: 'Reading time', duration: 'Duration', lang: 'Language', source: 'Source', via: 'Via', status: 'Status', checked: 'Checked',
  remind: 'Remind', media: 'Media',
};

const o = (name, color) => ({ name, color });
export const TYPES = ['Article', 'Video', 'Post', 'Link', 'Image', 'Document', 'Audio', 'Repo', 'Note', 'Product', 'Paper'];
const TYPE_COLORS = ['brown', 'red', 'blue', 'default', 'pink', 'gray', 'purple', 'green', 'yellow', 'orange', 'brown'];

export function librarySchema() {
  const num = { number: { format: 'number' } };
  return {
    [L.title]: { title: {} },
    [L.url]: { url: {} },
    [L.key]: { rich_text: {} },
    [L.domain]: { rich_text: {} },
    [L.type]: { select: { options: TYPES.map((t, i) => o(t, TYPE_COLORS[i])) } },
    [L.platform]: { select: { options: [] } },
    [L.collection]: { select: { options: [] } },
    [L.tags]: { multi_select: { options: [] } },
    [L.description]: { rich_text: {} },
    [L.text]: { rich_text: {} },
    [L.note]: { rich_text: {} },
    [L.author]: { rich_text: {} },
    [L.site]: { rich_text: {} },
    [L.published]: { date: {} },
    [L.saved]: { created_time: {} },
    [L.updated]: { last_edited_time: {} },
    [L.favorite]: { checkbox: {} },
    [L.read]: { checkbox: {} },
    [L.cover]: { url: {} },
    [L.highlights]: num,
    [L.words]: num,
    [L.readingTime]: num,
    [L.duration]: num,
    [L.lang]: { select: { options: [] } },
    [L.source]: { select: { options: ['Web app', 'Extension', 'Agent', 'API', 'Browser bookmarks', 'Import', 'Share', 'Bookmarklet', 'Shortcut'].map((n, i) => o(n, ['blue', 'purple', 'orange', 'gray', 'yellow', 'brown', 'green', 'pink', 'red'][i])) } },
    [L.via]: { rich_text: {} },
    [L.status]: { select: { options: [o('OK', 'green'), o('Broken', 'red'), o('Redirect', 'yellow')] } },
    [L.checked]: { date: {} },
    [L.remind]: { date: {} },
    [L.media]: { files: {} },
  };
}

