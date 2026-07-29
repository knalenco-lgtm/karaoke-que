import { NextResponse } from 'next/server';
import { zoek } from '@/lib/catalog';
import { foutRespons } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    return NextResponse.json({ resultaten: zoek(q) });
  } catch (error) {
    return foutRespons(error);
  }
}
