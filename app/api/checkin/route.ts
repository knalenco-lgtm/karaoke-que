import { NextResponse } from 'next/server';
import { bevestigCheckin, hervat } from '@/lib/queue';
import { foutRespons, leesBody, tekst } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `bevestig` — "ja ik ben er nog": reset de check-in-timer.
 * `hervat`   — "ik ben er weer!": haalt een gepauzeerde aanvraag terug in de rij.
 */
export async function POST(request: Request) {
  try {
    const body = await leesBody(request);
    const requestId = tekst(body.requestId);
    const deviceId = tekst(body.deviceId);

    if (tekst(body.actie) === 'hervat') {
      await hervat(requestId, deviceId);
    } else {
      await bevestigCheckin(requestId, deviceId);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return foutRespons(error);
  }
}
