#!/usr/bin/env node
/**
 * Rooktest voor alle API-routes. Start een lokale Upstash-simulator plus
 * `next dev`, speelt een compleet feestscenario af en ruimt daarna op.
 *
 *   npm run test:api
 *
 * Tegen een al draaiende server met echte Redis:
 *   BASE_URL=http://localhost:3000 HOST_PIN=1234 npm run test:api
 */

import { spawn } from 'node:child_process';
import { setTimeout as wacht } from 'node:timers/promises';

const EXTERN = Boolean(process.env.BASE_URL);
const REDIS_POORT = 39117;
const APP_POORT = 3111;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${APP_POORT}`;
const PIN = process.env.HOST_PIN ?? '4821';

// Spiegelt lib/constants.ts (een .mjs-script kan geen TypeScript importeren).
const VERRASSING_MIN_RIJ = 30;
const VERRASSING_BESCHERMDE_TOP = 5;
const MAX_AANVRAGEN_PER_DEVICE = 2;
const MAX_AANVRAGEN_DRUKKE_RIJ = 1;
const DRUKKE_RIJ_VANAF = 11;
const MAX_EXTRA_ZANGERS = 1;

const DEVICE_A = 'test-device-a';
const DEVICE_B = 'test-device-b';
const DEVICE_C = 'test-device-c';

let geslaagd = 0;
let gefaald = 0;
const processen = [];

function ok(naam) {
  geslaagd++;
  console.log(`  \x1b[32m✓\x1b[0m ${naam}`);
}

function fout(naam, detail) {
  gefaald++;
  console.log(`  \x1b[31m✗\x1b[0m ${naam}\n      ${detail}`);
}

function check(naam, voorwaarde, detail = '') {
  if (voorwaarde) ok(naam);
  else fout(naam, detail || 'verwachting niet waar');
}

/** De show-code van de test (fase 13: elke show heeft een eigen wachtrij). */
let SHOW = '';

/** Voegt `?s=<show>` toe, tenzij `show` false is of de route zelf al een `s=` heeft. */
function metShow(pad, show) {
  if (show === false || /[?&]s=/.test(pad)) return pad;
  return pad + (pad.includes('?') ? '&' : '?') + 's=' + encodeURIComponent(show ?? SHOW);
}

async function api(pad, { method = 'GET', body, pin, token, show } = {}) {
  const res = await fetch(BASE + metShow(pad, show), {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(pin ? { 'x-host-pin': pin } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** Sleutel van de testshow in Redis. */
const sk = (rest) => `s:${SHOW}:${rest}`;

/** Na een schrijfactie buiten de app om: de momentopname in Redis weggooien (die in het geheugen verloopt na 3 s). */
async function snapshotWeg() {
  await redisCmd(['del', sk('snapshot')]);
}

/** Direct commando naar de lokale fake-upstash (om de klok te kunnen manipuleren). */
async function redisCmd(commando) {
  const res = await fetch(`http://127.0.0.1:${REDIS_POORT}`, {
    method: 'POST',
    body: JSON.stringify(commando),
  });
  return (await res.json()).result;
}

async function wachtTot(url, seconden) {
  for (let i = 0; i < seconden * 4; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // nog niet op
    }
    await wacht(250);
  }
  return false;
}

