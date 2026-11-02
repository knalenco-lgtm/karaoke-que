import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  // data/catalog.json wordt met fs gelezen, niet geïmporteerd. Zonder deze regel
  // laat Vercel het bestand buiten de serverless bundle van de API-routes.
  // De Speler van de Knal Showcomposer (de app en speel.knalenco.nl) praat rechtstreeks met de
  // API. Dat mag van elke origin: rechten gaan via de pincode of het Speler-token in een header,
  // nooit via cookies.
  async headers() {
    return [
      {
        source: '/api/:pad*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, x-host-pin' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    '/api/songs': ['./data/catalog.json'],
    '/api/request': ['./data/catalog.json'],
  },
};

export default nextConfig;
