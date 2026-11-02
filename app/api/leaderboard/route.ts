import { NextResponse } from 'next/server';
import { leesLeaderboard } from '@/lib/queue';
import { foutRespons } from '@/lib/api';
import { codeUit } from '@/lib/shows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Alle scores van de avond, hoogste eerst (de Speler na een herstart, de leaderboardpagina). */
export async function GET(request: Request) {
  try {
    return NextResponse.json({ leaderboard: await leesLeaderboard(codeUit(request)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return foutRespons(error);
  }
}
