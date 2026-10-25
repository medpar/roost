import type { MetadataRoute } from 'next';

// Installable app on macOS, Windows, Android, iOS/iPadOS. On Android/Windows/ChromeOS the
// share target puts Trove in the system share sheet.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Trove',
    short_name: 'Trove',
    description: 'Save anything, keep everything — your personal library in Notion.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f3ee',
    theme_color: '#f6f3ee',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    share_target: { action: '/save', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
    shortcuts: [{ name: 'Add to Trove', url: '/?add=1', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }],
  } as MetadataRoute.Manifest;
}
