import { getRedis, keys, SHOW_KEYS, type Keys } from './redis';
import { getSongById } from './catalog';
import type { KaraokeRequest, QueueEntry, QueueResponse, RequestStatus, ScoreOpbouw, ShowInfo, Uitslag } from './types';
import {
  maxAanvragenBij,
  MAX_EXTRA_ZANGER_LENGTE,
  MAX_EXTRA_ZANGERS,
  MAX_ZANGER_LENGTE,
  VERRASSING_BESCHERMDE_TOP,
  VERRASSING_MIN_RIJ,
} from './constants';

/** Bewaartermijn van afgeronde/verwijderde aanvragen (alleen nog voor debug). */
const ARCHIEF_TTL_SEC = 24 * 60 * 60;
/** Een show (en alles wat erbij hoort) blijft twee dagen staan. */
export const SHOW_TTL_SEC = 48 * 60 * 60;
/** Hoeveel rijen het leaderboard geeft. */
const LEADERBOARD = 10;
/** Levensduur van het slot rond een host-klik. */
const SLOT_MS = 10_000;

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
 * Leest het veld `extraSingers`. Upstash geeft het terug als array (auto-parse)
 * of als JSON-string; aanvragen van vóór de duet-functie hebben het veld niet.
 */
function parseExtraSingers(ruw: unknown): string[] {
  let waarde = ruw;
  if (typeof waarde === 'string') {
    if (!waarde.trim()) return [];
    try {
      waarde = JSON.parse(waarde);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(waarde)) return [];
  return waarde
    .map((naam) => String(naam ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_EXTRA_ZANGERS);
}

function parseRequest(id: string, raw: Record<string, unknown> | null): KaraokeRequest | null {
  if (!raw || Object.keys(raw).length === 0) return null;
  // Een aanvraag die vóór fase 13.8 gepauzeerd was (check-in gemist), komt gewoon terug in de rij.
  const status = (raw.status === 'paused' ? 'queued' : String(raw.status ?? '')) as RequestStatus;
  if (!['queued', 'playing', 'done', 'removed'].includes(status)) return null;

  return {
    id,
    songId: String(raw.songId ?? ''),
    titel: String(raw.titel ?? ''),
    artiest: String(raw.artiest ?? ''),
    zangerNaam: String(raw.zangerNaam ?? ''),
    extraSingers: parseExtraSingers(raw.extraSingers),
    deviceId: String(raw.deviceId ?? ''),
    createdAt: Number(raw.createdAt ?? 0),
    arrivalSeq: Number(raw.arrivalSeq ?? raw.createdAt ?? 0),
    status,
    verrassingOp: Number(raw.verrassingOp ?? 0),
    viaHost: raw.viaHost === 1 || raw.viaHost === '1' || raw.viaHost === true,
  };
}

/** De wachtrij is puur op volgorde van binnenkomst. */
function opVolgorde(a: KaraokeRequest, b: KaraokeRequest): number {
  return a.arrivalSeq - b.arrivalSeq;
}

/** Een uitslag zoals hij in Redis staat (op de hash van de aanvraag). */
interface Gescoord {
  id: string;
  songId: string;
  titel: string;
  artiest: string;
  zangerNaam: string;
  extraSingers: string[];
  deviceId: string;
  score: number;
  labels: string[];
  tijd: number;
  opbouw: ScoreOpbouw | null;
}

/** De opbouw van een score zoals de Speler hem meestuurt; null als hij ontbreekt of niet klopt. */
function parseOpbouw(ruw: unknown): ScoreOpbouw | null {
  let w = ruw;
  if (typeof w === 'string') {
    try {
      w = JSON.parse(w);
    } catch {
      return null;
    }
  }
  if (!w || typeof w !== 'object') return null;
  const o = w as Record<string, unknown>;
  const getal = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);
  if (typeof o.meter !== 'number') return null;
  return { meter: getal(o.meter), klassieker: getal(o.klassieker), herhaling: getal(o.herhaling), bonus: getal(o.bonus) };
}

interface Toestand {
  show: ShowInfo;
  /** Alle levende aanvragen: queued en playing. */
  requests: KaraokeRequest[];
  /** De optredens met een score van de Knal-meter, hoogste eerst. */
  uitslagen: Gescoord[];
}

function parseLijst(ruw: unknown): string[] {
  let w = ruw;
  if (typeof w === 'string') {
    try {
      w = JSON.parse(w);
    } catch {
      return [];
    }
  }
  return Array.isArray(w) ? w.map((x) => String(x ?? '')).filter(Boolean) : [];
}

function parseGescoord(id: string, raw: Record<string, unknown> | null): Gescoord | null {
  if (!raw || raw.score === undefined || raw.score === null) return null;
  return {
    id,
    songId: String(raw.songId ?? ''),
    titel: String(raw.titel ?? ''),
    artiest: String(raw.artiest ?? ''),
    zangerNaam: String(raw.zangerNaam ?? ''),
    extraSingers: parseExtraSingers(raw.extraSingers),
    deviceId: String(raw.deviceId ?? ''),
    score: Number(raw.score),
    labels: parseLijst(raw.labels),
    tijd: Number(raw.gescoordOp ?? 0),
    opbouw: parseOpbouw(raw.opbouw),
  };
}

/** Hoogste score eerst, bij gelijke score wie het eerst zong. */
function opScore(a: Gescoord, b: Gescoord): number {
  return b.score - a.score || a.tijd - b.tijd;
}

/** Haalt alles op wat voor één beeld van de wachtrij nodig is. Gooit bij een onbekende code. */
async function leesToestand(code: string): Promise<Toestand> {
  const redis = getRedis();
  const K = keys(code);
  // Upstash parst set-leden als JSON, dus id "12" komt terug als number 12.
  const [idsRuw, gescoordRuw] = await Promise.all([redis.smembers(K.live), redis.smembers(K.gescoord)]);
  const ids = idsRuw.map(String);
  const gescoordIds = gescoordRuw.map(String);

  const pipe = redis.pipeline();
  pipe.hgetall(SHOW_KEYS.show(code));
  for (const id of ids) pipe.hgetall(K.request(id));
  for (const id of gescoordIds) pipe.hgetall(K.request(id));
  const results = await pipe.exec();

  const showRuw = (results[0] as Record<string, unknown> | null) ?? {};
  if (Object.keys(showRuw).length === 0) {
    throw new QueueError('Deze show-code bestaat niet (meer). Vraag de host om de juiste code.', 404, 'SHOW');
  }
  const show: ShowInfo = { code, naam: String(showRuw.naam ?? ''), scoresAan: Number(showRuw.scoresUit ?? 0) !== 1 };

  const requests: KaraokeRequest[] = [];
  const wezen: string[] = [];
  const VAST = 1;

  ids.forEach((id, i) => {
    const request = parseRequest(id, results[i + VAST] as Record<string, unknown> | null);
    if (!request || !['queued', 'playing'].includes(request.status)) {
      wezen.push(id);
      return;
    }
    requests.push(request);
  });

  const uitslagen: Gescoord[] = [];
  const wezenScore: string[] = [];
  gescoordIds.forEach((id, i) => {
    const g = parseGescoord(id, results[i + VAST + ids.length] as Record<string, unknown> | null);
    if (g) uitslagen.push(g);
    else wezenScore.push(id);
  });
  uitslagen.sort(opScore);

  if (wezen.length > 0) await redis.srem(K.live, ...wezen);
  if (wezenScore.length > 0) await redis.srem(K.gescoord, ...wezenScore);

  return { show, requests, uitslagen };
}

function naarUitslag(g: Gescoord, deviceId: string | null): Uitslag {
  return {
    id: g.id,
    songId: g.songId,
    titel: g.titel,
    artiest: g.artiest,
    zangerNaam: g.zangerNaam,
    extraSingers: g.extraSingers,
    score: g.score,
    labels: g.labels,
    tijd: g.tijd,
    opbouw: g.opbouw ?? null,
    isMijn: deviceId !== null && g.deviceId === deviceId,
  };
}

function naarEntry(request: KaraokeRequest, deviceId: string | null): QueueEntry {
  const isMijn = deviceId !== null && request.deviceId === deviceId;
  return {
    id: request.id,
    songId: request.songId,
    titel: request.titel,
    artiest: request.artiest,
    zangerNaam: request.zangerNaam,
    extraSingers: request.extraSingers,
    createdAt: request.createdAt,
    arrivalSeq: request.arrivalSeq,
    status: request.status,
    verrassingOp: request.verrassingOp,
    viaHost: request.viaHost,
    isMijn,
  };
}

/** Haalt een aanvraag uit de actieve structuren en zet hem op de archief-TTL. */
async function archiveer(code: string, requestId: string, deviceId: string, status: 'done' | 'removed', snapshotWeg = true): Promise<void> {
  const redis = getRedis();
  const K = keys(code);
  await Promise.all([
    redis.hset(K.request(requestId), { status }),
    redis.srem(K.live, requestId),
    redis.srem(K.deviceRequests(deviceId), requestId),
    redis.expire(K.request(requestId), ARCHIEF_TTL_SEC),
  ]);
  if (snapshotWeg) await vergeetSnapshot(code);
}

// ---------------------------------------------------------------------------
// Servercache
// ---------------------------------------------------------------------------

/**
 * Korte cache van de rij-toestand, gedeeld door alle verzoeken die dezelfde
 * serverless-instantie raken. Zonder dit is de gratis Upstash-limiet met een
 * stuk of twintig telefoons binnen een half uur op. De momentopname is
 * device-onafhankelijk, dus voor iedereen herbruikbaar; elke wijziging gooit
 * hem meteen weg zodat je je eigen actie altijd direct terugziet.
 */
const SNAPSHOT_TTL_MS = 3000;

const snapshots = new Map<string, { tijd: number; toestand: Toestand }>();

/**
 * Na elke wijziging: de momentopname in het geheugen én in Redis weg, zodat de volgende lezer
 * (ook op een andere serverless-instantie) de rij opnieuw opbouwt. Eén commando.
 */
async function vergeetSnapshot(code: string): Promise<void> {
  snapshots.delete(code);
  lezingen.delete(code);
  await getRedis().del(keys(code).snapshot);
}

function naarJson(t: Toestand): string {
  return JSON.stringify(t);
}

function uitJson(ruw: unknown): Toestand | null {
  let j = ruw;
  if (typeof j === 'string') {
    try {
      j = JSON.parse(j);
    } catch {
      return null;
    }
  }
  if (!j || typeof j !== 'object' || !('requests' in j)) return null;
  const t = j as Toestand & { stemmen?: unknown; ronde?: unknown; winnaarVorigeRonde?: unknown };
  // Een momentopname van vóór fase 13.8 heeft nog stemmen en een rondenummer: die vallen weg.
  return { show: t.show, requests: (t.requests ?? []).filter((r) => r.status === 'queued' || r.status === 'playing'), uitslagen: t.uitslagen ?? [] };
}

/**
 * De toestand van een show: uit het geheugen (3 s), anders de JSON-momentopname uit Redis
 * (één commando), en pas als die er niet is de losse sleutels (één per aanvraag). Zo kost een
 * avond met twintig telefoons die elke 4 s pollen ruim onder de 10.000 commando's.
 */
async function huidigeToestand(code: string, nu: number): Promise<Toestand> {
  const vers = snapshots.get(code);
  if (vers && nu - vers.tijd < SNAPSHOT_TTL_MS) return vers.toestand;
  // Komen er tegelijk twintig verzoeken binnen terwijl het geheugen verlopen is, dan wachten ze
  // allemaal op dezelfde lezing in plaats van elk Redis te vragen.
  const bezig = lezingen.get(code);
  if (bezig) return bezig;
  const p = toestandLezen(code, nu).finally(() => lezingen.delete(code));
  lezingen.set(code, p);
  return p;
}

const lezingen = new Map<string, Promise<Toestand>>();

async function toestandLezen(code: string, nu: number): Promise<Toestand> {
  const redis = getRedis();
  const K = keys(code);
  let toestand = uitJson(await redis.get(K.snapshot));
  if (!toestand) {
    toestand = await leesToestand(code);
    await redis.set(K.snapshot, naarJson(toestand), { ex: SHOW_TTL_SEC });
  }
  snapshots.set(code, { tijd: nu, toestand });
  return toestand;
}

/** Zorgt dat een host-klik nooit half uitgevoerd kan raken. */
async function metSlot<T>(K: Keys, naam: string, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  const verkregen = await redis.set(K.slot(naam), '1', { nx: true, px: SLOT_MS });
  if (verkregen !== 'OK') {
    throw new QueueError('Er wordt net iets anders gestart. Probeer het zo nog eens.', 409, 'BEZIG');
  }
  try {
    return await fn();
  } finally {
    await redis.del(K.slot(naam));
  }
}

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

export async function leesWachtrij(code: string, deviceId: string | null): Promise<QueueResponse> {
  const nu = Date.now();
  const toestand = await huidigeToestand(code, nu);
  const maakEntry = (r: KaraokeRequest) => naarEntry(r, deviceId);

  const wachtrij = toestand.requests
    .filter((r) => r.status === 'queued')
    .sort(opVolgorde)
    .map(maakEntry);

  const spelend = toestand.requests.find((r) => r.status === 'playing');

  // Een momentopname van vóór de schakelaar kent `scoresAan` niet: dan aan.
  const scoresAan = toestand.show.scoresAan !== false;
  const eigenAanvragen = deviceId
    ? toestand.requests.filter((r) => r.deviceId === deviceId).length
    : 0;

  return {
    show: { ...toestand.show, scoresAan },
    nuAanDeBeurt: spelend ? maakEntry(spelend) : null,
    wachtrij,
    eigenAanvragen,
    maxAanvragen: maxAanvragenBij(wachtrij.length),
    leaderboard: scoresAan ? toestand.uitslagen.slice(0, LEADERBOARD).map((g) => naarUitslag(g, deviceId)) : [],
    mijnUitslagen: scoresAan && deviceId
      ? toestand.uitslagen
          .filter((g) => g.deviceId === deviceId)
          .sort((a, b) => b.tijd - a.tijd)
          .map((g) => naarUitslag(g, deviceId))
      : [],
    serverTijd: nu,
  };
}

/** Het leaderboard van een show, ook voor de Speler na een herstart. */
export async function leesLeaderboard(code: string): Promise<Uitslag[]> {
  const toestand = await huidigeToestand(code, Date.now());
  return toestand.uitslagen.map((g) => naarUitslag(g, null));
}

/**
 * Schoont de extra zangers op: lege namen eruit, elk afgekapt op de maximale
 * lengte, en niet meer dan er mogen.
 */
function normaliseerExtraZangers(ruw: unknown): string[] {
  if (ruw === undefined || ruw === null) return [];
  if (!Array.isArray(ruw)) {
    throw new QueueError('Ongeldige lijst met extra zangers.');
  }

  const namen = ruw
    .map((naam) => String(naam ?? '').trim().slice(0, MAX_EXTRA_ZANGER_LENGTE))
    .filter(Boolean);

  if (namen.length > MAX_EXTRA_ZANGERS) {
    throw new QueueError(
      `Maximaal ${MAX_EXTRA_ZANGERS + 1} zangers per nummer.`,
      400,
      'TE_VEEL_ZANGERS'
    );
  }
  return namen;
}

export async function maakAanvraag(code: string, input: {
  songId: string;
  zangerNaam: string;
  extraSingers?: unknown;
  deviceId: string;
}): Promise<{ id: string }> {
  const redis = getRedis();
  const K = keys(code);

  const zangerNaam = input.zangerNaam.trim().slice(0, MAX_ZANGER_LENGTE);
  if (zangerNaam.length < 1) throw new QueueError('Vul eerst je naam in.');
  if (!input.deviceId) throw new QueueError('Onbekend apparaat. Herlaad de pagina.');

  const extraSingers = normaliseerExtraZangers(input.extraSingers);

  // Alleen nummers uit de KaraFun-catalogus: vrije invoer bestaat niet.
  const song = getSongById(input.songId);
  if (!song) {
    throw new QueueError('Dit nummer staat niet in de KaraFun-catalogus.', 404);
  }

  const { requests } = await leesToestand(code);

  if (requests.some((r) => r.songId === song.id)) {
    throw new QueueError('Dit nummer staat al in de rij (of wordt nu gezongen).', 409, 'DUBBEL');
  }

  // Hoe voller de rij, hoe krapper de limiet: zo komen er meer verschillende
  // mensen aan de beurt in plaats van steeds dezelfde.
  const rijLengte = requests.filter((r) => r.status === 'queued').length;
  const limiet = maxAanvragenBij(rijLengte);
  const eigen = requests.filter((r) => r.deviceId === input.deviceId).length;

  if (eigen >= limiet) {
    throw new QueueError(
      limiet === 1
        ? `Het is druk in de rij (${rijLengte} nummers), dus even één nummer per telefoon. Zodra jouw nummer geweest is, mag je weer.`
        : `Je hebt al ${limiet} nummers openstaan. Wacht tot er eentje geweest is.`,
      409,
      'LIMIET'
    );
  }

  const nu = Date.now();
  const [id, geteld] = await Promise.all([
    redis.incr(K.counter).then(String),
    redis.incr(K.seqCounter),
  ]);

  // Vangnet voor aanvragen van vóór arrivalSeq: die vallen terug op createdAt,
  // een epoch-ms en dus veel groter dan een verse teller. Zonder deze correctie
  // zou een nieuw nummer vóór de bestaande rij belanden.
  const hoogste = requests.reduce((max, r) => Math.max(max, r.arrivalSeq), 0);
  let arrivalSeq = geteld;
  if (arrivalSeq <= hoogste) {
    arrivalSeq = hoogste + 1;
    await redis.set(K.seqCounter, arrivalSeq);
  }

  await redis.hset(K.request(id), {
    songId: song.id,
    titel: song.titel,
    artiest: song.artiest,
    zangerNaam,
    extraSingers: JSON.stringify(extraSingers),
    deviceId: input.deviceId,
    createdAt: nu,
    arrivalSeq,
    status: 'queued',
    verrassingOp: 0,
  });
  // Alles van een show verloopt vanzelf na twee dagen.
  const pipe = redis.pipeline();
  pipe.sadd(K.live, id);
  pipe.sadd(K.deviceRequests(input.deviceId), id);
  pipe.expire(K.request(id), SHOW_TTL_SEC);
  pipe.expire(K.live, SHOW_TTL_SEC);
  pipe.expire(K.deviceRequests(input.deviceId), SHOW_TTL_SEC);
  pipe.expire(K.counter, SHOW_TTL_SEC);
  pipe.expire(K.seqCounter, SHOW_TTL_SEC);
  await pipe.exec();
  await vergeetSnapshot(code);

  return { id };
}

/** Het apparaat-id van aanvragen die de host zelf aanmeldt; geldt niet voor de limiet per telefoon. */
export const HOST_APPARAAT = 'host';

/**
 * De host meldt iemand aan (de Speler van de Showcomposer, "Nummer toevoegen"): zelfde catalogus en
 * dezelfde controle op dubbele nummers als een gast, maar zonder limiet per telefoon en met de
 * markering "via host". Achteraan, of met `volgende` direct onder het spelende nummer.
 */
export async function hostToevoegen(code: string, input: {
  songId: string;
  zangerNaam: string;
  extraSingers?: unknown;
  volgende?: boolean;
}): Promise<{ id: string; positie: number }> {
  const K = keys(code);
  const zangerNaam = input.zangerNaam.trim().slice(0, MAX_ZANGER_LENGTE);
  if (zangerNaam.length < 1) throw new QueueError('Vul de naam van de zanger in.');
  const extraSingers = normaliseerExtraZangers(input.extraSingers);
  const song = getSongById(input.songId);
  if (!song) throw new QueueError('Dit nummer staat niet in de KaraFun-catalogus.', 404);

  return metSlot(K, 'start', async () => {
    const redis = getRedis();
    await vergeetSnapshot(code);
    const { requests } = await leesToestand(code);
    if (requests.some((r) => r.songId === song.id)) {
      throw new QueueError('Dit nummer staat al in de rij (of wordt nu gezongen).', 409, 'DUBBEL');
    }
    const wachtrij = requests.filter((r) => r.status === 'queued').sort(opVolgorde);
    const nu = Date.now();
    const [id, geteld] = await Promise.all([redis.incr(K.counter).then(String), redis.incr(K.seqCounter)]);
    const hoogste = requests.reduce((max, r) => Math.max(max, r.arrivalSeq), 0);
    let arrivalSeq = geteld;
    if (arrivalSeq <= hoogste) {
      arrivalSeq = hoogste + 1;
      await redis.set(K.seqCounter, arrivalSeq);
    }
    const nieuw: KaraokeRequest = {
      id,
      songId: song.id,
      titel: song.titel,
      artiest: song.artiest,
      zangerNaam,
      extraSingers,
      deviceId: HOST_APPARAAT,
      createdAt: nu,
      arrivalSeq,
      status: 'queued',
      verrassingOp: 0,
      viaHost: true,
    };
    const pipe = redis.pipeline();
    pipe.hset(K.request(id), { ...nieuw, extraSingers: JSON.stringify(extraSingers), viaHost: 1 });
    // Als volgende: dezelfde volgnummers, met het nieuwe nummer vooraan.
    if (input.volgende && wachtrij.length > 0) {
      for (const { request, arrivalSeq: seq } of herverdeelVolgnummers([...wachtrij, nieuw], [nieuw, ...wachtrij])) {
        pipe.hset(K.request(request.id), { arrivalSeq: seq });
      }
    }
    pipe.sadd(K.live, id);
    pipe.expire(K.request(id), SHOW_TTL_SEC);
    pipe.expire(K.live, SHOW_TTL_SEC);
    pipe.expire(K.counter, SHOW_TTL_SEC);
    pipe.expire(K.seqCounter, SHOW_TTL_SEC);
    await pipe.exec();
    await vergeetSnapshot(code);
    return { id, positie: input.volgende ? 1 : wachtrij.length + 1 };
  });
}

/**
 * Een score uit het leaderboard halen (een testzanger; de Speler, 3 november 2026). De aanvraag zelf
 * verandert niet; nogmaals weghalen doet niets.
 */
export async function uitslagWeg(code: string, requestId: string): Promise<{ weg: boolean }> {
  const redis = getRedis();
  const K = keys(code);
  const weg = (await redis.srem(K.gescoord, requestId)) > 0;
  await redis.hdel(K.request(requestId), 'score', 'labels', 'gescoordOp', 'opbouw');
  await vergeetSnapshot(code);
  return { weg };
}

/** Scores aan of uit voor de hele show (de schakelaar op het presentatorscherm van de Speler). */
export async function hostScores(code: string, aan: boolean): Promise<{ scoresAan: boolean }> {
  await getRedis().hset(SHOW_KEYS.show(code), { scoresUit: aan ? 0 : 1 });
  await vergeetSnapshot(code);
  return { scoresAan: aan };
}

async function haalOp(code: string, requestId: string): Promise<KaraokeRequest> {
  const raw = await getRedis().hgetall(keys(code).request(requestId));
  const request = parseRequest(requestId, raw as Record<string, unknown> | null);
  if (!request) throw new QueueError('Deze aanvraag bestaat niet (meer).', 404);
  return request;
}

export async function trekIn(code: string, requestId: string, deviceId: string): Promise<void> {
  const request = await haalOp(code, requestId);
  if (request.deviceId !== deviceId) {
    throw new QueueError('Dit is niet jouw aanvraag.', 403);
  }
  if (request.status !== 'queued') {
    throw new QueueError('Deze aanvraag staat niet meer in de wachtrij.', 409);
  }
  await archiveer(code, requestId, request.deviceId, 'removed');
}

// ---------------------------------------------------------------------------
// Volgorde
// ---------------------------------------------------------------------------

/**
 * Deelt de bestaande volgnummers opnieuw uit volgens de nieuwe volgorde. Zo
 * blijven alle nummers uniek en blijft de teller kloppen, terwijl de rij precies
 * de gewenste volgorde krijgt.
 */
function herverdeelVolgnummers(
  oudeVolgorde: KaraokeRequest[],
  nieuweVolgorde: KaraokeRequest[]
): { request: KaraokeRequest; arrivalSeq: number }[] {
  const nummers = oudeVolgorde.map((r) => r.arrivalSeq).sort((a, b) => a - b);
  const wijzigingen: { request: KaraokeRequest; arrivalSeq: number }[] = [];

  nieuweVolgorde.forEach((request, index) => {
    if (request.arrivalSeq !== nummers[index]) {
      wijzigingen.push({ request, arrivalSeq: nummers[index] });
    }
  });
  return wijzigingen;
}

// ---------------------------------------------------------------------------
// Host-acties
// ---------------------------------------------------------------------------

export interface StartResultaat {
  gestart: { id: string; titel: string; zangerNaam: string };
}

/**
 * Eén klik van de host: het aangeklikte nummer is aan de beurt en het vorige is klaar. Sinds
 * fase 13.8 zonder stemronde: de rij is puur de volgorde van binnenkomst plus wat de host doet.
 * Het slot zorgt dat twee klikken elkaar niet kruisen.
 */
export async function hostStart(code: string, requestId: string): Promise<StartResultaat> {
  const K = keys(code);
  return metSlot(K, 'start', async () => {
    const redis = getRedis();
    await vergeetSnapshot(code);

    const toestand = await leesToestand(code);
    const doel = toestand.requests.find((r) => r.id === requestId && r.status === 'queued');
    if (!doel) {
      throw new QueueError('Dit nummer staat niet (meer) in de wachtrij.', 409, 'WEG');
    }

    const vorige = toestand.requests.find((r) => r.status === 'playing');
    await redis.hset(K.request(requestId), { status: 'playing', verrassingOp: 0 });
    if (vorige) await archiveer(code, vorige.id, vorige.deviceId, 'done', false);
    await vergeetSnapshot(code);

    return { gestart: { id: doel.id, titel: doel.titel, zangerNaam: doel.zangerNaam } };
  });
}

/** Zet een aanvraag achteraan de rij. */
export async function hostSkip(code: string, requestId: string): Promise<void> {
  const request = await haalOp(code, requestId);
  if (request.status !== 'queued') {
    throw new QueueError('Deze aanvraag staat niet in de wachtrij.', 409);
  }
  const redis = getRedis();
  const K = keys(code);
  await redis.hset(K.request(requestId), {
    arrivalSeq: await redis.incr(K.seqCounter),
    // Naar achteren betekent naar achteren: een verrassingskeuze vervalt.
    verrassingOp: 0,
  });
  await vergeetSnapshot(code);
}

export async function hostVerwijder(code: string, requestId: string): Promise<void> {
  const request = await haalOp(code, requestId);
  await archiveer(code, requestId, request.deviceId, 'removed');
}

/**
 * Het spelende nummer is afgelopen zonder dat er een volgende start (de Speler van de
 * Showcomposer, fase 13): het podium is leeg.
 */
export async function hostKlaar(code: string): Promise<{ id: string } | null> {
  const toestand = await leesToestand(code);
  const spelend = toestand.requests.find((r) => r.status === 'playing');
  if (!spelend) return null;
  await archiveer(code, spelend.id, spelend.deviceId, 'done');
  return { id: spelend.id };
}

/**
 * De uitslag van de Knal-meter voor een optreden (Showcomposer, fase 13). Mag voor het
 * spelende nummer en voor een nummer dat al klaar is; nogmaals vervangt de vorige score.
 * De aanvraag blijft daarna twee dagen staan, zodat het leaderboard de hele avond klopt.
 */
export async function uitslagBewaren(
  code: string,
  input: { requestId: string; score: unknown; labels: unknown; opbouw?: unknown }
): Promise<Uitslag> {
  const score = Number(input.score);
  if (!Number.isFinite(score) || score < 0 || score > 10000) {
    throw new QueueError('De score moet een getal van 0 tot 10.000 zijn.');
  }
  const labels = parseLijst(input.labels).slice(0, 4).map((l) => l.slice(0, 40));
  // Fase 13.8: de opbouw (meter, klassieker, herhaling, bonus) is optioneel; de Speler rekent, hier staat hij alleen.
  const opbouw = parseOpbouw(input.opbouw);
  const request = await haalOp(code, input.requestId);
  if (request.status !== 'playing' && request.status !== 'done') {
    throw new QueueError('Dit nummer is nog niet gezongen.', 409);
  }
  const redis = getRedis();
  const K = keys(code);
  const tijd = Date.now();
  const pipe = redis.pipeline();
  pipe.hset(K.request(request.id), { score, labels: JSON.stringify(labels), gescoordOp: tijd, opbouw: opbouw ? JSON.stringify(opbouw) : '' });
  pipe.sadd(K.gescoord, request.id);
  pipe.expire(K.request(request.id), SHOW_TTL_SEC);
  pipe.expire(K.gescoord, SHOW_TTL_SEC);
  await pipe.exec();
  await vergeetSnapshot(code);
  return {
    id: request.id,
    songId: request.songId,
    titel: request.titel,
    artiest: request.artiest,
    zangerNaam: request.zangerNaam,
    extraSingers: request.extraSingers,
    score,
    labels,
    tijd,
    opbouw,
    isMijn: false,
  };
}

/**
 * Trekt een willekeurig nummer van buiten de top naar positie 1. Bedoeld voor een volle lijst,
 * zodat de onderkant ook een kans maakt; de top blijft staan, die is bijna aan de beurt.
 */
export async function hostVerrassing(code: string): Promise<{ id: string; titel: string; positie: number }> {
  const K = keys(code);
  return metSlot(K, 'start', async () => {
    await vergeetSnapshot(code);
    const toestand = await leesToestand(code);
    const wachtrij = toestand.requests.filter((r) => r.status === 'queued').sort(opVolgorde);

    if (wachtrij.length < VERRASSING_MIN_RIJ) {
      throw new QueueError(
        `De verrassingskeuze kan pas vanaf ${VERRASSING_MIN_RIJ} nummers in de rij (nu ${wachtrij.length}).`,
        409,
        'TE_KORT'
      );
    }

    const kandidaten = wachtrij.slice(VERRASSING_BESCHERMDE_TOP);
    const index = Math.floor(Math.random() * kandidaten.length);
    const gekozen = kandidaten[index];

    const nieuweVolgorde = [gekozen, ...wachtrij.filter((r) => r.id !== gekozen.id)];

    const schrijf = getRedis().pipeline();
    for (const { request, arrivalSeq } of herverdeelVolgnummers(wachtrij, nieuweVolgorde)) {
      schrijf.hset(K.request(request.id), { arrivalSeq });
    }
    schrijf.hset(K.request(gekozen.id), { verrassingOp: Date.now() });
    await schrijf.exec();
    await vergeetSnapshot(code);

    return {
      id: gekozen.id,
      titel: gekozen.titel,
      positie: VERRASSING_BESCHERMDE_TOP + index + 1,
    };
  });
}
