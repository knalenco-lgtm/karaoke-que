import { getRedis, SHOW_KEYS } from './redis';

/**
 * De actieve shows, voor het vaste instapadres `/go` (de QR-code op het bord): één Redis-set met
 * show-codes. De Showcomposer zet een show actief bij "Show maken" en "Terug naar vorige show" en
 * haalt de markering weg bij "Loskoppelen"; op /host kan het ook met een schakelaar. Een show die
 * verloopt (de sleutel `show:{code}` is weg) telt niet meer en wordt bij het lezen uit de set gehaald.
 */
export const ACTIEF_SLEUTEL = 'actieve-shows';

export interface ActieveShow {
  code: string;
  naam: string;
  /** Epoch ms. */
  aangemaakt: number;
}

export async function zetActief(code: string, actief: boolean): Promise<void> {
  const redis = getRedis();
  if (actief) await redis.sadd(ACTIEF_SLEUTEL, code);
  else await redis.srem(ACTIEF_SLEUTEL, code);
}

export async function isActief(code: string): Promise<boolean> {
  return (await getRedis().sismember(ACTIEF_SLEUTEL, code)) === 1;
}

/** De actieve shows die nog bestaan, nieuwste eerst; verlopen codes gaan uit de set. */
export async function actieveShows(): Promise<ActieveShow[]> {
  const redis = getRedis();
  const codes = (await redis.smembers(ACTIEF_SLEUTEL)).map(String);
  const uit: ActieveShow[] = [];
  for (const code of codes) {
    const h = await redis.hgetall<Record<string, unknown>>(SHOW_KEYS.show(code));
    if (!h || !h.naam) {
      await redis.srem(ACTIEF_SLEUTEL, code);
      continue;
    }
    uit.push({ code, naam: String(h.naam), aangemaakt: Number(h.aangemaakt ?? 0) });
  }
  return uit.sort((a, b) => b.aangemaakt - a.aangemaakt);
}
