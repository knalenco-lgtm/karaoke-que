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

const DEVICE_A = 'test-device-a';
const DEVICE_B = 'test-device-b';

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

  // --- Stemmen -------------------------------------------------------------
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
  check(
    'tweede keer stemmen wordt geweigerd',
    nogmaals.status === 409 && nogmaals.data?.code === 'AL_GESTEMD'
  );

  check(
    'stemmen op je eigen nummer wordt geweigerd',
    (await api('/api/vote', { method: 'POST', body: { requestId: idB, deviceId: DEVICE_A } }))
      .status === 403
  );

  // --- Wachtrij ------------------------------------------------------------
  console.log('\nWachtrij');
  const rij = await api(`/api/queue?deviceId=${DEVICE_A}`);
  check('wachtrij bevat beide aanvragen', rij.data?.wachtrij?.length === 2);
  check(
    'meeste stemmen staat bovenaan',
    rij.data?.wachtrij?.[0]?.id === idB,
    `bovenaan: ${rij.data?.wachtrij?.[0]?.id}, verwacht ${idB}`
  );
  check('"nu aan de beurt" is de bovenste', rij.data?.nuAanDeBeurt?.id === idB);
  check('eigen aanvragen zijn gemarkeerd', rij.data?.wachtrij?.every((e) => e.isMijn === true));
  check('eigen aanvragen worden geteld', rij.data?.eigenAanvragen === 2);

  const rijB = await api(`/api/queue?deviceId=${DEVICE_B}`);
  const entryB = rijB.data?.wachtrij?.find((e) => e.id === idB);
  check('device B ziet zijn eigen stem terug', entryB?.heeftGestemd === true);
  check('device B mag niet nog eens stemmen', entryB?.magStemmen === false);

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
    body: { actie: 'skip', requestId: idB },
    pin: PIN,
  });
  check('skip lukt', skip.status === 200);
  const naSkip = await api('/api/queue');
  check(
    'geskipt nummer zakt naar onderen ondanks meer stemmen',
    naSkip.data?.wachtrij?.[0]?.id === idA,
    `bovenaan: ${naSkip.data?.wachtrij?.[0]?.id}, verwacht ${idA}`
  );

  const verkeerdeVolgende = await api('/api/host', {
    method: 'POST',
    body: { actie: 'volgende', requestId: idB },
    pin: PIN,
  });
  check('"volgende" mag alleen op #1', verkeerdeVolgende.status === 409);

  check(
    '"volgende" op #1 lukt',
    (await api('/api/host', { method: 'POST', body: { actie: 'volgende', requestId: idA }, pin: PIN }))
      .status === 200
  );

  const naVolgende = await api('/api/queue');
  check('lijst schuift op', naVolgende.data?.wachtrij?.length === 1);
  check('nu is het volgende nummer aan de beurt', naVolgende.data?.nuAanDeBeurt?.id === idB);

  // --- Intrekken & opruimen ------------------------------------------------
  console.log('\nIntrekken');
  check(
    'intrekken van andermans aanvraag wordt geweigerd',
    (await api('/api/request', { method: 'DELETE', body: { requestId: idB, deviceId: DEVICE_B } }))
      .status === 403
  );
  check(
    'eigen aanvraag intrekken lukt',
    (await api('/api/request', { method: 'DELETE', body: { requestId: idB, deviceId: DEVICE_A } }))
      .status === 200
  );

  const leeg = await api('/api/queue');
  check('wachtrij is weer leeg', leeg.data?.wachtrij?.length === 0);
  check('er is niemand aan de beurt', leeg.data?.nuAanDeBeurt === null);

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

  // De eerste twee stemmen omhoog, zodat de derde gegarandeerd op #3 staat
  // en dus niet vrijgesteld is van de check-in.
  await api('/api/vote', { method: 'POST', body: { requestId: ids[0], deviceId: 'dev-stem' } });
  await api('/api/vote', { method: 'POST', body: { requestId: ids[1], deviceId: 'dev-stem' } });

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
  async function tijdreis(minuten) {
    const toen = Date.now() - minuten * 60_000;
    await redisCmd(['hset', `req:${doelId}`, 'createdAt', String(toen), 'lastConfirmedAt', String(toen)]);
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
