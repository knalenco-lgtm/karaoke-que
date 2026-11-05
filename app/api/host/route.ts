import { NextResponse } from 'next/server';
import {
  hostKlaar,
  hostScores,
  hostSkip,
  hostToevoegen,
  uitslagWeg,
  hostStart,
  hostVerrassing,
  hostVerwijder,
  QueueError,
  uitslagBewaren,
} from '@/lib/queue';
import { foutRespons, leesBody, tekst } from '@/lib/api';
import { codeUit, controleerHost, showBestaat, verleng } from '@/lib/shows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Host-acties, met de pincode (header `x-host-pin`) of met het Speler-token van de show
 * (`Authorization: Bearer …`, de Knal Speler en de Showcomposer). De show-code staat in `?s=`
 * of in de body (`show`).
 */
export async function POST(request: Request) {
  try {
    const body = await leesBody(request);
    const code = codeUit(request, body);
    await controleerHost(request, code);
    if (!(await showBestaat(code))) {
      throw new QueueError('Deze show-code bestaat niet (meer).', 404, 'SHOW');
    }

    const actie = tekst(body.actie);
    const requestId = tekst(body.requestId);

    switch (actie) {
      case 'login':
        await verleng(code);
        break;
      case 'start':
        // Eén klik: dit nummer aan de beurt, het vorige is klaar.
        return NextResponse.json({ ok: true, start: await hostStart(code, requestId) });
      case 'klaar':
        // Fase 13: het nummer is afgelopen zonder dat er een volgende start.
        return NextResponse.json({ ok: true, klaar: await hostKlaar(code) });
      case 'uitslag':
        // Fase 13: de score van de Knal-meter, zodat de zanger hem op zijn telefoon ziet.
        return NextResponse.json({ ok: true, uitslag: await uitslagBewaren(code, { requestId, score: body.score, labels: body.labels, opbouw: body.opbouw }) });
      case 'toevoegen':
        // De Speler meldt iemand aan ("Nummer toevoegen"), met de markering "via host".
        return NextResponse.json({
          ok: true,
          toegevoegd: await hostToevoegen(code, {
            songId: tekst(body.songId),
            zangerNaam: tekst(body.zangerNaam),
            extraSingers: body.extraSingers,
            volgende: body.volgende === true,
          }),
        });
      case 'uitslagweg':
        // Een score uit het leaderboard (een testzanger), ook van de telefoon van die zanger.
        return NextResponse.json({ ok: true, ...(await uitslagWeg(code, requestId)) });
      case 'scores':
        // Scores aan of uit: uit = geen leaderboard en geen eigen score op de telefoons.
        return NextResponse.json({ ok: true, ...(await hostScores(code, body.aan !== false)) });
      case 'skip':
        await hostSkip(code, requestId);
        break;
      case 'verwijder':
        await hostVerwijder(code, requestId);
        break;
      case 'verrassing':
        return NextResponse.json({ ok: true, verrassing: await hostVerrassing(code) });
      default:
        throw new QueueError(`Onbekende actie: ${actie || '(leeg)'}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return foutRespons(error);
  }
}
