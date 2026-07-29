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
  const stemmenVoor = Object.fromEntries(vol.data.wachtrij.map((e) => [e.id, e.stemmen]));

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
  check('"nu aan de beurt" volgt de verrassing', naVerrassing.data?.nuAanDeBeurt?.id === gekozenId);

  check(
    'geen enkele stem is verplaatst',
    naVerrassing.data.wachtrij.every((e) => stemmenVoor[e.id] === undefined || stemmenVoor[e.id] === e.stemmen),
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
