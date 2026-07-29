import { getRedis, KEYS } from './redis';
import { getSongById } from './catalog';
import type { CheckinPrompt, KaraokeRequest, QueueEntry, QueueResponse, RequestStatus } from './types';
import {
  CHECKIN_INTERVAL_MS,
  CHECKIN_RESPIJT_MS,
  CHECKIN_VRIJE_POSITIES,
  MAX_AANVRAGEN_PER_DEVICE,
  MAX_GEMISTE_CHECKINS,
} from './constants';

/** Bewaartermijn van afgeronde/verwijderde aanvragen (alleen nog voor debug). */
const ARCHIEF_TTL_SEC = 24 * 60 * 60;

/** Fout met een nette Nederlandse melding die 1-op-1 naar de client gaat. */
export class QueueError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

// ---------------------------------------------------------------------------
// Lezen & serialiseren
// ---------------------------------------------------------------------------

/**
 * Upstash parst hash-waarden automatisch als JSON, dus een titel als "1985"
 * komt terug als number. Alles wordt daarom expliciet teruggedwongen.
 */
function parseRequest(id: string, raw: Record<string, unknown> | null): KaraokeRequest | null {
  if (!raw || Object.keys(raw).length === 0) return null;
  const status = String(raw.status ?? '') as RequestStatus;
  if (!['queued', 'paused', 'done', 'removed'].includes(status)) return null;

  return {
    id,
    songId: String(raw.songId ?? ''),
    titel: String(raw.titel ?? ''),
    artiest: String(raw.artiest ?? ''),
    zangerNaam: String(raw.zangerNaam ?? ''),
    deviceId: String(raw.deviceId ?? ''),
    createdAt: Number(raw.createdAt ?? 0),
    status,
    lastConfirmedAt: Number(raw.lastConfirmedAt ?? raw.createdAt ?? 0),
    missedCheckins: Number(raw.missedCheckins ?? 0),
    skips: Number(raw.skips ?? 0),
  };
}

/**
 * Sorteervolgorde van de wachtrij:
 *  1. minst geskipt (door de host naar onderen gezet blijft onderaan)
 *  2. meeste stemmen
 *  3. wie het eerst aanvroeg
 */
function sorteer(a: QueueEntry, b: QueueEntry): number {
  if (a.skips !== b.skips) return a.skips - b.skips;
  if (a.stemmen !== b.stemmen) return b.stemmen - a.stemmen;
  return a.createdAt - b.createdAt;
}

interface LiveRequest {
  request: KaraokeRequest;
  stemmen: number;
  stemmers: string[];
}

/** Haalt alle levende aanvragen op, inclusief stemtellingen. */
async function leesLive(): Promise<LiveRequest[]> {
  const redis = getRedis();
  // Upstash parst set-leden als JSON, dus id "12" komt terug als number 12.
  // Overal expliciet terug naar string, anders falen vergelijkingen met de client.
  const ids = (await redis.smembers(KEYS.live)).map(String);
  if (ids.length === 0) return [];

  const pipe = redis.pipeline();
  for (const id of ids) {
    pipe.hgetall(KEYS.request(id));
    pipe.smembers(KEYS.votes(id));
  }
  const results = await pipe.exec();

  const live: LiveRequest[] = [];
  const wezen: string[] = [];

  ids.forEach((id, i) => {
    const raw = results[i * 2] as Record<string, unknown> | null;
    const stemmers = ((results[i * 2 + 1] as unknown[] | null) ?? []).map(String);
    const request = parseRequest(id, raw);

    if (!request || (request.status !== 'queued' && request.status !== 'paused')) {
      wezen.push(id);
      return;
    }
    live.push({ request, stemmen: stemmers.length, stemmers });
  });

  // Ids die niet meer bij een levende aanvraag horen uit de live-set halen.
  if (wezen.length > 0) await redis.srem(KEYS.live, ...wezen);

  return live;
}

function naarEntry(item: LiveRequest, deviceId: string | null): QueueEntry {
  const isMijn = deviceId !== null && item.request.deviceId === deviceId;
  return {
    id: item.request.id,
    songId: item.request.songId,
    titel: item.request.titel,
    artiest: item.request.artiest,
    zangerNaam: item.request.zangerNaam,
    createdAt: item.request.createdAt,
    status: item.request.status,
    stemmen: item.stemmen,
    skips: item.request.skips,
    missedCheckins: item.request.missedCheckins,
    isMijn,
    heeftGestemd: deviceId !== null && item.stemmers.includes(deviceId),
    magStemmen: deviceId !== null && !isMijn && !item.stemmers.includes(deviceId),
  };
}

