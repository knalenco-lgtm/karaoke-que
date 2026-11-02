import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getRedis, SHOW_KEYS } from './redis';
import { QueueError, SHOW_TTL_SEC } from './queue';
import type { ShowInfo } from './types';

/**
 * Shows (fase 13 van de Showcomposer): elke karaokeavond heeft een eigen code, zodat twee hosts
 * op één avond elk een eigen wachtrij hebben. De host maakt een show met de pincode; de show
 * geeft een Speler-token waarmee de Knal Speler (en de Showcomposer) host-acties mag doen,
 * zonder dat de pincode in een speelpakket hoeft. Een show verloopt na twee dagen.
 */

/** 31 tekens zonder 0, O, 1, I en L, zoals de codes van de Knal Speler. */
const TEKENS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTE = 5;

export function nieuweCode(): string {
  const b = randomBytes(CODE_LENGTE);
  return Array.from(b, (x) => TEKENS[x % TEKENS.length]).join('');
}

/** Hoofdletters, zonder spaties en streepjes; alleen geldige tekens. */
export function normaliseerCode(ruw: unknown): string {
  const c = String(ruw ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (c.length < 3 || c.length > 12 || ![...c].every((t) => TEKENS.includes(t))) {
    throw new QueueError('Geen geldige show-code. Scan de QR-code van de avond.', 400, 'CODE');
  }
  return c;
}

export async function maakShow(input: { naam: unknown; code?: unknown }): Promise<ShowInfo & { spelerToken: string }> {
  const naam = String(input.naam ?? '').trim().slice(0, 80) || 'Karaoke';
  const redis = getRedis();
  const spelerToken = randomBytes(24).toString('base64url');
  // Een eigen code mag (bijvoorbeeld opnieuw aanmaken na twee dagen); anders een nieuwe.
  for (let poging = 0; poging < 8; poging++) {
    const code = input.code ? normaliseerCode(input.code) : nieuweCode();
    const gezet = await redis.hsetnx(SHOW_KEYS.show(code), 'naam', naam);
    if (!gezet) {
      if (input.code) throw new QueueError('Deze show-code bestaat al.', 409, 'BESTAAT');
      continue;
    }
    await redis.hset(SHOW_KEYS.show(code), { aangemaakt: Date.now(), spelerToken });
    await redis.expire(SHOW_KEYS.show(code), SHOW_TTL_SEC);
    return { code, naam, spelerToken };
  }
  throw new QueueError('Geen vrije show-code gevonden. Probeer het nog eens.', 503);
}

export async function showBestaat(code: string): Promise<boolean> {
  return (await getRedis().exists(SHOW_KEYS.show(code))) === 1;
}

/** De show twee dagen langer laten staan (de host gebruikt hem nog). */
export async function verleng(code: string): Promise<void> {
  await getRedis().expire(SHOW_KEYS.show(code), SHOW_TTL_SEC);
}

function gelijk(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function pinKlopt(request: Request): boolean {
  const verwacht = process.env.HOST_PIN;
  if (!verwacht) {
    throw new QueueError('HOST_PIN is niet ingesteld. Zet hem in .env.local of in de Vercel-omgevingsvariabelen.', 503, 'CONFIG');
  }
  return gelijk(request.headers.get('x-host-pin') ?? '', verwacht);
}

/** Host-acties mogen met de pincode, of met het Speler-token van deze show. */
export async function controleerHost(request: Request, code: string): Promise<void> {
  if (pinKlopt(request)) return;
  const kop = request.headers.get('authorization') ?? '';
  const token = kop.startsWith('Bearer ') ? kop.slice(7).trim() : '';
  if (token) {
    const opgeslagen = await getRedis().hget<string>(SHOW_KEYS.show(code), 'spelerToken');
    if (opgeslagen && gelijk(token, String(opgeslagen))) return;
    throw new QueueError('Het Speler-token klopt niet voor deze show.', 401, 'TOKEN');
  }
  throw new QueueError('Onjuiste pincode.', 401, 'PIN');
}

/** De show-code uit `?s=` of uit de body. */
export function codeUit(request: Request, body?: Record<string, unknown>): string {
  const q = new URL(request.url).searchParams.get('s');
  return normaliseerCode(q ?? body?.show);
}
