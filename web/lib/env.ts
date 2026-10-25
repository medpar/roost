// Server configuration from environment variables.
//   NOTION_TOKEN            Notion integration token with access to both databases
//   TROVE_LIBRARY_DS        data source id of the Trove library database
//   TROVE_X_DS              data source id of the X Bookmarks database
//   TROVE_PASSWORD          password for the web app
//   TROVE_SESSION_SECRET    random string used to sign session cookies
//   TROVE_API_KEYS          "name:key,name:key" (the name is recorded as "Via" on saves)
//   TROVE_PUBLIC_URL        public base URL (https://trove.mariomedpar.com)
//   CRON_SECRET             Vercel cron auth

export type ApiKey = { name: string; key: string };

let cached: ReturnType<typeof read> | null = null;

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v.trim();
}

function read() {
  return {
    notionToken: need('NOTION_TOKEN'),
    libraryDs: need('TROVE_LIBRARY_DS'),
    libraryDb: process.env.TROVE_LIBRARY_DB?.trim() || '',
    xDs: need('TROVE_X_DS'),
    xDb: process.env.TROVE_X_DB?.trim() || '',
    password: process.env.TROVE_PASSWORD?.trim() || '',
    sessionSecret: need('TROVE_SESSION_SECRET'),
    apiKeys: (process.env.TROVE_API_KEYS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.lastIndexOf(':');
        return i > 0 ? { name: s.slice(0, i), key: s.slice(i + 1) } : { name: 'API', key: s };
      }) as ApiKey[],
    publicUrl: (process.env.TROVE_PUBLIC_URL || 'https://trove.mariomedpar.com').replace(/\/$/, ''),
    cronSecret: process.env.CRON_SECRET?.trim() || '',
  };
}

export const env = () => (cached ||= read());
