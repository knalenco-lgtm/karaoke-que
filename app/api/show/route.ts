import { NextResponse } from 'next/server';
import { foutRespons, leesBody } from '@/lib/api';
import { QueueError } from '@/lib/queue';
import { maakShow, normaliseerCode, pinKlopt, showBestaat } from '@/lib/shows';
import { getRedis, SHOW_KEYS } from '@/lib/redis';
import { isActief, zetActief } from '@/lib/actief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Een show aanmaken (met de pincode). Geeft de code en het Speler-token. */
export async function POST(request: Request) {
  try {
    if (!pinKlopt(request)) throw new QueueError('Onjuiste pincode.', 401, 'PIN');
    const body = await leesBody(request);
    const show = await maakShow({ naam: body.naam, code: body.code });
    // `actief: true` (de Showcomposer bij Show maken): meteen de show achter /go.
    if (body.actief === true) await zetActief(show.code, true);
    return NextResponse.json({ ok: true, ...show, actief: body.actief === true });
  } catch (error) {
    return foutRespons(error);
  }
}

/** Bestaat deze show? Voor de gastenpagina bij het invoeren van een code. */
export async function GET(request: Request) {
  try {
    const code = normaliseerCode(new URL(request.url).searchParams.get('s'));
    if (!(await showBestaat(code))) {
      throw new QueueError('Deze show-code bestaat niet (meer). Vraag de host om de juiste code.', 404, 'SHOW');
    }
    const naam = await getRedis().hget<string>(SHOW_KEYS.show(code), 'naam');
    return NextResponse.json({ code, naam: String(naam ?? ''), actief: await isActief(code) });
  } catch (error) {
    return foutRespons(error);
  }
}