function start(naam, commando, args, env) {
  const proces = spawn(commando, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processen.push(proces);
  proces.stderr.on('data', (d) => {
    const tekst = String(d);
    if (/error|Error/.test(tekst)) process.stderr.write(`[${naam}] ${tekst}`);
  });
  return proces;
}

function stopAlles() {
  for (const p of processen) {
    try {
      p.kill('SIGTERM');
    } catch {
      // al gestopt
    }
  }
}

async function opzetten() {
  if (EXTERN) {
    console.log(`Testen tegen bestaande server: ${BASE}\n`);
    return;
  }

  console.log('Starten: fake-upstash + next dev …');
  start('redis', process.execPath, ['scripts/fake-upstash.mjs', String(REDIS_POORT)], {});
  if (!(await wachtTot(`http://127.0.0.1:${REDIS_POORT}`, 10))) {
    throw new Error('fake-upstash startte niet');
  }

  start('next', 'npx', ['next', 'dev', '--port', String(APP_POORT)], {
    UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${REDIS_POORT}`,
    UPSTASH_REDIS_REST_TOKEN: 'test',
    HOST_PIN: PIN,
  });
  if (!(await wachtTot(`${BASE}/api/songs?q=ab`, 90))) {
    throw new Error('next dev startte niet');
  }
  console.log(`Server draait op ${BASE}\n`);
}

async function showMaken() {
  const r = await api('/api/show', { method: 'POST', body: { naam: 'Testavond' }, pin: PIN, show: false });
  if (r.status !== 200) throw new Error(`show aanmaken mislukt: ${JSON.stringify(r.data)}`);
  SHOW = r.data.code;
  return r.data;
}

async function testen() {
  // --- Catalogus -----------------------------------------------------------
  console.log('Catalogus');
  const zoek = await api('/api/songs?q=bohemian%20rhapsody');
  check(
    'zoeken geeft resultaten',
    zoek.status === 200 && Array.isArray(zoek.data?.resultaten) && zoek.data.resultaten.length > 0,
    JSON.stringify(zoek.data).slice(0, 200)
  );
  const songA = zoek.data?.resultaten?.[0];

  const zoek2 = await api('/api/songs?q=abba');
  const songB = zoek2.data?.resultaten?.find((s) => s.id !== songA?.id);
  check('tweede zoekopdracht geeft een ander nummer', Boolean(songB));

  check('te korte zoekterm geeft niks', (await api('/api/songs?q=a')).data?.resultaten?.length === 0);

  const accent = await api('/api/songs?q=' + encodeURIComponent('beyonce'));
  check('zoeken negeert accenten', accent.data?.resultaten?.length > 0);

  if (!songA || !songB) throw new Error('Catalogus leverde te weinig nummers om verder te testen.');

  // --- Aanvragen -----------------------------------------------------------
  console.log('\nAanvragen');
  const aanvraag1 = await api('/api/request', {
    method: 'POST',
    body: { songId: songA.id, zangerNaam: 'Anna', deviceId: DEVICE_A },
  });
  check('nummer aanvragen lukt', aanvraag1.status === 200, JSON.stringify(aanvraag1.data));
  const idA = aanvraag1.data?.id;

  const dubbel = await api('/api/request', {
    method: 'POST',
    body: { songId: songA.id, zangerNaam: 'Bram', deviceId: DEVICE_B },
  });
  check(
    'zelfde nummer twee keer wordt geweigerd',
    dubbel.status === 409 && dubbel.data?.code === 'DUBBEL',
    JSON.stringify(dubbel.data)
  );

  const verzonnen = await api('/api/request', {
    method: 'POST',
    body: { songId: 'bestaat-niet-999', zangerNaam: 'Anna', deviceId: DEVICE_A },
  });
  check('nummer buiten de catalogus wordt geweigerd', verzonnen.status === 404);

  const zonderNaam = await api('/api/request', {
    method: 'POST',
    body: { songId: songB.id, zangerNaam: '  ', deviceId: DEVICE_A },
  });
  check('lege naam wordt geweigerd', zonderNaam.status === 400);

  const aanvraag2 = await api('/api/request', {
    method: 'POST',
    body: { songId: songB.id, zangerNaam: 'Anna', deviceId: DEVICE_A },
  });
  check('tweede aanvraag van hetzelfde device lukt', aanvraag2.status === 200);
  const idB = aanvraag2.data?.id;

  const songC = (await api('/api/songs?q=queen')).data?.resultaten?.find(
    (s) => s.id !== songA.id && s.id !== songB.id
  );
  const derde = await api('/api/request', {
    method: 'POST',
    body: { songId: songC.id, zangerNaam: 'Anna', deviceId: DEVICE_A },
  });
  check(
    'derde aanvraag van hetzelfde device wordt geweigerd',
    derde.status === 409 && derde.data?.code === 'LIMIET',
    JSON.stringify(derde.data)
  );

  // --- Wachtrij ------------------------------------------------------------
  console.log('\nWachtrij');
  const rij = await api(`/api/queue?deviceId=${DEVICE_A}`);
  check('wachtrij bevat beide aanvragen', rij.data?.wachtrij?.length === 2);
  check(
    'de rij staat op volgorde van binnenkomst',
    rij.data?.wachtrij?.[0]?.id === idA && rij.data?.wachtrij?.[1]?.id === idB,
    `volgorde: ${rij.data?.wachtrij?.map((e) => e.id).join(', ')}`
  );
  check('geen stemronde en geen check-in meer in het antwoord (fase 13.8)', !('ronde' in rij.data) && !('checkin' in rij.data) && !('gepauzeerd' in rij.data) && !('stemmen' in rij.data.wachtrij[0]));
  check('er speelt nog niks', rij.data?.nuAanDeBeurt === null);
  check('eigen aanvragen zijn gemarkeerd', rij.data?.wachtrij?.every((e) => e.isMijn === true));
  check('eigen aanvragen worden geteld', rij.data?.eigenAanvragen === 2);

  const rijB = await api(`/api/queue?deviceId=${DEVICE_B}`);
  check('een ander device ziet de aanvragen niet als de zijne', rijB.data?.wachtrij?.every((e) => e.isMijn === false));
  check(
    'niemand kan zien van welk apparaat een aanvraag is',
    !JSON.stringify(rijB.data).includes(DEVICE_A),
    'deviceId lekt in de queue-response'
  );
  const oudeRoutes = ['vote', 'checkin'];
  const oud404 = await Promise.all(oudeRoutes.map((r) => api(`/api/${r}`, { method: 'POST', body: { requestId: idA, deviceId: DEVICE_B } })));
  check('de oude routes voor stemmen en check-in bestaan niet meer', oud404.every((r) => r.status === 404), oud404.map((r) => r.status).join());

  // --- Host ----------------------------------------------------------------
  console.log('\nHost');
  check(
    'host zonder pincode wordt geweigerd',
    (await api('/api/host', { method: 'POST', body: { actie: 'login' } })).status === 401
  );
  check(
    'host met verkeerde pincode wordt geweigerd',
    (await api('/api/host', { method: 'POST', body: { actie: 'login' }, pin: 'fout' })).status ===
      401
  );
  check(
    'host met juiste pincode mag inloggen',
    (await api('/api/host', { method: 'POST', body: { actie: 'login' }, pin: PIN })).status === 200
  );

  const skip = await api('/api/host', {
    method: 'POST',
    body: { actie: 'skip', requestId: idA },
    pin: PIN,
  });
  check('skip lukt', skip.status === 200);
  const naSkip = await api('/api/queue');
  check(
    'geskipt nummer zakt naar achteren',
    naSkip.data?.wachtrij?.[0]?.id === idB && naSkip.data?.wachtrij?.[1]?.id === idA,
    `volgorde: ${naSkip.data?.wachtrij?.map((e) => e.id).join(', ')}`
  );

  const gestart = await api('/api/host', {
    method: 'POST',
    body: { actie: 'start', requestId: idB },
    pin: PIN,
  });
  check('de host kan een nummer starten', gestart.status === 200 && gestart.data?.start?.gestart?.id === idB, JSON.stringify(gestart.data));

  const naStart = await api('/api/queue');
  check('het gestarte nummer is nu aan de beurt', naStart.data?.nuAanDeBeurt?.id === idB);
  check('...en staat niet meer in de wachtrij', !naStart.data?.wachtrij?.some((e) => e.id === idB));
  check('de rest blijft op volgorde staan', naStart.data?.wachtrij?.[0]?.id === idA);
  check('het antwoord noemt geen stemronde meer', !('winnaar' in (gestart.data?.start ?? {})) && !('ronde' in (gestart.data?.start ?? {})));

  const alGestart = await api('/api/host', {
    method: 'POST',
    body: { actie: 'start', requestId: idB },
    pin: PIN,
  });
  check('een nummer twee keer starten wordt geweigerd', alGestart.status === 409);

  // --- Intrekken & opruimen ------------------------------------------------
  console.log('\nIntrekken');
  check(
    'intrekken van andermans aanvraag wordt geweigerd',
    (await api('/api/request', { method: 'DELETE', body: { requestId: idA, deviceId: DEVICE_B } }))
      .status === 403
  );
  check(
    'eigen aanvraag intrekken lukt',
    (await api('/api/request', { method: 'DELETE', body: { requestId: idA, deviceId: DEVICE_A } }))
      .status === 200
  );

  const leeg = await api('/api/queue');
  check('wachtrij is weer leeg', leeg.data?.wachtrij?.length === 0);

  // --- Duetten -------------------------------------------------------------
  console.log('\nDuetten');
  const duetSongs = (await api('/api/songs?q=dancing')).data.resultaten;

  const duet = await api('/api/request', {
    method: 'POST',
    body: {
      songId: duetSongs[0].id,
      zangerNaam: 'Kenneth',
      extraSingers: ['Lisa'],
      deviceId: DEVICE_A,
    },
  });
  check('aanvraag met een extra zanger lukt', duet.status === 200, JSON.stringify(duet.data));

  const naDuet = await api('/api/queue');
  const duetEntry = naDuet.data?.wachtrij?.find((e) => e.id === duet.data?.id);
  check(
    'de extra zanger komt terug in de wachtrij',
    JSON.stringify(duetEntry?.extraSingers) === JSON.stringify(['Lisa']),
    JSON.stringify(duetEntry?.extraSingers)
  );

  const teVeel = await api('/api/request', {
    method: 'POST',
    body: {
      songId: duetSongs[1].id,
      zangerNaam: 'Bram',
      extraSingers: ['Een', 'Twee'],
      deviceId: DEVICE_B,
    },
  });
  check(
    `meer dan ${MAX_EXTRA_ZANGERS + 1} zangers wordt geweigerd`,
    teVeel.status === 400 && teVeel.data?.code === 'TE_VEEL_ZANGERS',
    JSON.stringify(teVeel.data)
  );

  const rommel = await api('/api/request', {
    method: 'POST',
    body: {
      songId: duetSongs[1].id,
      zangerNaam: 'Bram',
      extraSingers: ['   ', 'x'.repeat(50)],
      deviceId: DEVICE_B,
    },
  });
  check('lege naam valt weg, te lange naam wordt afgekapt', rommel.status === 200);
  const rommelEntry = (await api('/api/queue')).data?.wachtrij?.find(
    (e) => e.id === rommel.data?.id
  );
  check(
    '...precies één extra zanger over, van 30 tekens',
    rommelEntry?.extraSingers?.length === 1 && rommelEntry.extraSingers[0].length === 30,
    JSON.stringify(rommelEntry?.extraSingers)
  );

  const solo = await api('/api/request', {
    method: 'POST',
    body: { songId: duetSongs[2].id, zangerNaam: 'Cato', deviceId: DEVICE_C },
  });
  check('aanvraag zonder extra zangers blijft werken', solo.status === 200);
  const soloEntry = (await api('/api/queue')).data?.wachtrij?.find((e) => e.id === solo.data?.id);
  check(
    '...en levert een lege lijst extra zangers op',
    Array.isArray(soloEntry?.extraSingers) && soloEntry.extraSingers.length === 0
  );

  if (!EXTERN) {
    // Een aanvraag zoals die vóór de duet-uitbreiding werd weggeschreven: zonder
    // extraSingers, verrassingOp en arrivalSeq, met de oude check-in-velden erbij.
    const toen = String(Date.now());
    await redisCmd([
      'hset', sk('req:legacy-1'),
      'songId', duetSongs[3].id,
      'titel', 'Oud Nummer',
      'artiest', 'Van Vroeger',
      'zangerNaam', 'Oma',
      'deviceId', 'dev-legacy',
      'createdAt', toen,
      'status', 'queued',
      'lastConfirmedAt', toen,
      'missedCheckins', '0',
      'skips', '0',
    ]);
    await redisCmd(['sadd', sk('live'), 'legacy-1']);
    await snapshotWeg();
    await wacht(3200);

    const legacyEntry = (await api('/api/queue')).data?.wachtrij?.find((e) => e.id === 'legacy-1');
    check(
      'aanvraag van vóór deze uitbreiding blijft werken',
      legacyEntry !== undefined &&
        Array.isArray(legacyEntry.extraSingers) &&
        legacyEntry.extraSingers.length === 0 &&
        legacyEntry.verrassingOp === 0,
      JSON.stringify(legacyEntry)
    );
    check(
      '...en valt voor de volgorde terug op zijn aanvraagtijd',
      legacyEntry?.arrivalSeq === Number(toen),
      `arrivalSeq ${legacyEntry?.arrivalSeq}, verwacht ${toen}`
    );

    // Een aanvraag die vóór fase 13.8 gepauzeerd was (check-in gemist) komt gewoon terug in de rij.
    await redisCmd(['hset', sk('req:legacy-2'), 'songId', duetSongs[5].id, 'titel', 'Gepauzeerd', 'artiest', 'Toen', 'zangerNaam', 'Opa', 'deviceId', 'dev-legacy', 'createdAt', toen, 'arrivalSeq', '3', 'status', 'paused', 'missedCheckins', '1']);
    await redisCmd(['sadd', sk('live'), 'legacy-2']);
    await snapshotWeg();
    await wacht(3200);
    check('een oude gepauzeerde aanvraag staat weer gewoon in de rij', (await api('/api/queue')).data?.wachtrij?.some((e) => e.id === 'legacy-2'));
    await api('/api/host', { method: 'POST', body: { actie: 'verwijder', requestId: 'legacy-2' }, pin: PIN });

    // Zo'n oude aanvraag heeft een enorm volgnummer (epoch-ms). Een nieuw
    // nummer moet er nog steeds achter komen, niet ervoor.
    const naLegacy = await api('/api/request', {
      method: 'POST',
      body: { songId: duetSongs[4].id, zangerNaam: 'Nieuw', deviceId: 'dev-na-legacy' },
    });
    const rijMetLegacy = (await api('/api/queue')).data?.wachtrij ?? [];
    check(
      'een nieuwe aanvraag komt achter een aanvraag zonder volgnummer',
      rijMetLegacy[rijMetLegacy.length - 1]?.id === naLegacy.data?.id,
      `volgorde: ${rijMetLegacy.map((e) => e.id).join(', ')}`
    );

    for (const [id, device] of [
      ['legacy-1', 'dev-legacy'],
      [naLegacy.data?.id, 'dev-na-legacy'],
    ]) {
      await api('/api/request', { method: 'DELETE', body: { requestId: id, deviceId: device } });
    }
  }

  for (const [id, device] of [
    [duet.data?.id, DEVICE_A],
    [rommel.data?.id, DEVICE_B],
    [solo.data?.id, DEVICE_C],
  ]) {
    await api('/api/request', { method: 'DELETE', body: { requestId: id, deviceId: device } });
  }
  check('wachtrij is na het opruimen weer leeg', (await api('/api/queue')).data?.wachtrij?.length === 0);

  // --- Skip en start zonder stemronde --------------------------------------
  console.log('\nVolgorde');
  // Voorraadje nummers om steeds verse rijen mee op te bouwen.
  const voorraad = [];
  const gezien = new Set();
  for (const term of ['love', 'you', 'night', 'dance', 'rock', 'baby', 'heart', 'time', 'home', 'girl', 'man', 'world']) {
    for (const song of (await api(`/api/songs?q=${term}`)).data?.resultaten ?? []) {
      if (!gezien.has(song.id)) {
        gezien.add(song.id);
        voorraad.push(song);
      }
    }
  }
  let voorraadIndex = 0;

  /**
   * Vraagt een nummer aan namens `deviceId`. Nummers die al in de rij staan
   * worden overgeslagen; andere fouten (zoals de limiet) komen gewoon terug.
   */
  async function aanvraagVoor(deviceId, naam) {
    while (voorraadIndex < voorraad.length) {
      const res = await api('/api/request', {
        method: 'POST',
        body: { songId: voorraad[voorraadIndex++].id, zangerNaam: naam, deviceId },
      });
      if (res.data?.code !== 'DUBBEL') return res;
    }
    throw new Error('Voorraad nummers op.');
  }

  /** Zelfde, maar geeft alleen het id terug en faalt hard bij een fout. */
  async function vraagAan(prefix, i) {
    const res = await aanvraagVoor(`${prefix}-dev-${i}`, `${prefix}${i}`);
    if (res.status !== 200) throw new Error(`Aanvraag mislukt: ${JSON.stringify(res.data)}`);
    return res.data.id;
  }

  /** Bouwt een verse wachtrij van `aantal` nummers, elk van een eigen apparaat. */
  async function nieuweRij(aantal, prefix) {
    for (const entry of (await api('/api/queue')).data?.wachtrij ?? []) {
      await api('/api/host', {
        method: 'POST',
        body: { actie: 'verwijder', requestId: entry.id },
        pin: PIN,
      });
    }
    const ids = [];
    for (let i = 0; i < aantal; i++) ids.push(await vraagAan(prefix, i));
    return ids;
  }

  const startNummer = (id) =>
    api('/api/host', { method: 'POST', body: { actie: 'start', requestId: id }, pin: PIN });
  const volgorde = async () => ((await api('/api/queue')).data?.wachtrij ?? []).map((e) => e.id);

  // De host start een nummer midden uit de rij: de rest blijft precies staan.
  const midden = await nieuweRij(5, 'mid');
  await startNummer(midden[2]);
  check('host mag een nummer midden uit de rij starten', (await api('/api/queue')).data?.nuAanDeBeurt?.id === midden[2]);
  check('...en de rest blijft op volgorde', (await volgorde()).join() === [midden[0], midden[1], midden[3], midden[4]].join(), `volgorde: ${(await volgorde()).join(', ')}`);
  await startNummer(midden[0]);
  const naTwee = await api('/api/queue');
  check('de volgende start zet het vorige nummer op klaar', naTwee.data?.nuAanDeBeurt?.id === midden[0] && !naTwee.data.wachtrij.some((e) => e.id === midden[2]));
  await api('/api/host', { method: 'POST', body: { actie: 'skip', requestId: midden[1] }, pin: PIN });
  check('skip zet een nummer achteraan', (await volgorde()).join() === [midden[3], midden[4], midden[1]].join(), `volgorde: ${(await volgorde()).join(', ')}`);
  // Een aanvraag blijft staan, hoe lang ook: geen check-in, geen pauze.
  const oud = Date.now() - 40 * 60_000;
  for (const id of [midden[3], midden[4]]) await redisCmd(['hset', sk(`req:${id}`), 'createdAt', String(oud)]);
  await snapshotWeg();
  await wacht(3200);
  const naLang = await api(`/api/queue?deviceId=mid-dev-3`);
  check('een aanvraag van 40 minuten oud staat er nog gewoon, zonder vraag', naLang.data?.wachtrij?.length === 3 && naLang.data.wachtrij[0].id === midden[3] && !('checkin' in naLang.data));
  for (const entry of (await api('/api/queue')).data?.wachtrij ?? []) {
    await api('/api/host', {
      method: 'POST',
      body: { actie: 'verwijder', requestId: entry.id },
      pin: PIN,
    });
  }
  check('de wachtrij is opgeruimd na de volgordetest', (await volgorde()).length === 0);

  // --- Aanvraaglimiet bij een drukke rij ------------------------------------
  console.log('\nAanvraaglimiet');

  await nieuweRij(DRUKKE_RIJ_VANAF - 2, 'lim');
  const rustigeRij = await api('/api/queue?deviceId=lim-extra');
  check(
    `bij ${rustigeRij.data.wachtrij.length} nummers mogen er nog ${MAX_AANVRAGEN_PER_DEVICE} open staan`,
    rustigeRij.data?.maxAanvragen === MAX_AANVRAGEN_PER_DEVICE,
    `maxAanvragen: ${rustigeRij.data?.maxAanvragen}`
  );

  const eerste = await aanvraagVoor('lim-extra', 'Extra');
  check('eerste aanvraag bij een rustige rij lukt', eerste.status === 200);
  const tweede = await aanvraagVoor('lim-extra', 'Extra');
  check('tweede aanvraag bij een rustige rij lukt ook', tweede.status === 200);

  // De rij zit nu op DRUKKE_RIJ_VANAF nummers: vanaf hier geldt één per telefoon.
  const drukkeRij = await api('/api/queue?deviceId=lim-nieuw');
  check(
    `bij ${drukkeRij.data.wachtrij.length} nummers mag er nog maar 1 open staan`,
    drukkeRij.data?.wachtrij?.length >= DRUKKE_RIJ_VANAF &&
      drukkeRij.data?.maxAanvragen === MAX_AANVRAGEN_DRUKKE_RIJ,
    `rij ${drukkeRij.data?.wachtrij?.length}, maxAanvragen ${drukkeRij.data?.maxAanvragen}`
  );

  const drukEerste = await aanvraagVoor('lim-nieuw', 'Nieuw');
  check('een eerste aanvraag mag ook bij een drukke rij', drukEerste.status === 200);

  const drukTweede = await aanvraagVoor('lim-nieuw', 'Nieuw');
  check(
    'een tweede aanvraag wordt bij een drukke rij geweigerd',
    drukTweede.status === 409 && drukTweede.data?.code === 'LIMIET',
    JSON.stringify(drukTweede.data)
  );

  check(
    'wie er al twee had houdt ze gewoon',
    (await api('/api/queue')).data.wachtrij.filter((e) => e.zangerNaam === 'Extra').length === 2
  );

  // Rij weer onder de drempel brengen: dan mag het weer met z'n tweeën.
  for (const entry of (await api('/api/queue')).data.wachtrij.slice(0, 3)) {
    await api('/api/host', {
      method: 'POST',
      body: { actie: 'verwijder', requestId: entry.id },
      pin: PIN,
    });
  }
  const weerRustig = await api('/api/queue?deviceId=lim-nieuw');
  check(
    'zakt de rij weer, dan mag er weer een tweede bij',
    weerRustig.data?.maxAanvragen === MAX_AANVRAGEN_PER_DEVICE,
    `rij ${weerRustig.data?.wachtrij?.length}, maxAanvragen ${weerRustig.data?.maxAanvragen}`
  );
  check(
    '...en die aanvraag lukt dan ook',
    (await aanvraagVoor('lim-nieuw', 'Nieuw')).status === 200
  );

  for (const entry of (await api('/api/queue')).data?.wachtrij ?? []) {
    await api('/api/host', {
      method: 'POST',
      body: { actie: 'verwijder', requestId: entry.id },
      pin: PIN,
    });
  }
  check('de wachtrij is opgeruimd na de limiettest', (await volgorde()).length === 0);

  if (EXTERN) {
    console.log('\nVerrassingskeuze: overgeslagen tegen een echte server (vult de rij tot 30)');
    return;
  }

  // --- Verrassingskeuze van de host ----------------------------------------
  console.log('\nVerrassingskeuze');

  const teKort = await api('/api/host', {
    method: 'POST',
    body: { actie: 'verrassing' },
    pin: PIN,
  });
  check(
    `verrassing wordt geweigerd onder de ${VERRASSING_MIN_RIJ} nummers`,
    teKort.status === 409 && teKort.data?.code === 'TE_KORT',
    JSON.stringify(teKort.data)
  );

  await vulRijTot(VERRASSING_MIN_RIJ);
  const vol = await api('/api/queue');
  check(
    `de rij telt nu minstens ${VERRASSING_MIN_RIJ} nummers`,
    vol.data?.wachtrij?.length >= VERRASSING_MIN_RIJ,
    `${vol.data?.wachtrij?.length} nummers`
  );

  const topVoor = vol.data.wachtrij.slice(0, VERRASSING_BESCHERMDE_TOP);

  const verrassing = await api('/api/host', {
    method: 'POST',
    body: { actie: 'verrassing' },
    pin: PIN,
  });
  check('verrassing lukt bij een volle rij', verrassing.status === 200, JSON.stringify(verrassing.data));
  const gekozenId = verrassing.data?.verrassing?.id;

  check(
    `het gekozen nummer kwam van buiten de top ${VERRASSING_BESCHERMDE_TOP}`,
    verrassing.data?.verrassing?.positie > VERRASSING_BESCHERMDE_TOP &&
      !topVoor.some((e) => e.id === gekozenId),
    `stond op #${verrassing.data?.verrassing?.positie}`
  );

  const naVerrassing = await api('/api/queue');
  check(
    'het gekozen nummer staat nu op #1',
    naVerrassing.data?.wachtrij?.[0]?.id === gekozenId,
    `#1 is ${naVerrassing.data?.wachtrij?.[0]?.id}, verwacht ${gekozenId}`
  );
  check('...en is gemarkeerd als verrassingskeuze', naVerrassing.data?.wachtrij?.[0]?.verrassingOp > 0);
  check(
    '...maar wordt niet vanzelf gestart',
    naVerrassing.data?.nuAanDeBeurt?.id !== gekozenId
  );

  check(
    'de top blijft in dezelfde volgorde staan',
    naVerrassing.data.wachtrij.slice(1, VERRASSING_BESCHERMDE_TOP + 1).map((e) => e.id).join() === topVoor.map((e) => e.id).join()
  );
  check(
    'de rij is niet korter geworden',
    naVerrassing.data.wachtrij.length === vol.data.wachtrij.length
  );

  await api('/api/host', { method: 'POST', body: { actie: 'skip', requestId: gekozenId }, pin: PIN });
  const naSkipVerrassing = await api('/api/queue');
  check(
    'skip haalt de verrassingsmarkering er weer af',
    naSkipVerrassing.data?.wachtrij?.[0]?.id !== gekozenId &&
      !naSkipVerrassing.data?.wachtrij?.some((e) => e.id === gekozenId && e.verrassingOp > 0),
    `#1 is nu ${naSkipVerrassing.data?.wachtrij?.[0]?.id}`
  );
}


/**
 * Fase 13 van de Showcomposer: show-codes, het Speler-token, klaar, de score van de Knal-meter,
 * het leaderboard, de momentopname in Redis en het verbruik.
 */
async function faseDertien(show) {
  console.log('\nShows (fase 13)');
  const zonderPin = await api('/api/show', { method: 'POST', body: { naam: 'X' }, show: false });
  check('een show maken zonder pincode wordt geweigerd', zonderPin.status === 401);
  check('een show heeft een code van 5 tekens', /^[A-HJ-NP-Z2-9]{5}$/.test(show.code), show.code);
  check('...en een Speler-token', typeof show.spelerToken === 'string' && show.spelerToken.length >= 24);

  const andere = (await api('/api/show', { method: 'POST', body: { naam: 'Andor' }, pin: PIN, show: false })).data;
  check('twee shows krijgen elk een eigen code', andere?.code && andere.code !== show.code);
  const eigen = await api('/api/show', { method: 'POST', body: { naam: 'Eigen', code: 'knap-7' }, pin: PIN, show: false });
  check('een eigen code mag, genormaliseerd', eigen.status === 200 && eigen.data?.code === 'KNAP7', JSON.stringify(eigen.data));
  check(
    'dezelfde eigen code nogmaals wordt geweigerd',
    (await api('/api/show', { method: 'POST', body: { naam: 'Eigen', code: 'KNAP7' }, pin: PIN, show: false })).status === 409
  );

  const info = await api(`/api/show?s=${show.code.toLowerCase()}`);
  check('een show opzoeken kan ook met kleine letters', info.status === 200 && info.data?.naam === 'Testavond');
  check('een onbekende code geeft 404', (await api('/api/show?s=ZZZZZ')).status === 404);
  check('een ongeldige code geeft 400', (await api('/api/queue?s=0O1')).status === 400);
  check('zonder code geen wachtrij', (await api('/api/queue', { show: false })).status === 400);
  check('de wachtrij noemt de show', (await api('/api/queue')).data?.show?.naam === 'Testavond');

  // Scheiding: een aanvraag in de andere show komt niet in deze rij.
  const lied = (await api('/api/songs?q=wonderwall')).data.resultaten[0];
  const bijAndor = await api('/api/request', { method: 'POST', body: { songId: lied.id, zangerNaam: 'Andor-gast', deviceId: 'dev-andor' }, show: andere.code });
  check('aanvragen in een andere show lukt', bijAndor.status === 200, JSON.stringify(bijAndor.data));
  const rijAndor = (await api('/api/queue', { show: andere.code })).data;
  const rijHier = (await api('/api/queue')).data;
  check('de andere show heeft één nummer', rijAndor?.wachtrij?.length === 1);
  check('...dat niet in deze show staat', !rijHier?.wachtrij?.some((e) => e.titel === lied.titel && e.zangerNaam === 'Andor-gast'));
  const opnieuwHier = await api('/api/request', { method: 'POST', body: { songId: lied.id, zangerNaam: 'Hier', deviceId: 'dev-hier' } });
  check('hetzelfde nummer mag in een andere show ook', opnieuwHier.status === 200 || opnieuwHier.data?.code === 'LIMIET', JSON.stringify(opnieuwHier.data));

  const voorvlucht = await fetch(`${BASE}/api/host?s=${show.code}`, {
    method: 'OPTIONS',
    headers: { Origin: 'tauri://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  check(
    'de API mag vanuit een andere origin (de Speler)',
    voorvlucht.status < 300 && voorvlucht.headers.get('access-control-allow-origin') === '*' && /authorization/i.test(voorvlucht.headers.get('access-control-allow-headers') ?? ''),
    `${voorvlucht.status} ${voorvlucht.headers.get('access-control-allow-headers')}`
  );

  console.log('\nSpeler-token (fase 13)');
  const metToken = await api('/api/host', { method: 'POST', body: { actie: 'login' }, token: show.spelerToken });
  check('het Speler-token mag host-acties doen', metToken.status === 200, JSON.stringify(metToken.data));
  const verkeerdToken = await api('/api/host', { method: 'POST', body: { actie: 'login' }, token: 'nep' });
  check('een verkeerd token wordt geweigerd', verkeerdToken.status === 401 && verkeerdToken.data?.code === 'TOKEN');
  const tokenAndereShow = await api('/api/host', { method: 'POST', body: { actie: 'login' }, token: show.spelerToken, show: andere.code });
  check('het token van de ene show werkt niet bij de andere', tokenAndereShow.status === 401);
  check(
    'de pincode werkt voor elke show',
    (await api('/api/host', { method: 'POST', body: { actie: 'login' }, pin: PIN, show: andere.code })).status === 200
  );

  console.log('\nKlaar, score en leaderboard (fase 13)');
  // Een schone show voor dit deel, zodat de verwachtingen niet afhangen van de rest van de suite.
  const avond = (await api('/api/show', { method: 'POST', body: { naam: 'Scoreavond' }, pin: PIN, show: false })).data;
  const ah = (pad, o = {}) => api(pad, { ...o, show: avond.code });
  const host = (body) => ah('/api/host', { method: 'POST', body, token: avond.spelerToken });
  const songs = (await api('/api/songs?q=love')).data.resultaten.slice(0, 4);
  const ids = [];
  for (const [i, song] of songs.entries()) {
    const r = await ah('/api/request', { method: 'POST', body: { songId: song.id, zangerNaam: `Zanger ${i}`, deviceId: `dev-score-${i}` } });
    ids.push(r.data?.id);
  }
  check('vier aanvragen in de scoreshow', ids.every(Boolean), JSON.stringify(ids));

  const teVroeg = await host({ actie: 'uitslag', requestId: ids[0], score: 7000, labels: ['Toonvast'] });
  check('een score voor een nummer dat nog niet gezongen is wordt geweigerd', teVroeg.status === 409);

  await host({ actie: 'start', requestId: ids[0] });
  const s0 = await host({ actie: 'uitslag', requestId: ids[0], score: 7200, labels: ['Toonvast', 'Stemmingmaker'] });
  check('een score voor het spelende nummer lukt', s0.status === 200 && s0.data?.uitslag?.score === 7200, JSON.stringify(s0.data));
  check('een score boven 10.000 wordt geweigerd', (await host({ actie: 'uitslag', requestId: ids[0], score: 12000 })).status === 400);
  check('een score die geen getal is wordt geweigerd', (await host({ actie: 'uitslag', requestId: ids[0], score: 'veel' })).status === 400);

  console.log('\nScore met opbouw en de bonus van de jury (fase 13.8)');
  const metOpbouw = await host({ actie: 'uitslag', requestId: ids[0], score: 7700, labels: ['Toonvast'], opbouw: { meter: 7200, klassieker: 500, herhaling: 0, bonus: 0 } });
  check('een score met opbouw wordt bewaard', metOpbouw.status === 200 && metOpbouw.data?.uitslag?.opbouw?.klassieker === 500, JSON.stringify(metOpbouw.data));
  const opTelefoon = (await ah('/api/queue?deviceId=dev-score-0')).data?.mijnUitslagen?.[0];
  check('de zanger ziet de eindscore met de opbouw', opTelefoon?.score === 7700 && opTelefoon?.opbouw?.meter === 7200 && opTelefoon?.opbouw?.klassieker === 500);
  const metBonus = await host({ actie: 'uitslag', requestId: ids[0], score: 7950, labels: ['Toonvast'], opbouw: { meter: 7200, klassieker: 500, herhaling: 0, bonus: 250 } });
  check('de bonus van de jury komt als nieuwe uitslag binnen en vervangt de vorige', metBonus.status === 200 && (await ah('/api/leaderboard')).data?.leaderboard?.[0]?.opbouw?.bonus === 250);
  check('...met de nieuwe eindscore op de telefoon', (await ah('/api/queue?deviceId=dev-score-0')).data?.mijnUitslagen?.[0]?.score === 7950);
  const herhaling = await host({ actie: 'uitslag', requestId: ids[0], score: 6900, labels: [], opbouw: { meter: 7200, klassieker: 0, herhaling: -300, bonus: 0 } });
  check('een aftrek voor een herhaling is negatief in de opbouw', herhaling.status === 200 && herhaling.data?.uitslag?.opbouw?.herhaling === -300);
  const rommelOpbouw = await host({ actie: 'uitslag', requestId: ids[0], score: 7200, labels: ['Toonvast', 'Stemmingmaker'], opbouw: 'onzin' });
  check('een onbruikbare opbouw wordt genegeerd (null), de score blijft', rommelOpbouw.status === 200 && rommelOpbouw.data?.uitslag?.opbouw === null && rommelOpbouw.data?.uitslag?.score === 7200);
  check('zonder opbouw is de opbouw null', (await host({ actie: 'uitslag', requestId: ids[0], score: 7200, labels: ['Toonvast', 'Stemmingmaker'] })).data?.uitslag?.opbouw === null);

  const klaar = await host({ actie: 'klaar' });
  check('klaar haalt het spelende nummer van het podium', klaar.status === 200 && klaar.data?.klaar?.id === ids[0]);
  const naKlaar = (await ah('/api/queue?deviceId=dev-score-0')).data;
  check('...daarna zingt er niemand', naKlaar?.nuAanDeBeurt === null);
  check('...en de rij heeft er nog drie', naKlaar?.wachtrij?.length === 3);
  check('klaar zonder spelend nummer doet niets', (await host({ actie: 'klaar' })).data?.klaar === null);
  check('de zanger ziet zijn score', naKlaar?.mijnUitslagen?.[0]?.score === 7200 && naKlaar.mijnUitslagen[0].isMijn === true, JSON.stringify(naKlaar?.mijnUitslagen));
  check('...met de labels', naKlaar?.mijnUitslagen?.[0]?.labels?.join('|') === 'Toonvast|Stemmingmaker');
  check(
    'een ander ziet de score in het leaderboard maar niet als de zijne',
    (await ah('/api/queue?deviceId=dev-score-1')).data?.leaderboard?.[0]?.isMijn === false
  );
  check('het leaderboard verraadt geen apparaten', !JSON.stringify(naKlaar?.leaderboard).includes('dev-score'));

  await host({ actie: 'start', requestId: ids[1] });
  await host({ actie: 'uitslag', requestId: ids[1], score: 9100, labels: ['Powerhouse'] });
  await host({ actie: 'start', requestId: ids[2] });
  await host({ actie: 'uitslag', requestId: ids[2], score: 7200, labels: [] });
  // Een score van een al afgelopen nummer bijstellen mag.
  const bijgesteld = await host({ actie: 'uitslag', requestId: ids[0], score: 8000, labels: ['Toonvast'] });
  check('een score van een afgelopen nummer bijstellen mag', bijgesteld.status === 200);
  const lb = (await ah('/api/leaderboard')).data?.leaderboard ?? [];
  check(
    'het leaderboard staat op score, hoogste eerst',
    lb.map((u) => u.id).join(',') === [ids[1], ids[0], ids[2]].join(','),
    lb.map((u) => `${u.id}:${u.score}`).join(', ')
  );
  check('...en de bijgestelde score vervangt de oude', lb.find((u) => u.id === ids[0])?.score === 8000);
  check('...ook als het nummer al klaar is (start van de volgende archiveert het)', lb.length === 3);
  check('het leaderboard van een andere show is leeg', ((await api('/api/leaderboard', { show: andere.code })).data?.leaderboard ?? []).length === 0);

  console.log('\nScores aan en uit (Speler, 3 november 2026)');
  check('standaard staan de scores aan', (await ah('/api/queue?deviceId=dev-score-0')).data?.show?.scoresAan === true);
  const uit = await host({ actie: 'scores', aan: false });
  check('scores uitzetten met het Speler-token lukt', uit.status === 200 && uit.data?.scoresAan === false, JSON.stringify(uit.data));
  const zonder = (await ah('/api/queue?deviceId=dev-score-0')).data;
  check('...dan geen leaderboard op de telefoon', zonder?.show?.scoresAan === false && zonder.leaderboard.length === 0);
  check('...en geen eigen score', zonder?.mijnUitslagen?.length === 0);
  check('...maar de Speler houdt het hele leaderboard', ((await ah('/api/leaderboard')).data?.leaderboard ?? []).length === 3);
  check('scores uitzetten zonder token of pin mag niet', (await ah('/api/host', { method: 'POST', body: { actie: 'scores', aan: true } })).status === 401);
  await host({ actie: 'scores', aan: true });
  const weerAan = (await ah('/api/queue?deviceId=dev-score-0')).data;
  check('weer aan: de scores van eerder staan er weer', weerAan?.leaderboard?.length === 3 && weerAan.mijnUitslagen?.[0]?.score === 8000);

  console.log('\nScore weghalen (Speler, 3 november 2026)');
  const wegHalen = await host({ actie: 'uitslagweg', requestId: ids[2] });
  check('een score weghalen lukt', wegHalen.status === 200 && wegHalen.data?.weg === true, JSON.stringify(wegHalen.data));
  const naWeg = (await ah('/api/queue?deviceId=dev-score-2')).data;
  check('...uit het leaderboard', naWeg?.leaderboard?.length === 2 && !naWeg.leaderboard.some((u) => u.id === ids[2]));
  check('...en van de telefoon van die zanger', naWeg?.mijnUitslagen?.length === 0);
  check('...de andere scores blijven', ((await ah('/api/leaderboard')).data?.leaderboard ?? []).map((u) => u.id).join() === [ids[1], ids[0]].join());
  // Na het zingen mag een gast hetzelfde nummer nogmaals aanvragen (de Knal-meter rekent dan de aftrek).
  const nogEens = await ah('/api/request', { method: 'POST', body: { songId: songs[0].id, zangerNaam: 'Zanger 9', deviceId: 'dev-score-9' } });
  check('een nummer dat al gezongen is, mag opnieuw aangevraagd worden', nogEens.status === 200, JSON.stringify(nogEens.data));
  await host({ actie: 'verwijder', requestId: nogEens.data?.id });
  check('nogmaals weghalen doet niets', (await host({ actie: 'uitslagweg', requestId: ids[2] })).data?.weg === false);
  check('weghalen zonder token of pin mag niet', (await ah('/api/host', { method: 'POST', body: { actie: 'uitslagweg', requestId: ids[0] } })).status === 401);

  console.log('\nNummer toevoegen door de host (Speler, 3 november 2026)');
  const kandidaten = (await api('/api/songs?q=queen')).data.resultaten;
  const rijVoor = (await ah('/api/queue')).data.wachtrij;
  const bezet = new Set([...rijVoor.map((e) => e.songId), ...songs.map((x) => x.id)]);
  const [hostA, hostB] = kandidaten.filter((x) => !bezet.has(x.id));
  const t1 = await host({ actie: 'toevoegen', songId: hostA.id, zangerNaam: 'Kees', extraSingers: ['Mieke'] });
  check('de host voegt een nummer toe', t1.status === 200 && t1.data?.toegevoegd?.id, JSON.stringify(t1.data));
  let rij = (await ah('/api/queue?deviceId=dev-score-3')).data.wachtrij;
  const achter = rij.at(-1);
  check('...achteraan de rij', achter?.id === t1.data.toegevoegd.id && t1.data.toegevoegd.positie === rij.length);
  check('...met de markering via host en de tweede zanger', achter?.viaHost === true && achter.extraSingers.join() === 'Mieke' && achter.zangerNaam === 'Kees');
  check('...en gasten zijn niet "via host"', rij.filter((e) => e.id !== achter.id).every((e) => e.viaHost === false));
  const t2 = await host({ actie: 'toevoegen', songId: hostB.id, zangerNaam: 'Lot', volgende: true });
  rij = (await ah('/api/queue')).data.wachtrij;
  check('als volgende: direct onder het spelende nummer', t2.status === 200 && rij[0]?.id === t2.data?.toegevoegd?.id && t2.data.toegevoegd.positie === 1, rij.map((e) => e.zangerNaam).join(', '));
  check('...de rest schuift één plek op, in dezelfde volgorde', rij.slice(1).map((e) => e.id).join() === [...rijVoor.map((e) => e.id), t1.data.toegevoegd.id].join());
  check('de host mag meer dan twee nummers (geen limiet per telefoon)', (await host({ actie: 'toevoegen', songId: kandidaten.find((x) => !bezet.has(x.id) && x.id !== hostA.id && x.id !== hostB.id).id, zangerNaam: 'Kees' })).status === 200);
  const dubbelHost = await host({ actie: 'toevoegen', songId: hostA.id, zangerNaam: 'Piet' });
  check('een nummer dat al in de rij staat wordt geweigerd', dubbelHost.status === 409 && dubbelHost.data?.code === 'DUBBEL');
  check('een nummer buiten de catalogus wordt geweigerd', (await host({ actie: 'toevoegen', songId: 'bestaat-niet-999', zangerNaam: 'Piet' })).status === 404);
  check('zonder naam wordt geweigerd', (await host({ actie: 'toevoegen', songId: kandidaten.at(-1).id, zangerNaam: ' ' })).status === 400);
  check('toevoegen zonder token of pin mag niet', (await ah('/api/host', { method: 'POST', body: { actie: 'toevoegen', songId: hostA.id, zangerNaam: 'x' } })).status === 401);
  const gestart = await host({ actie: 'start', requestId: t2.data.toegevoegd.id });
  check('het host-nummer is gewoon te starten', gestart.status === 200 && (await ah('/api/queue')).data.nuAanDeBeurt?.viaHost === true);

  if (!EXTERN) {
    console.log('\nVerbruik (fase 13)');
    // Twintig telefoons pollen tien keer zonder dat er iets verandert: de momentopname in
    // Redis en het geheugen houden dat op hoogstens een paar commando's.
    await wacht(3200);
    await redisCmd(['teller-nul']);
    for (let ronde = 0; ronde < 10; ronde++) {
      await Promise.all(Array.from({ length: 20 }, (_, t) => ah(`/api/queue?deviceId=dev-poll-${t}`)));
    }
    const rustig = await redisCmd(['teller']);
    check(`200 keer pollen zonder wijziging kost hoogstens 5 commando's (${rustig})`, rustig <= 5);

    // Na het verlopen van het geheugen leest de server de momentopname: één commando.
    await wacht(3200);
    await redisCmd(['teller-nul']);
    await ah('/api/queue?deviceId=dev-poll-0');
    const eenKeer = await redisCmd(['teller']);
    check(`een verse lezing met momentopname kost 1 commando (${eenKeer})`, eenKeer === 1);

    // Na een wijziging wordt de rij één keer opnieuw opgebouwd.
    await host({ actie: 'skip', requestId: ids[3] });
    await redisCmd(['teller-nul']);
    await ah('/api/queue');
    const opnieuw = await redisCmd(['teller']);
    check(`na een wijziging kost de eerste lezing een paar commando's (${opnieuw})`, opnieuw > 1 && opnieuw < 20);
    await redisCmd(['teller-nul']);
    await ah('/api/queue');
    check('...en de volgende weer niets', (await redisCmd(['teller'])) === 0);

    // Schatting voor een avond: 4 uur, 20 telefoons die elke 4 s pollen (een lezing per
    // 3 s per instantie), 2 wijzigingen per minuut.
    const perAvond = Math.round((4 * 3600) / 3 * eenKeer + 4 * 60 * 2 * (opnieuw + 4));
    check(`een avond van vier uur kost naar schatting ${perAvond} commando's, onder de 20.000`, perAvond < 20000);
  }
}

/** Vult de wachtrij aan tot minstens `doel` nummers, met steeds nieuwe apparaten. */
async function vulRijTot(doel) {
  const gebruikteSongs = new Set(
    ((await api('/api/queue')).data?.wachtrij ?? []).map((e) => e.songId)
  );

  const kandidaten = [];
  for (const term of ['love', 'you', 'night', 'dance', 'rock', 'baby', 'heart', 'time', 'home']) {
    for (const song of (await api(`/api/songs?q=${term}`)).data?.resultaten ?? []) {
      if (!gebruikteSongs.has(song.id)) {
        gebruikteSongs.add(song.id);
        kandidaten.push(song);
      }
    }
  }

  let index = 0;
  // Eén apparaat per aanvraag: bij een drukke rij mag er nog maar één per
  // telefoon openstaan, dus twee per apparaat loopt vast.
  let device = 0;
  let inRij = ((await api('/api/queue')).data?.wachtrij ?? []).length;

  while (inRij < doel && index < kandidaten.length) {
    const res = await api('/api/request', {
      method: 'POST',
      body: {
        songId: kandidaten[index].id,
        zangerNaam: `Vuller ${device}`,
        deviceId: `dev-vul-${device}`,
        // Af en toe een duet, zodat de volle rij ook die weergave dekt.
        ...(index % 4 === 0 ? { extraSingers: [`Maatje ${device}`] } : {}),
      },
    });
    index++;
    if (res.status !== 200) continue;

    inRij++;
    device++;
  }
}

/** Het vaste instapadres /go en de actieve shows. */
async function actieveShows(show) {
  console.log('\nActieve shows en /go');
  const go = async () => {
    const r = await fetch(`${BASE}/go`, { redirect: 'manual' });
    return { status: r.status, naar: new URL(r.headers.get('location') ?? '/', BASE) };
  };
  const lijst = async () => (await api('/api/show/actief', { show: false })).data?.shows ?? [];

  let g = await go();
  check('geen actieve show: /go stuurt naar de codepagina', g.status === 307 && g.naar.pathname === '/' && g.naar.searchParams.get('go') === '1' && !g.naar.searchParams.get('s'), g.naar.href);
  check('...en de lijst is leeg', (await lijst()).length === 0);

  check('actief zetten zonder pincode of token wordt geweigerd', (await api('/api/show/actief', { method: 'POST', body: { show: show.code, actief: true }, show: false })).status === 401);
  const metToken = await api('/api/show/actief', { method: 'POST', body: { show: show.code, actief: true }, token: show.spelerToken, show: false });
  check('de Showcomposer zet een show actief met het Speler-token', metToken.status === 200 && metToken.data?.actief === true, JSON.stringify(metToken.data));
  check('het token van een show geldt niet voor een andere show', (await api('/api/show/actief', { method: 'POST', body: { show: 'KNAP7', actief: true }, token: show.spelerToken, show: false })).status === 401);
  check('/api/show noemt of de show actief is', (await api(`/api/show?s=${show.code}`, { show: false })).data?.actief === true);

  g = await go();
  check('één actieve show: /go stuurt direct naar /?s=CODE', g.status === 307 && g.naar.searchParams.get('s') === show.code, g.naar.href);

  const nieuw = (await api('/api/show', { method: 'POST', body: { naam: 'Tweede zaal', actief: true }, pin: PIN, show: false })).data;
  check('Show maken met actief: true zet de nieuwe show meteen actief', nieuw?.actief === true);
  const twee = await lijst();
  check('meerdere actieve shows: de lijst heeft naam, code en aanmaaktijd, nieuwste eerst', twee.length === 2 && twee[0].code === nieuw.code && twee[0].naam === 'Tweede zaal' && twee[0].aangemaakt >= twee[1].aangemaakt, JSON.stringify(twee));
  g = await go();
  check('...en /go toont de codepagina met de keuze', g.naar.searchParams.get('go') === '1' && !g.naar.searchParams.get('s'), g.naar.href);

  const metPin = await api('/api/show/actief', { method: 'POST', body: { show: nieuw.code, actief: false }, pin: PIN, show: false });
  check('de schakelaar op /host zet een show uit met de pincode', metPin.status === 200 && metPin.data?.actief === false);
  check('...dan is er weer één actieve show', (await lijst()).length === 1);
  check('een onbekende show actief zetten geeft 404', (await api('/api/show/actief', { method: 'POST', body: { show: 'ZZZZZ', actief: true }, pin: PIN, show: false })).status === 404);

  const los = await api('/api/show/actief', { method: 'POST', body: { show: show.code, actief: false }, token: show.spelerToken, show: false });
  check('Loskoppelen in de Showcomposer haalt de markering weg', los.status === 200 && (await lijst()).length === 0);

  if (EXTERN) {
    console.log('  (verlopen: overgeslagen, draait alleen tegen fake-upstash)');
    return;
  }
  // Een show die verloopt (de sleutel is weg, zoals na de TTL van 48 uur) is niet meer actief.
  await api('/api/show/actief', { method: 'POST', body: { show: nieuw.code, actief: true }, pin: PIN, show: false });
  await redisCmd(['del', `show:${nieuw.code}`]);
  check('een verlopen show staat niet meer in de lijst', (await lijst()).length === 0);
  check('...en is uit de set gehaald', (await redisCmd(['smembers', 'actieve-shows'])).length === 0);
  g = await go();
  check('...en /go stuurt naar de codepagina', g.naar.searchParams.get('go') === '1');
}

try {
  await opzetten();
  const show = await showMaken();
  await testen();
  await faseDertien(show);
  await actieveShows(show);
} catch (error) {
  gefaald++;
  console.error(`\n\x1b[31mAfgebroken:\x1b[0m ${error.message}`);
} finally {
  stopAlles();
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald === 0 ? 0 : 1);
