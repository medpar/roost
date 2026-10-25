import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.join(__dirname, '..');

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The web app reuses the extension's Notion + X modules from ../extension/lib.
  outputFileTracingRoot: root,
  turbopack: {
    root,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
