import { NextResponse } from 'next/server';
import { foutRespons, leesBody } from '@/lib/api';
import { QueueError } from '@/lib/queue';
import { codeUit, controleerHost, showBestaat } from '@/lib/shows';
import { actieveShows, zetActief } from '@/lib/actief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** De actieve shows (naam, code, aanmaaktijd), voor de codepagina achter /go. */
export async function GET() {
  try {
    return NextResponse.json({ shows: await actieveShows() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return foutRespons(error);
  }
}

/** Een show actief zetten of niet (`{show, actief}`), met de pincode of het Speler-token van die show. */
export async function POST(request: Request) {
  try {
    const body = await leesBody(request);
    const code = codeUit(request, body);
    await controleerHost(request, code);
    const actief = body.actief !== false;
    if (actief && !(await showBestaat(code))) {
      throw new QueueError('Deze show-code bestaat niet (meer).', 404, 'SHOW');
    }
    await zetActief(code, actief);
    return NextResponse.json({ ok: true, code, actief });
  } catch (error) {
    return foutRespons(error);
  }
}
