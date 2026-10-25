import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono, Newsreader } from 'next/font/google';
import './globals.css';

const sans = Instrument_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-sans', display: 'swap' });
const display = Instrument_Serif({ subsets: ['latin', 'latin-ext'], weight: '400', style: ['normal', 'italic'], variable: '--font-display-serif', display: 'swap' });
const read = Newsreader({ subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-read-serif', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-face', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Trove', template: '%s · Trove' },
  description: 'Save anything, keep everything — your personal library, archived in Notion.',
  applicationName: 'Trove',
  appleWebApp: { capable: true, title: 'Trove', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f3ee' },
    { media: '(prefers-color-scheme: dark)', color: '#131210' },
  ],
};

// Apply the saved theme before first paint (no flash).
const themeScript = `try{var t=localStorage.getItem('trove-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${read.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="grain">{children}</body>
    </html>
  );
}
