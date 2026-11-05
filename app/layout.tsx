import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, Montserrat } from 'next/font/google';
import './globals.css';

// Next.js zet de lettertypen bij het bouwen in de site zelf: geen verzoek naar Google bij de gast.
const bebas = Bebas_Neue({ variable: '--font-bebas', weight: '400', subsets: ['latin'] });
const montserrat = Montserrat({ variable: '--font-montserrat', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Karaoke · Knal & Co.',
  description: 'Vraag je nummer aan en zie wanneer je aan de beurt bent.',
};

export const viewport: Viewport = {
  themeColor: '#120e18',
  // Voorkomt dat iOS inzoomt bij het focussen van de zoekbalk.
  maximumScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl" className={`${bebas.variable} ${montserrat.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
