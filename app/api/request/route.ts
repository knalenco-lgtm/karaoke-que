import { NextResponse } from 'next/server';
import { maakAanvraag, trekIn } from '@/lib/queue';
import { foutRespons, leesBody, tekst } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Nieuw nummer aanvragen. Alleen met een songId uit de KaraFun-catalogus. */
export async function POST(request: Request) {
  try {
    const body = await leesBody(request);
    const resultaat = await maakAanvraag({
      songId: tekst(body.songId),
      zangerNaam: tekst(body.zangerNaam),
      extraSingers: body.extraSingers,
      deviceId: tekst(body.deviceId),
    });
    return NextResponse.json({ ok: true, ...resultaat });
  } catch (error) {
    return foutRespons(error);
  }
}

/** Eigen aanvraag intrekken. */
export async function DELETE(request: Request) {
  try {
    const body = await leesBody(request);
    await trekIn(tekst(body.requestId), tekst(body.deviceId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return foutRespons(error);
  }
}
