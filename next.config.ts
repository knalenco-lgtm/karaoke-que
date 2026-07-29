import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  // data/catalog.json wordt met fs gelezen, niet geïmporteerd. Zonder deze regel
  // laat Vercel het bestand buiten de serverless bundle van de API-routes.
  outputFileTracingIncludes: {
    '/api/songs': ['./data/catalog.json'],
    '/api/request': ['./data/catalog.json'],
  },
};

export default nextConfig;
