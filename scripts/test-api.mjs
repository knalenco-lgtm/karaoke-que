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

// Spiegelt lib/constants.ts — een .mjs-script kan geen TypeScript importeren.
const VERRASSING_MIN_RIJ = 30;
const VERRASSING_BESCHERMDE_TOP = 5;
const GROTE_RIJ_VANAF = 7;
const SPRONG_KORTE_RIJ = 1;
const SPRONG_VOLLE_RIJ = 2;
const BESCHERMING_NA_RONDES = 2;

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

async function api(pad, { method = 'GET', body, pin } = {}) {
  const res = await fetch(BASE + pad, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(pin ? { 'x-host-pin': pin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
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
  if (!(await wachtTot(`${BASE}/api/queue`, 90))) {
    throw new Error('next dev startte niet');
  }
  console.log(`Server draait op ${BASE}\n`);
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

  // --- Stemmen (rondemodel) -----------------------------------------------
  console.log('\nStemmen');
  check(
    'stemmen op andermans nummer lukt',
    (await api('/api/vote', { method: 'POST', body: { requestId: idB, deviceId: DEVICE_B } }))
      .status === 200
  );

  const nogmaals = await api('/api/vote', {
    method: 'POST',
    body: { requestId: idB, deviceId: DEVICE_B },
  });
  check('nogmaals op hetzelfde nummer stemmen is geen fout', nogmaals.status === 200);
  check('...en levert nog steeds één stem op', nogmaals.data?.stemmen === 1);

  check(
    'stemmen op je eigen nummer wordt geweigerd',
    (await api('/api/vote', { method: 'POST', body: { requestId: idB, deviceId: DEVICE_A } }))
      .status === 403
  );

  const verplaatst = await api('/api/vote', {
    method: 'POST',
    body: { requestId: idA, deviceId: DEVICE_B },
  });
  check('op een ander nummer stemmen verplaatst je stem', verplaatst.data?.stemmen === 1);
  const naVerplaatsing = await api('/api/queue');
  check(
    '...en het vorige nummer staat weer op nul',
    naVerplaatsing.data?.wachtrij?.find((e) => e.id === idB)?.stemmen === 0,
    JSON.stringify(naVerplaatsing.data?.wachtrij?.map((e) => [e.id, e.stemmen]))
  );

  // Terugzetten voor de rest van de tests.
  await api('/api/vote', { method: 'POST', body: { requestId: idB, deviceId: DEVICE_B } });

  // --- Wachtrij ------------------------------------------------------------
  console.log('\nWachtrij');
  const rij = await api(`/api/queue?deviceId=${DEVICE_A}`);
  check('wachtrij bevat beide aanvragen', rij.data?.wachtrij?.length === 2);
  check(
    'de rij staat op volgorde van binnenkomst, niet op stemmen',
    rij.data?.wachtrij?.[0]?.id === idA && rij.data?.wachtrij?.[1]?.id === idB,
    `volgorde: ${rij.data?.wachtrij?.map((e) => e.id).join(', ')}`
  );
  check('er speelt nog niks', rij.data?.nuAanDeBeurt === null);
  check('eigen aanvragen zijn gemarkeerd', rij.data?.wachtrij?.every((e) => e.isMijn === true));
  check('eigen aanvragen worden geteld', rij.data?.eigenAanvragen === 2);

  const rijB = await api(`/api/queue?deviceId=${DEVICE_B}`);
  const entryB = rijB.data?.wachtrij?.find((e) => e.id === idB);
  check('device B ziet waar zijn stem heen ging', entryB?.heeftMijnStem === true);
  check('...en de response noemt dat nummer', rijB.data?.mijnStem === idB);
  check('op je eigen keuze nog eens stemmen heeft geen zin', entryB?.magStemmen === false);
  check(
    'niemand kan zien wie er gestemd heeft',
    !JSON.stringify(rijB.data).includes(DEVICE_B),
    'deviceId lekt in de queue-response'
  );

  // --- Check-in ------------------------------------------------------------
  console.log('\nCheck-in');
  check(
    'check-in bevestigen lukt',
    (await api('/api/checkin', { method: 'POST', body: { requestId: idA, deviceId: DEVICE_A } }))
      .status === 200
  );
  check(
    'check-in van een ander device wordt geweigerd',
    (await api('/api/checkin', { method: 'POST', body: { requestId: idA, deviceId: DEVICE_B } }))
      .status === 403
  );
  check(
    'nog geen check-in nodig bij een verse rij',
    (await api(`/api/queue?deviceId=${DEVICE_A}`)).data?.checkin === null
  );

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

  // idB heeft de enige stem en staat nu vooraan; door hem te starten vervalt de sprong.
  const gestart = await api('/api/host', {
    method: 'POST',
    body: { actie: 'start', requestId: idB },
    pin: PIN,
  });
  check('de host kan een nummer starten', gestart.status === 200, JSON.stringify(gestart.data));
  check(
    'de sprong vervalt als de winnaar zelf gestart wordt',
    gestart.data?.start?.winnaar?.id === idB && gestart.data?.start?.winnaar?.gesprongen === false,
    JSON.stringify(gestart.data?.start?.winnaar)
  );

  const naStart = await api('/api/queue');
  check('het gestarte nummer is nu aan de beurt', naStart.data?.nuAanDeBeurt?.id === idB);
  check('...en staat niet meer in de wachtrij', !naStart.data?.wachtrij?.some((e) => e.id === idB));
  check('de stemmen zijn gewist', naStart.data?.wachtrij?.every((e) => e.stemmen === 0));
  check('er loopt een nieuwe ronde', naStart.data?.ronde === 2);
  check('de winnaar heeft de bekerbadge', naStart.data?.nuAanDeBeurt?.isWinnaarVorigeRonde === true);

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
      extraSingers: ['Lisa', 'Tom'],
      deviceId: DEVICE_A,
    },
  });
  check('aanvraag met twee extra zangers lukt', duet.status === 200, JSON.stringify(duet.data));

  const naDuet = await api('/api/queue');
  const duetEntry = naDuet.data?.wachtrij?.find((e) => e.id === duet.data?.id);
  check(
    'extra zangers komen terug in de wachtrij',
    JSON.stringify(duetEntry?.extraSingers) === JSON.stringify(['Lisa', 'Tom']),
    JSON.stringify(duetEntry?.extraSingers)
  );

  const teVeel = await api('/api/request', {
    method: 'POST',
    body: {
      songId: duetSongs[1].id,
      zangerNaam: 'Bram',
      extraSingers: ['Een', 'Twee', 'Drie'],
      deviceId: DEVICE_B,
    },
  });
  check(
    'meer dan drie zangers wordt geweigerd',
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
    // Een aanvraag zoals die vóór de duet-functie werd weggeschreven: zonder
    // extraSingers en zonder verrassingOp. Die moet gewoon blijven werken.
    const toen = String(Date.now());
    await redisCmd([
      'hset', 'req:legacy-1',
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
    await redisCmd(['sadd', 'live', 'legacy-1']);
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
    await api('/api/request', {
      method: 'DELETE',
      body: { requestId: 'legacy-1', deviceId: 'dev-legacy' },
    });
  }

  for (const [id, device] of [
    [duet.data?.id, DEVICE_A],
    [rommel.data?.id, DEVICE_B],
    [solo.data?.id, DEVICE_C],
  ]) {
    await api('/api/request', { method: 'DELETE', body: { requestId: id, deviceId: device } });
  }
  check('wachtrij is na het opruimen weer leeg', (await api('/api/queue')).data?.wachtrij?.length === 0);

  // --- Stemronde ------------------------------------------------------------
  console.log('\nStemronde');

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

  /** Vraagt één nummer aan namens een eigen apparaat; slaat bezette nummers over. */
  async function vraagAan(prefix, i) {
    while (voorraadIndex < voorraad.length) {
      const res = await api('/api/request', {
        method: 'POST',
        body: {
          songId: voorraad[voorraadIndex++].id,
          zangerNaam: `${prefix}${i}`,
          deviceId: `${prefix}-dev-${i}`,
        },
      });
      if (res.status === 200) return res.data.id;
    }
    throw new Error('Voorraad nummers op.');
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

  const stemOp = (id, kiezer) =>
    api('/api/vote', { method: 'POST', body: { requestId: id, deviceId: kiezer } });
  const startNummer = (id) =>
    api('/api/host', { method: 'POST', body: { actie: 'start', requestId: id }, pin: PIN });
  const volgorde = async () => ((await api('/api/queue')).data?.wachtrij ?? []).map((e) => e.id);

  // Korte rij: de winnaar schuift één plek op.
  const kort = await nieuweRij(5, 'kort');
  await stemOp(kort[3], 'kiezer-1');
  await stemOp(kort[3], 'kiezer-2');
  const rondeKort = await startNummer(kort[0]);
  check(
    'winnaar en stemaantal worden teruggemeld',
    rondeKort.data?.start?.winnaar?.id === kort[3] &&
      rondeKort.data.start.winnaar.stemmen === 2 &&
      rondeKort.data.start.winnaar.gesprongen === true,
    JSON.stringify(rondeKort.data?.start?.winnaar)
  );
  check(
    `winnaar springt ${SPRONG_KORTE_RIJ} plek bij een rij onder de ${GROTE_RIJ_VANAF}`,
    (await volgorde()).join() === [kort[1], kort[3], kort[2], kort[4]].join(),
    `volgorde: ${(await volgorde()).join(', ')}`
  );
  const naRondeKort = await api('/api/queue');
  check('alle stemmen zijn gewist na de ronde', naRondeKort.data.wachtrij.every((e) => e.stemmen === 0));
  check(
    'de winnaar draagt de bekerbadge',
    naRondeKort.data.wachtrij.find((e) => e.id === kort[3])?.isWinnaarVorigeRonde === true
  );

  // Volle rij: de winnaar schuift twee plekken op.
  const vol7 = await nieuweRij(GROTE_RIJ_VANAF, 'vol');
  await stemOp(vol7[4], 'kiezer-1');
  await startNummer(vol7[0]);
  check(
    `winnaar springt ${SPRONG_VOLLE_RIJ} plekken vanaf ${GROTE_RIJ_VANAF} nummers`,
    (await volgorde()).join() ===
      [vol7[1], vol7[4], vol7[2], vol7[3], vol7[5], vol7[6]].join(),
    `volgorde: ${(await volgorde()).join(', ')}`
  );

  // Gelijke stand: wie het langst in de rij staat wint.
  const gelijk = await nieuweRij(5, 'gel');
  await stemOp(gelijk[2], 'kiezer-1');
  await stemOp(gelijk[3], 'kiezer-2');
  const rondeGelijk = await startNummer(gelijk[0]);
  check(
    'bij gelijke stand wint wie het langst in de rij staat',
    rondeGelijk.data?.start?.winnaar?.id === gelijk[2],
    `winnaar: ${rondeGelijk.data?.start?.winnaar?.id}, verwacht ${gelijk[2]}`
  );

  // Zonder stemmen verschuift er niets.
  const stil = await nieuweRij(4, 'stil');
  const rondeStil = await startNummer(stil[0]);
  check('zonder stemmen is er geen winnaar', rondeStil.data?.start?.winnaar === null);
  check(
    '...en blijft de volgorde ongewijzigd',
    (await volgorde()).join() === [stil[1], stil[2], stil[3]].join()
  );

  // Host start een ander nummer dan #1.
  const midden = await nieuweRij(5, 'mid');
  await stemOp(midden[4], 'kiezer-1');
  await startNummer(midden[2]);
  check(
    'host mag een nummer midden uit de rij starten',
    (await api('/api/queue')).data?.nuAanDeBeurt?.id === midden[2]
  );
  check(
    '...en de winnaar springt gewoon binnen de rest',
    (await volgorde()).join() === [midden[0], midden[1], midden[4], midden[3]].join(),
    `volgorde: ${(await volgorde()).join(', ')}`
  );

  // Beschermregel: twee rondes stilstaan maakt onpasseerbaar.
  const bes = await nieuweRij(6, 'bes');
  await stemOp(bes[3], 'kiezer-1');
  await startNummer(bes[0]); // bes[2] blijft op #3 staan -> stilstand 1 na de volgende ronde
  await stemOp(bes[4], 'kiezer-1');
  await startNummer(bes[1]);
  await stemOp(bes[5], 'kiezer-1');
  await startNummer(bes[3]);

  const naDrieRondes = await api('/api/queue');
  const beschermd = naDrieRondes.data.wachtrij.find((e) => e.id === bes[2]);
  check(
    `na ${BESCHERMING_NA_RONDES} rondes stilstand is een aanvraag beschermd`,
    beschermd?.isBeschermd === true,
    JSON.stringify(naDrieRondes.data.wachtrij.map((e) => [e.id, e.isBeschermd]))
  );

  const inhaler = await vraagAan('bes', 6);
  await stemOp(inhaler, 'kiezer-1');
  const rondeBlok = await startNummer(bes[4]);
  check(
    'de rondewinnaar kan een beschermde aanvraag niet passeren',
    rondeBlok.data?.start?.winnaar?.id === inhaler &&
      rondeBlok.data.start.winnaar.gesprongen === false,
    JSON.stringify(rondeBlok.data?.start?.winnaar)
  );
  check(
    '...en blijft er dus netjes onder staan',
    (await volgorde()).join() === [bes[5], bes[2], inhaler].join(),
    `volgorde: ${(await volgorde()).join(', ')}`
  );
  check(
    'zodra de beschermde aanvraag opschuift vervalt de bescherming',
    (await api('/api/queue')).data.wachtrij.find((e) => e.id === bes[2])?.isBeschermd === false
  );

  for (const entry of (await api('/api/queue')).data?.wachtrij ?? []) {
    await api('/api/host', {
      method: 'POST',
      body: { actie: 'verwijder', requestId: entry.id },
      pin: PIN,
    });
  }
  check('de wachtrij is opgeruimd na de stemrondes', (await volgorde()).length === 0);

  // --- Check-in die verloopt ----------------------------------------------
  // Vereist directe toegang tot de datastore om de klok terug te zetten;
  // met een echte Upstash-database slaan we dit over.
  if (EXTERN) {
    console.log('\nCheck-in-verval — overgeslagen (draait alleen tegen fake-upstash)');
    return;
  }
  console.log('\nCheck-in die verloopt');

  const drie = (await api('/api/songs?q=love')).data.resultaten.slice(0, 3);
  const ids = [];
  for (const [i, song] of drie.entries()) {
    const res = await api('/api/request', {
      method: 'POST',
      body: { songId: song.id, zangerNaam: `Zanger ${i}`, deviceId: `dev-${i}` },
    });
    ids.push(res.data.id);
  }

  // De rij staat op volgorde van binnenkomst, dus de derde aanvraag staat op #3
  // en is daarmee niet vrijgesteld van de check-in.
  const doelId = ids[2];
  const opgesteld = await api('/api/queue');
  check(
    'testnummer staat op #3',
    opgesteld.data?.wachtrij?.[2]?.id === doelId,
    `#3 is ${opgesteld.data?.wachtrij?.[2]?.id}, verwacht ${doelId}`
  );

  /**
   * Zet de aanvraag zoveel minuten terug in de tijd. Omdat we buiten de app om
   * schrijven, moeten we de servercache (SNAPSHOT_TTL_MS) laten verlopen.
   */
  async function tijdreis(minuten, id = doelId) {
    const toen = Date.now() - minuten * 60_000;
    await redisCmd(['hset', `req:${id}`, 'createdAt', String(toen), 'lastConfirmedAt', String(toen)]);
    await wacht(3200);
  }

  await tijdreis(16);
  const metPrompt = await api('/api/queue?deviceId=dev-2');
  check(
    'na 16 minuten verschijnt de check-in-vraag',
    metPrompt.data?.checkin?.requestId === doelId,
    JSON.stringify(metPrompt.data?.checkin)
  );
  check('de vraag noemt de juiste positie', metPrompt.data?.checkin?.positie === 3);

  const anderDevice = await api('/api/queue?deviceId=dev-0');
  check('een ander device krijgt de vraag niet', anderDevice.data?.checkin === null);

  check(
    'bevestigen laat het nummer in de rij staan',
    (await api('/api/checkin', { method: 'POST', body: { requestId: doelId, deviceId: 'dev-2' } }))
      .status === 200 && (await api('/api/queue')).data?.wachtrij?.length === 3
  );

  await tijdreis(21);
  const gepauzeerd = await api('/api/queue?deviceId=dev-2');
  check('na 21 minuten zonder bevestiging wordt het nummer gepauzeerd', gepauzeerd.data?.wachtrij?.length === 2);
  check('het gepauzeerde nummer staat apart', gepauzeerd.data?.gepauzeerd?.[0]?.id === doelId);

  const hervat = await api('/api/checkin', {
    method: 'POST',
    body: { actie: 'hervat', requestId: doelId, deviceId: 'dev-2' },
  });
  check('"ik ben er weer" zet het nummer terug in de rij', hervat.status === 200);
  const naHervat = await api('/api/queue');
  check('de rij telt weer drie nummers', naHervat.data?.wachtrij?.length === 3);

  await tijdreis(21);
  const tweedeKeer = await api('/api/queue?deviceId=dev-2');
  check(
    'tweede gemiste check-in laat de aanvraag definitief vervallen',
    tweedeKeer.data?.wachtrij?.length === 2 && tweedeKeer.data?.gepauzeerd?.length === 0,
    JSON.stringify({
      rij: tweedeKeer.data?.wachtrij?.length,
      gepauzeerd: tweedeKeer.data?.gepauzeerd?.length,
    })
  );

  // --- Check-in: "nee, haal ons maar uit de lijst" -------------------------
  console.log('\nCheck-in: nee-knop');

  const neeSong = (await api('/api/songs?q=goodbye')).data.resultaten[0];
  const neeAanvraag = await api('/api/request', {
    method: 'POST',
    body: { songId: neeSong.id, zangerNaam: 'Weggaander', deviceId: 'dev-nee' },
  });
  check('extra aanvraag voor de nee-test lukt', neeAanvraag.status === 200);
  const neeId = neeAanvraag.data?.id;

  await tijdreis(16, neeId);
  const metVraag = await api('/api/queue?deviceId=dev-nee');
  check(
    'check-in-vraag staat open',
    metVraag.data?.checkin?.requestId === neeId,
    JSON.stringify(metVraag.data?.checkin)
  );

  const nee = await api('/api/request', {
    method: 'DELETE',
    body: { requestId: neeId, deviceId: 'dev-nee' },
  });
  check('"nee" haalt de aanvraag direct uit de lijst', nee.status === 200);

  const naNee = await api('/api/queue?deviceId=dev-nee');
  check('...het nummer staat niet meer in de rij', !naNee.data?.wachtrij?.some((e) => e.id === neeId));
  check('...en staat ook niet gepauzeerd', naNee.data?.gepauzeerd?.length === 0);
  check('...de check-in-vraag is weg', naNee.data?.checkin === null);

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

  // Een paar stemmen uitbrengen: de verrassingskeuze mag die niet aanraken.
  await api('/api/vote', { method: 'POST', body: { requestId: vol.data.wachtrij[8].id, deviceId: 'kiezer-v1' } });
  await api('/api/vote', { method: 'POST', body: { requestId: vol.data.wachtrij[8].id, deviceId: 'kiezer-v2' } });
  await api('/api/vote', { method: 'POST', body: { requestId: vol.data.wachtrij[2].id, deviceId: 'kiezer-v3' } });
  const metStemmen = await api('/api/queue');
  const stemmenVoor = Object.fromEntries(metStemmen.data.wachtrij.map((e) => [e.id, e.stemmen]));
  check(
    'er staan stemmen open voor de verrassingstest',
    Object.values(stemmenVoor).reduce((a, b) => a + b, 0) === 3
  );

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
    'de lopende ronde loopt gewoon door',
    naVerrassing.data.ronde === metStemmen.data.ronde,
    `ronde ${metStemmen.data.ronde} -> ${naVerrassing.data.ronde}`
  );
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
    'geen enkele stem is aangeraakt',
    naVerrassing.data.wachtrij.every((e) => stemmenVoor[e.id] === e.stemmen),
    JSON.stringify(
      naVerrassing.data.wachtrij
        .filter((e) => stemmenVoor[e.id] !== undefined && stemmenVoor[e.id] !== e.stemmen)
        .map((e) => `${e.id}: ${stemmenVoor[e.id]} -> ${e.stemmen}`)
    )
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
  let device = 0;
  let opDitDevice = 0;
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
    opDitDevice++;
    // Twee aanvragen per apparaat, dat is de limiet.
    if (opDitDevice >= 2) {
      device++;
      opDitDevice = 0;
    }
  }
}

try {
  await opzetten();
  await testen();
} catch (error) {
  gefaald++;
  console.error(`\n\x1b[31mAfgebroken:\x1b[0m ${error.message}`);
} finally {
  stopAlles();
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald === 0 ? 0 : 1);
