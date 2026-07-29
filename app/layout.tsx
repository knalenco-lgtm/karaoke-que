import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Karaoke',
  description: 'Vraag je nummer aan en stem op de wachtrij.',
};

export const viewport: Viewport = {
  themeColor: '#0a0510',
  // Voorkomt dat iOS inzoomt bij het focussen van de zoekbalk.
  maximumScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl" className={`${outfit.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
