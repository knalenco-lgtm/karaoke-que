import { NextResponse } from 'next/server';
import { actieveShows } from '@/lib/actief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Het vaste instapadres voor de QR-code op het bord. Eén actieve show: meteen naar die show.
 * Meerdere of geen: de codepagina (`/?go=1`), die de actieve shows als knoppen toont of zegt dat
 * er nu geen karaoke actief is.
 */
export async function GET(request: Request) {
  let doel = '/?go=1';
  try {
    const shows = await actieveShows();
    if (shows.length === 1) doel = `/?s=${encodeURIComponent(shows[0].code)}`;
  } catch {
    // Geen Redis: de gewone codepagina.
  }
  const r = NextResponse.redirect(new URL(doel, request.url), 307);
  r.headers.set('Cache-Control', 'no-store');
  return r;
}
