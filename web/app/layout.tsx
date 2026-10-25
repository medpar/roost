import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import './globals.css';

const sans = Hanken_Grotesk({ subsets: ['latin', 'latin-ext'], variable: '--font-sans', display: 'swap' });
const serif = Source_Serif_4({ subsets: ['latin', 'latin-ext'], style: ['normal'], variable: '--font-serif', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Trove', template: '%s · Trove' },
  description: 'Save anything, keep everything. Your personal library, archived in Notion.',
  applicationName: 'Trove',
  appleWebApp: { capable: true, title: 'Trove', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

// Light by default; apply a saved dark preference before first paint (no flash).
const themeScript = `try{if(localStorage.getItem('trove-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
