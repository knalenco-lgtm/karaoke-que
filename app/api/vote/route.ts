import { NextResponse } from 'next/server';
import { stem } from '@/lib/queue';
import { foutRespons, leesBody, tekst } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await leesBody(request);
    const resultaat = await stem(tekst(body.requestId), tekst(body.deviceId));
    return NextResponse.json({ ok: true, ...resultaat });
  } catch (error) {
    return foutRespons(error);
  }
}