// ---------------------------------------------------------------------------
// Check-in-sweep (draait bij elke queue-read, dus geen cron nodig)
// ---------------------------------------------------------------------------

interface SweepResultaat {
  live: LiveRequest[];
  /** requestId -> deadline waarop de aanvraag pauzeert */
  openstaandeCheckins: Map<string, number>;
}

/**
 * Werkt de check-in-status bij: wie te lang niet bevestigd heeft wordt
 * gepauzeerd, en bij de tweede keer definitief verwijderd.
 */
async function checkinSweep(live: LiveRequest[], nu: number): Promise<SweepResultaat> {
  const redis = getRedis();
  const openstaandeCheckins = new Map<string, number>();

  const gesorteerd = live
    .filter((i) => i.request.status === 'queued')
    .map((i) => ({ item: i, entry: naarEntry(i, null) }))
    .sort((a, b) => sorteer(a.entry, b.entry));

  const bewerkingen: Promise<unknown>[] = [];
  let gewijzigd = false;

  gesorteerd.forEach(({ item }, index) => {
    const positie = index + 1;
    const req = item.request;

    // Bovenaan de lijst of nog geen kwartier in de rij: geen check-in.
    if (positie <= CHECKIN_VRIJE_POSITIES || nu - req.createdAt < CHECKIN_INTERVAL_MS) {
      // Klok bijhouden zolang je vrijgesteld bent, anders verval je meteen
      // zodra je door nieuwe stemmen weer naar beneden zakt. Alleen schrijven
      // als het echt scheelt, om onnodige writes bij elke poll te voorkomen.
      if (nu - req.lastConfirmedAt > CHECKIN_INTERVAL_MS / 2) {
        req.lastConfirmedAt = nu;
        bewerkingen.push(redis.hset(KEYS.request(req.id), { lastConfirmedAt: nu }));
      }
      return;
    }

    const verstreken = nu - req.lastConfirmedAt;
    if (verstreken < CHECKIN_INTERVAL_MS) return;

    const vervaltOp = req.lastConfirmedAt + CHECKIN_INTERVAL_MS + CHECKIN_RESPIJT_MS;

    if (nu < vervaltOp) {
      openstaandeCheckins.set(req.id, vervaltOp);
      return;
    }

    // Respijttijd voorbij zonder bevestiging.
    gewijzigd = true;
    const gemist = req.missedCheckins + 1;
    req.missedCheckins = gemist;

    if (gemist >= MAX_GEMISTE_CHECKINS) {
      req.status = 'removed';
      bewerkingen.push(archiveer(req.id, req.deviceId, 'removed', gemist));
    } else {
      req.status = 'paused';
      req.lastConfirmedAt = nu;
      bewerkingen.push(
        redis.hset(KEYS.request(req.id), {
          status: 'paused',
          missedCheckins: gemist,
          lastConfirmedAt: nu,
        })
      );
    }
  });

  await Promise.all(bewerkingen);

  return {
    live: gewijzigd ? live.filter((i) => i.request.status !== 'removed') : live,
    openstaandeCheckins,
  };
}

