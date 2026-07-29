import { getRedis, KEYS } from './redis';
import { getSongById } from './catalog';
import type { CheckinPrompt, KaraokeRequest, QueueEntry, QueueResponse, RequestStatus } from './types';
import {
  BESCHERMING_NA_RONDES,
  CHECKIN_INTERVAL_MS,
  CHECKIN_RESPIJT_MS,
  CHECKIN_VRIJE_POSITIES,
  GROTE_RIJ_VANAF,
  MAX_AANVRAGEN_PER_DEVICE,
  MAX_EXTRA_ZANGER_LENGTE,
  MAX_EXTRA_ZANGERS,
  MAX_GEMISTE_CHECKINS,
  MAX_ZANGER_LENGTE,
  SPRONG_KORTE_RIJ,
  SPRONG_VOLLE_RIJ,
  VERRASSING_BESCHERMDE_TOP,
  VERRASSING_MIN_RIJ,
} from './constants';

/** Bewaartermijn van afgeronde/verwijderde aanvragen (alleen nog voor debug). */
const ARCHIEF_TTL_SEC = 24 * 60 * 60;
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
  const status = String(raw.status ?? '') as RequestStatus;
  if (!['queued', 'playing', 'paused', 'done', 'removed'].includes(status)) return null;

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
    lastConfirmedAt: Number(raw.lastConfirmedAt ?? raw.createdAt ?? 0),
    missedCheckins: Number(raw.missedCheckins ?? 0),
    stilstandRondes: Number(raw.stilstandRondes ?? 0),
    vorigePositie: Number(raw.vorigePositie ?? 0),
    verrassingOp: Number(raw.verrassingOp ?? 0),
  };
}

/** De wachtrij is puur op volgorde van binnenkomst. */
function opVolgorde(a: KaraokeRequest, b: KaraokeRequest): number {
  return a.arrivalSeq - b.arrivalSeq;
}

function isBeschermd(request: KaraokeRequest): boolean {
  return request.stilstandRondes >= BESCHERMING_NA_RONDES;
}

interface Toestand {
  /** Alle levende aanvragen: queued, playing en paused. */
  requests: KaraokeRequest[];
  /** Stemmen van de lopende ronde: deviceId -> requestId. Blijft server-side. */
  stemmen: Map<string, string>;
  ronde: number;
  winnaarVorigeRonde: string | null;
}

/** Haalt alles op wat voor één beeld van de wachtrij nodig is. */
async function leesToestand(): Promise<Toestand> {
  const redis = getRedis();
  // Upstash parst set-leden als JSON, dus id "12" komt terug als number 12.
  const ids = (await redis.smembers(KEYS.live)).map(String);

  const pipe = redis.pipeline();
  pipe.hgetall(KEYS.rondeStemmen);
  pipe.get(KEYS.rondeNummer);
  pipe.get(KEYS.rondeWinnaar);
  for (const id of ids) pipe.hgetall(KEYS.request(id));
  const results = await pipe.exec();

  const ruweStemmen = (results[0] as Record<string, unknown> | null) ?? {};
  const stemmen = new Map<string, string>(
    Object.entries(ruweStemmen).map(([deviceId, requestId]) => [deviceId, String(requestId)])
  );
  // De sleutel telt afgerekende rondes; de lopende ronde is er eentje verder.
  const ronde = Number(results[1] ?? 0) + 1;
  const winnaarRuw = results[2];
  const winnaarVorigeRonde = winnaarRuw === null || winnaarRuw === undefined ? null : String(winnaarRuw);

  const requests: KaraokeRequest[] = [];
  const wezen: string[] = [];

  ids.forEach((id, i) => {
    const request = parseRequest(id, results[i + 3] as Record<string, unknown> | null);
    if (!request || !['queued', 'playing', 'paused'].includes(request.status)) {
      wezen.push(id);
      return;
    }
    requests.push(request);
  });

  if (wezen.length > 0) await redis.srem(KEYS.live, ...wezen);

  return { requests, stemmen, ronde, winnaarVorigeRonde };
}

