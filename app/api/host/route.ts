import { NextResponse } from 'next/server';
import {
  hostHerstel,
  hostSkip,
  hostVerrassing,
  hostVerwijder,
  hostVolgende,
  QueueError,
} from '@/lib/queue';
import { foutRespons, leesBody, tekst } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Controleert de pincode uit de header tegen env var HOST_PIN. */
function controleerPin(request: Request): void {
  const verwacht = process.env.HOST_PIN;
  if (!verwacht) {
    throw new QueueError(
      'HOST_PIN is niet ingesteld. Zet hem in .env.local of in de Vercel-omgevingsvariabelen.',
      503,
      'CONFIG'
    );
  }
  if (request.headers.get('x-host-pin') !== verwacht) {
    throw new QueueError('Onjuiste pincode.', 401, 'PIN');
  }
}

export async function POST(request: Request) {
  try {
    controleerPin(request);

    const body = await leesBody(request);
    const actie = tekst(body.actie);
    const requestId = tekst(body.requestId);

    switch (actie) {
      case 'login':
        break;
      case 'volgende':
        await hostVolgende(requestId);
        break;
      case 'skip':
        await hostSkip(requestId);
        break;
      case 'verwijder':
        await hostVerwijder(requestId);
        break;
      case 'herstel':
        await hostHerstel(requestId);
        break;
      case 'verrassing':
        return NextResponse.json({ ok: true, verrassing: await hostVerrassing() });
      default:
        throw new QueueError(`Onbekende actie: ${actie || '(leeg)'}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return foutRespons(error);
  }
}