/** Haalt een aanvraag uit de actieve structuren en zet hem op de archief-TTL. */
async function archiveer(
  requestId: string,
  deviceId: string,
  status: 'done' | 'removed',
  missedCheckins?: number
): Promise<void> {
  const redis = getRedis();
  await Promise.all([
    redis.hset(KEYS.request(requestId), {
      status,
      ...(missedCheckins !== undefined ? { missedCheckins } : {}),
    }),
    redis.srem(KEYS.live, requestId),
    redis.srem(KEYS.deviceRequests(deviceId), requestId),
    redis.del(KEYS.votes(requestId)),
    redis.expire(KEYS.request(requestId), ARCHIEF_TTL_SEC),
  ]);
  vergeetSnapshot();
}

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Korte cache van de rij-toestand, gedeeld door alle verzoeken die dezelfde
 * serverless-instantie raken.
 *
 * Zonder dit doet elke gast ~900 Redis-reads per uur; met twintig telefoons is
 * de gratis Upstash-limiet (10.000 commando's per dag) binnen een half uur op.
 * De momentopname is device-onafhankelijk — "is dit van mij", "heb ik gestemd"
 * en de check-in worden er per verzoek uit afgeleid — dus hij is voor iedereen
 * herbruikbaar. Elke wijziging gooit hem meteen weg, zodat je je eigen actie
 * altijd direct terugziet.
 */
const SNAPSHOT_TTL_MS = 3000;

let snapshot: { tijd: number; live: LiveRequest[]; checkins: Map<string, number> } | null = null;

function vergeetSnapshot(): void {
  snapshot = null;
}

async function huidigeToestand(nu: number) {
  if (snapshot && nu - snapshot.tijd < SNAPSHOT_TTL_MS) {
    return { live: snapshot.live, openstaandeCheckins: snapshot.checkins };
  }
  const resultaat = await checkinSweep(await leesLive(), nu);
  snapshot = { tijd: nu, live: resultaat.live, checkins: resultaat.openstaandeCheckins };
  return resultaat;
}

export async function leesWachtrij(deviceId: string | null): Promise<QueueResponse> {
  const nu = Date.now();
  const { live, openstaandeCheckins } = await huidigeToestand(nu);

  const wachtrij = live
    .filter((i) => i.request.status === 'queued')
    .map((i) => naarEntry(i, deviceId))
    .sort(sorteer);

  const gepauzeerd = live
    .filter((i) => i.request.status === 'paused')
    .map((i) => naarEntry(i, deviceId))
    .sort((a, b) => a.createdAt - b.createdAt);

  let checkin: CheckinPrompt | null = null;
  if (deviceId) {
    for (const [requestId, vervaltOp] of openstaandeCheckins) {
      const index = wachtrij.findIndex((e) => e.id === requestId);
      if (index === -1 || !wachtrij[index].isMijn) continue;
      // Bij meerdere: de meest urgente eerst.
      if (checkin === null || vervaltOp < checkin.vervaltOp) {
        checkin = { requestId, titel: wachtrij[index].titel, positie: index + 1, vervaltOp };
      }
    }
  }

  const eigenAanvragen = deviceId
    ? wachtrij.filter((e) => e.isMijn).length + gepauzeerd.filter((e) => e.isMijn).length
    : 0;

  return {
    nuAanDeBeurt: wachtrij[0] ?? null,
    wachtrij,
    gepauzeerd,
    checkin,
    eigenAanvragen,
    serverTijd: nu,
  };
}

export async function maakAanvraag(input: {
  songId: string;
  zangerNaam: string;
  deviceId: string;
}): Promise<{ id: string }> {
  const redis = getRedis();

  const zangerNaam = input.zangerNaam.trim().slice(0, 40);
  if (zangerNaam.length < 1) throw new QueueError('Vul eerst je naam in.');
  if (!input.deviceId) throw new QueueError('Onbekend apparaat — herlaad de pagina.');

  // Alleen nummers uit de KaraFun-catalogus: vrije invoer bestaat niet.
  const song = getSongById(input.songId);
  if (!song) {
    throw new QueueError('Dit nummer staat niet in de KaraFun-catalogus.', 404);
  }

  const live = await leesLive();

  if (live.some((i) => i.request.songId === song.id)) {
    throw new QueueError('Dit nummer staat al in de lijst — stem erop!', 409, 'DUBBEL');
  }

  const eigen = live.filter((i) => i.request.deviceId === input.deviceId).length;
  if (eigen >= MAX_AANVRAGEN_PER_DEVICE) {
    throw new QueueError(
      `Je hebt al ${MAX_AANVRAGEN_PER_DEVICE} nummers openstaan. Wacht tot er eentje geweest is.`,
      409,
      'LIMIET'
    );
  }

  const nu = Date.now();
  const id = String(await redis.incr(KEYS.counter));
  vergeetSnapshot();

  await redis.hset(KEYS.request(id), {
    songId: song.id,
    titel: song.titel,
    artiest: song.artiest,
    zangerNaam,
    deviceId: input.deviceId,
    createdAt: nu,
    status: 'queued',
    lastConfirmedAt: nu,
    missedCheckins: 0,
    skips: 0,
  });
  await Promise.all([
    redis.sadd(KEYS.live, id),
    redis.sadd(KEYS.deviceRequests(input.deviceId), id),
  ]);

  return { id };
}

async function haalOp(requestId: string): Promise<KaraokeRequest> {
  const raw = await getRedis().hgetall(KEYS.request(requestId));
  const request = parseRequest(requestId, raw as Record<string, unknown> | null);
  if (!request) throw new QueueError('Deze aanvraag bestaat niet (meer).', 404);
  return request;
}

export async function stem(requestId: string, deviceId: string): Promise<{ stemmen: number }> {
  const redis = getRedis();
  const request = await haalOp(requestId);

  if (request.status !== 'queued') {
    throw new QueueError('Op dit nummer kan niet (meer) gestemd worden.', 409);
  }
  if (request.deviceId === deviceId) {
    throw new QueueError('Je kunt niet op je eigen aanvraag stemmen.', 403);
  }

  const nieuw = await redis.sadd(KEYS.votes(requestId), deviceId);
  if (nieuw === 0) throw new QueueError('Je hebt hier al op gestemd.', 409, 'AL_GESTEMD');
  vergeetSnapshot();

  return { stemmen: await redis.scard(KEYS.votes(requestId)) };
}

export async function bevestigCheckin(requestId: string, deviceId: string): Promise<void> {
  const request = await haalOp(requestId);
  if (request.deviceId !== deviceId) {
    throw new QueueError('Dit is niet jouw aanvraag.', 403);
  }
  if (request.status !== 'queued') {
    throw new QueueError('Deze aanvraag staat niet meer in de wachtrij.', 409);
  }
  await getRedis().hset(KEYS.request(requestId), { lastConfirmedAt: Date.now() });
  vergeetSnapshot();
}

export async function trekIn(requestId: string, deviceId: string): Promise<void> {
  const request = await haalOp(requestId);
  if (request.deviceId !== deviceId) {
    throw new QueueError('Dit is niet jouw aanvraag.', 403);
  }
  if (request.status !== 'queued' && request.status !== 'paused') {
    throw new QueueError('Deze aanvraag staat niet meer in de wachtrij.', 409);
  }
  await archiveer(requestId, request.deviceId, 'removed');
}

/** "Ik ben er weer!" — gepauzeerde aanvraag terug in de rij, stemmen blijven staan. */
export async function hervat(requestId: string, deviceId: string | null): Promise<void> {
  const request = await haalOp(requestId);
  if (deviceId !== null && request.deviceId !== deviceId) {
    throw new QueueError('Dit is niet jouw aanvraag.', 403);
  }
  if (request.status !== 'paused') {
    throw new QueueError('Deze aanvraag is niet gepauzeerd.', 409);
  }

  const nu = Date.now();
  const redis = getRedis();
  await redis.hset(KEYS.request(requestId), {
    status: 'queued',
    createdAt: nu,
    lastConfirmedAt: nu,
  });
  await redis.sadd(KEYS.live, requestId);
  vergeetSnapshot();
}

// ---------------------------------------------------------------------------
// Host-acties
// ---------------------------------------------------------------------------

/** Markeert #1 als gezongen; de rest schuift op. */
export async function hostVolgende(requestId: string): Promise<void> {
  // Afvinken moet op de echte volgorde gebeuren, niet op een momentopname.
  vergeetSnapshot();
  const { wachtrij } = await leesWachtrij(null);
  if (wachtrij.length === 0) throw new QueueError('De wachtrij is leeg.', 409);
  if (wachtrij[0].id !== requestId) {
    throw new QueueError('Alleen het nummer dat aan de beurt is kan afgevinkt worden.', 409);
  }
  const request = await haalOp(requestId);
  await archiveer(requestId, request.deviceId, 'done');
}

/** Zet een aanvraag onderaan de lijst zonder hem te verwijderen. */
export async function hostSkip(requestId: string): Promise<void> {
  const request = await haalOp(requestId);
  if (request.status !== 'queued') {
    throw new QueueError('Deze aanvraag staat niet in de wachtrij.', 409);
  }
  const nu = Date.now();
  await getRedis().hset(KEYS.request(requestId), {
    skips: request.skips + 1,
    createdAt: nu,
    lastConfirmedAt: nu,
  });
  vergeetSnapshot();
}

export async function hostVerwijder(requestId: string): Promise<void> {
  const request = await haalOp(requestId);
  await archiveer(requestId, request.deviceId, 'removed');
}

/** Host zet een gepauzeerde aanvraag terug in de rij. */
export async function hostHerstel(requestId: string): Promise<void> {
  await hervat(requestId, null);
}