/** Telt de stemmen van deze ronde per aanvraag. */
function telStemmen(stemmen: Map<string, string>): Map<string, number> {
  const telling = new Map<string, number>();
  for (const requestId of stemmen.values()) {
    telling.set(requestId, (telling.get(requestId) ?? 0) + 1);
  }
  return telling;
}

function naarEntry(
  request: KaraokeRequest,
  toestand: Toestand,
  telling: Map<string, number>,
  deviceId: string | null
): QueueEntry {
  const isMijn = deviceId !== null && request.deviceId === deviceId;
  const heeftMijnStem = deviceId !== null && toestand.stemmen.get(deviceId) === request.id;

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
    stemmen: telling.get(request.id) ?? 0,
    missedCheckins: request.missedCheckins,
    isBeschermd: isBeschermd(request),
    isWinnaarVorigeRonde: toestand.winnaarVorigeRonde === request.id,
    verrassingOp: request.verrassingOp,
    isMijn,
    heeftMijnStem,
    // Op je huidige keuze nog eens drukken doet niets; verplaatsen doe je door
    // op een ánder nummer te stemmen.
    magStemmen: deviceId !== null && !isMijn && request.status === 'queued' && !heeftMijnStem,
  };
}

// ---------------------------------------------------------------------------
// Check-in-sweep (draait bij elke queue-read, dus geen cron nodig)
// ---------------------------------------------------------------------------

/**
 * Werkt de check-in-status bij: wie te lang niet bevestigd heeft wordt
 * gepauzeerd, en bij de tweede keer definitief verwijderd.
 */
