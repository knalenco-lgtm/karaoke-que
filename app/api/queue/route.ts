import { NextResponse } from 'next/server';
import { leesWachtrij } from '@/lib/queue';
import { foutRespons } from '@/lib/api';
import { codeUit } from '@/lib/shows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const deviceId = new URL(request.url).searchParams.get('deviceId');
    const data = await leesWachtrij(codeUit(request), deviceId || null);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return foutRespons(error);
  }
}