async function checkinSweep(
  toestand: Toestand,
  nu: number
): Promise<{ toestand: Toestand; openstaandeCheckins: Map<string, number> }> {
  const redis = getRedis();
  const openstaandeCheckins = new Map<string, number>();

  const gesorteerd = toestand.requests.filter((r) => r.status === 'queued').sort(opVolgorde);

  const bewerkingen: Promise<unknown>[] = [];
  let gewijzigd = false;

  gesorteerd.forEach((req, index) => {
    const positie = index + 1;

    // Bovenaan de lijst of nog geen kwartier in de rij: geen check-in.
    if (positie <= CHECKIN_VRIJE_POSITIES || nu - req.createdAt < CHECKIN_INTERVAL_MS) {
      // Klok bijhouden zolang je vrijgesteld bent, anders verval je meteen
      // zodra je weer naar beneden zakt. Alleen schrijven als het echt scheelt.
      if (nu - req.lastConfirmedAt > CHECKIN_INTERVAL_MS / 2) {
        req.lastConfirmedAt = nu;
        bewerkingen.push(redis.hset(KEYS.request(req.id), { lastConfirmedAt: nu }));
      }
      return;
    }

    if (nu - req.lastConfirmedAt < CHECKIN_INTERVAL_MS) return;

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
    toestand: gewijzigd
      ? { ...toestand, requests: toestand.requests.filter((r) => r.status !== 'removed') }
      : toestand,
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
    redis.expire(KEYS.request(requestId), ARCHIEF_TTL_SEC),
  ]);
  vergeetSnapshot();
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

let snapshot: { tijd: number; toestand: Toestand; checkins: Map<string, number> } | null = null;

function vergeetSnapshot(): void {
  snapshot = null;
}

async function huidigeToestand(nu: number) {
  if (snapshot && nu - snapshot.tijd < SNAPSHOT_TTL_MS) {
    return { toestand: snapshot.toestand, openstaandeCheckins: snapshot.checkins };
  }
  const resultaat = await checkinSweep(await leesToestand(), nu);
  snapshot = { tijd: nu, toestand: resultaat.toestand, checkins: resultaat.openstaandeCheckins };
  return resultaat;
}

/** Zorgt dat een host-klik nooit half uitgevoerd kan raken. */
async function metSlot<T>(naam: string, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  const verkregen = await redis.set(KEYS.slot(naam), '1', { nx: true, px: SLOT_MS });
  if (verkregen !== 'OK') {
    throw new QueueError('Er wordt net iets anders gestart. Probeer het zo nog eens.', 409, 'BEZIG');
  }
  try {
    return await fn();
  } finally {
    await redis.del(KEYS.slot(naam));
  }
}

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

export async function leesWachtrij(deviceId: string | null): Promise<QueueResponse> {
  const nu = Date.now();
  const { toestand, openstaandeCheckins } = await huidigeToestand(nu);
  const telling = telStemmen(toestand.stemmen);

  const maakEntry = (r: KaraokeRequest) => naarEntry(r, toestand, telling, deviceId);

  const wachtrij = toestand.requests
    .filter((r) => r.status === 'queued')
    .sort(opVolgorde)
    .map(maakEntry);

  const spelend = toestand.requests.find((r) => r.status === 'playing');

  const gepauzeerd = toestand.requests
    .filter((r) => r.status === 'paused')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(maakEntry);

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
    ? toestand.requests.filter((r) => r.deviceId === deviceId).length
    : 0;

  return {
    nuAanDeBeurt: spelend ? maakEntry(spelend) : null,
    wachtrij,
    gepauzeerd,
    checkin,
    ronde: toestand.ronde,
    mijnStem: deviceId ? (toestand.stemmen.get(deviceId) ?? null) : null,
    eigenAanvragen,
    serverTijd: nu,
  };
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

export async function maakAanvraag(input: {
  songId: string;
  zangerNaam: string;
  extraSingers?: unknown;
  deviceId: string;
}): Promise<{ id: string }> {
  const redis = getRedis();

  const zangerNaam = input.zangerNaam.trim().slice(0, MAX_ZANGER_LENGTE);
  if (zangerNaam.length < 1) throw new QueueError('Vul eerst je naam in.');
  if (!input.deviceId) throw new QueueError('Onbekend apparaat — herlaad de pagina.');

  const extraSingers = normaliseerExtraZangers(input.extraSingers);

  // Alleen nummers uit de KaraFun-catalogus: vrije invoer bestaat niet.
  const song = getSongById(input.songId);
  if (!song) {
    throw new QueueError('Dit nummer staat niet in de KaraFun-catalogus.', 404);
  }

  const { requests } = await leesToestand();

  if (requests.some((r) => r.songId === song.id)) {
    throw new QueueError('Dit nummer staat al in de lijst — stem erop!', 409, 'DUBBEL');
  }

  const eigen = requests.filter((r) => r.deviceId === input.deviceId).length;
  if (eigen >= MAX_AANVRAGEN_PER_DEVICE) {
    throw new QueueError(
      `Je hebt al ${MAX_AANVRAGEN_PER_DEVICE} nummers openstaan. Wacht tot er eentje geweest is.`,
      409,
      'LIMIET'
    );
  }

  const nu = Date.now();
  const [id, arrivalSeq] = await Promise.all([
    redis.incr(KEYS.counter).then(String),
    redis.incr(KEYS.seqCounter),
  ]);
  vergeetSnapshot();

  await redis.hset(KEYS.request(id), {
    songId: song.id,
    titel: song.titel,
    artiest: song.artiest,
    zangerNaam,
    extraSingers: JSON.stringify(extraSingers),
    deviceId: input.deviceId,
    createdAt: nu,
    arrivalSeq,
    status: 'queued',
    lastConfirmedAt: nu,
    missedCheckins: 0,
    stilstandRondes: 0,
    vorigePositie: 0,
    verrassingOp: 0,
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

/**
 * Brengt de stem van dit apparaat uit voor de lopende ronde. Eén veld per
 * device, dus opnieuw stemmen verplaatst je stem in plaats van er een toe te
 * voegen. Wie er gestemd heeft blijft server-side; naar buiten gaan alleen
 * aantallen.
 */
export async function stem(requestId: string, deviceId: string): Promise<{ stemmen: number }> {
  if (!deviceId) throw new QueueError('Onbekend apparaat — herlaad de pagina.');

  const toestand = await leesToestand();
  const doel = toestand.requests.find((r) => r.id === requestId);

  if (!doel || doel.status !== 'queued') {
    throw new QueueError('Op dit nummer kan niet (meer) gestemd worden.', 409);
  }
  if (doel.deviceId === deviceId) {
    throw new QueueError('Je kunt niet op je eigen aanvraag stemmen.', 403);
  }

  await getRedis().hset(KEYS.rondeStemmen, { [deviceId]: requestId });
  vergeetSnapshot();

  toestand.stemmen.set(deviceId, requestId);
  return { stemmen: telStemmen(toestand.stemmen).get(requestId) ?? 0 };
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

/** "Ik ben er weer!" — gepauzeerde aanvraag achteraan terug in de rij. */
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
    arrivalSeq: await redis.incr(KEYS.seqCounter),
    stilstandRondes: 0,
    vorigePositie: 0,
    verrassingOp: 0,
  });
  await redis.sadd(KEYS.live, requestId);
  vergeetSnapshot();
}

// ---------------------------------------------------------------------------
// Stemronde
// ---------------------------------------------------------------------------

/**
 * De winnaar van de ronde: meeste stemmen, bij gelijke stand het nummer dat het
 * langst in de rij staat. Zonder stemmen is er geen winnaar en springt niemand.
 */
function bepaalWinnaar(
  wachtrij: KaraokeRequest[],
  stemmen: Map<string, string>
): KaraokeRequest | null {
  const telling = telStemmen(stemmen);
  let winnaar: KaraokeRequest | null = null;
  let hoogste = 0;

  // De wachtrij is al op arrivalSeq gesorteerd, dus de eerste met het hoogste
  // aantal is meteen de langst wachtende — dat is precies de tie-break.
  for (const request of wachtrij) {
    const aantal = telling.get(request.id) ?? 0;
    if (aantal > hoogste) {
      hoogste = aantal;
      winnaar = request;
    }
  }
  return hoogste > 0 ? winnaar : null;
}

/**
 * Zet de winnaar vooruit: één plek, of twee bij een volle rij. Een aanvraag die
 * al twee rondes stilstaat kan niet ingehaald worden; de winnaar landt er dan
 * direct onder.
 */
function verplaatsWinnaar(wachtrij: KaraokeRequest[], winnaar: KaraokeRequest): KaraokeRequest[] {
  const vanaf = wachtrij.findIndex((r) => r.id === winnaar.id);
  if (vanaf <= 0) return wachtrij;

  const sprong = wachtrij.length >= GROTE_RIJ_VANAF ? SPRONG_VOLLE_RIJ : SPRONG_KORTE_RIJ;
  let naar = Math.max(0, vanaf - sprong);

  // Van dichtbij naar ver kijken: de eerste beschermde aanvraag die we zouden
  // passeren bepaalt waar we landen.
  for (let i = vanaf - 1; i >= naar; i--) {
    if (isBeschermd(wachtrij[i])) {
      naar = i + 1;
      break;
    }
  }
  if (naar >= vanaf) return wachtrij;

  const nieuw = [...wachtrij];
  nieuw.splice(vanaf, 1);
  nieuw.splice(naar, 0, winnaar);
  return nieuw;
}

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
  /** De winnaar van de zojuist afgerekende ronde, als er gestemd was. */
  winnaar: { id: string; titel: string; stemmen: number; gesprongen: boolean } | null;
  ronde: number;
}

/**
 * Eén klik van de host doet alles tegelijk: de lopende ronde afrekenen en de
 * winnaar laten springen, het aangeklikte nummer aan de beurt laten zijn, en
 * daarna de stemmen wissen zodat de volgende ronde begint. Het slot zorgt dat
 * er nooit een halve ronde kan ontstaan.
 */
export async function hostStart(requestId: string): Promise<StartResultaat> {
  return metSlot('start', async () => {
    const redis = getRedis();
    vergeetSnapshot();

    const toestand = await leesToestand();
    const wachtrij = toestand.requests.filter((r) => r.status === 'queued').sort(opVolgorde);
    const doel = wachtrij.find((r) => r.id === requestId);
    if (!doel) {
      throw new QueueError('Dit nummer staat niet (meer) in de wachtrij.', 409, 'WEG');
    }

    // 1. Ronde afrekenen. Wie zelf gestart wordt hoeft niet meer te springen.
    const winnaar = bepaalWinnaar(wachtrij, toestand.stemmen);
    const telling = telStemmen(toestand.stemmen);
    const nieuweVolgorde =
      winnaar !== null && winnaar.id !== requestId
        ? verplaatsWinnaar(wachtrij, winnaar)
        : wachtrij;
    // Een beschermde aanvraag kan de sprong blokkeren, dus pas achteraf is
    // duidelijk of de winnaar daadwerkelijk opgeschoven is.
    const springt =
      winnaar !== null &&
      nieuweVolgorde.findIndex((r) => r.id === winnaar.id) <
        wachtrij.findIndex((r) => r.id === winnaar.id);

    const schrijf = redis.pipeline();
    for (const { request, arrivalSeq } of herverdeelVolgnummers(wachtrij, nieuweVolgorde)) {
      request.arrivalSeq = arrivalSeq;
      schrijf.hset(KEYS.request(request.id), { arrivalSeq });
    }

    // 2. Het aangeklikte nummer gaat de rij uit en wordt "nu aan de beurt".
    const rest = nieuweVolgorde.filter((r) => r.id !== requestId);

    // 3. Stilstand bijwerken op de posities zoals ze er ná deze ronde bij staan.
    rest.forEach((request, index) => {
      const positie = index + 1;
      const opgeschoven = request.vorigePositie === 0 || positie < request.vorigePositie;
      const stilstandRondes = opgeschoven ? 0 : request.stilstandRondes + 1;

      if (stilstandRondes !== request.stilstandRondes || positie !== request.vorigePositie) {
        request.stilstandRondes = stilstandRondes;
        request.vorigePositie = positie;
        schrijf.hset(KEYS.request(request.id), { stilstandRondes, vorigePositie: positie });
      }
    });

    // 4. Het vorige nummer is klaar; het nieuwe gaat spelen.
    const vorige = toestand.requests.find((r) => r.status === 'playing');
    schrijf.hset(KEYS.request(requestId), { status: 'playing', verrassingOp: 0 });

    // 5. Stemmen wissen en de nieuwe ronde starten.
    schrijf.del(KEYS.rondeStemmen);
    schrijf.incr(KEYS.rondeNummer);
    if (winnaar) schrijf.set(KEYS.rondeWinnaar, winnaar.id);
    else schrijf.del(KEYS.rondeWinnaar);

    await schrijf.exec();
    if (vorige) await archiveer(vorige.id, vorige.deviceId, 'done');
    vergeetSnapshot();

    return {
      gestart: { id: doel.id, titel: doel.titel, zangerNaam: doel.zangerNaam },
      winnaar: winnaar
        ? {
            id: winnaar.id,
            titel: winnaar.titel,
            stemmen: telling.get(winnaar.id) ?? 0,
            gesprongen: springt,
          }
        : null,
      ronde: toestand.ronde + 1,
    };
  });
}

/** Zet een aanvraag achteraan de rij. */
export async function hostSkip(requestId: string): Promise<void> {
  const request = await haalOp(requestId);
  if (request.status !== 'queued') {
    throw new QueueError('Deze aanvraag staat niet in de wachtrij.', 409);
  }
  const redis = getRedis();
  const nu = Date.now();
  await redis.hset(KEYS.request(requestId), {
    arrivalSeq: await redis.incr(KEYS.seqCounter),
    lastConfirmedAt: nu,
    stilstandRondes: 0,
    vorigePositie: 0,
    // Naar achteren betekent naar achteren: een verrassingskeuze vervalt.
    verrassingOp: 0,
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

/**
 * Trekt een willekeurig nummer van buiten de beschermde top naar positie 1.
 * Bedoeld voor een volle lijst, zodat de onderkant ook een kans maakt.
 */
export async function hostVerrassing(): Promise<{ id: string; titel: string; positie: number }> {
  return metSlot('start', async () => {
    vergeetSnapshot();
    const toestand = await leesToestand();
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
      schrijf.hset(KEYS.request(request.id), { arrivalSeq });
    }
    schrijf.hset(KEYS.request(gekozen.id), { verrassingOp: Date.now() });
    await schrijf.exec();
    vergeetSnapshot();

    return {
      id: gekozen.id,
      titel: gekozen.titel,
      positie: VERRASSING_BESCHERMDE_TOP + index + 1,
    };
  });
}
