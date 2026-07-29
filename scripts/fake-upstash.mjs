#!/usr/bin/env node
/**
 * Minimale in-memory nabootsing van de Upstash Redis REST API.
 *
 * Puur bedoeld om lokaal te kunnen draaien en testen zonder Upstash-account.
 * Ondersteunt alleen de commando's die deze app gebruikt. NIET voor productie:
 * alles staat in het geheugen en is weg zodra het proces stopt.
 *
 * Gebruik:
 *   node scripts/fake-upstash.mjs 39117
 *   UPSTASH_REDIS_REST_URL=http://127.0.0.1:39117 UPSTASH_REDIS_REST_TOKEN=test npm run dev
 */

import { createServer } from 'node:http';

const poort = Number(process.argv[2] ?? 39117);

/** @type {Map<string, string|Map<string,string>|Set<string>>} */
const store = new Map();

function alsSet(key) {
  let value = store.get(key);
  if (!(value instanceof Set)) {
    value = new Set();
    store.set(key, value);
  }
  return value;
}

function alsHash(key) {
  let value = store.get(key);
  if (!(value instanceof Map)) {
    value = new Map();
    store.set(key, value);
  }
  return value;
}

function voerUit(commando) {
  const [naamRuw, ...args] = commando.map((c) => (typeof c === 'string' ? c : String(c)));
  const naam = naamRuw.toLowerCase();

  switch (naam) {
    case 'sadd': {
      const set = alsSet(args[0]);
      let toegevoegd = 0;
      for (const lid of args.slice(1)) {
        if (!set.has(lid)) {
          set.add(lid);
          toegevoegd++;
        }
      }
      return toegevoegd;
    }
    case 'srem': {
      const value = store.get(args[0]);
      if (!(value instanceof Set)) return 0;
      let verwijderd = 0;
      for (const lid of args.slice(1)) if (value.delete(lid)) verwijderd++;
      return verwijderd;
    }
    case 'smembers': {
      const value = store.get(args[0]);
      return value instanceof Set ? [...value] : [];
    }
    case 'scard': {
      const value = store.get(args[0]);
      return value instanceof Set ? value.size : 0;
    }
    case 'hset': {
      const hash = alsHash(args[0]);
      let nieuw = 0;
      for (let i = 1; i < args.length; i += 2) {
        if (!hash.has(args[i])) nieuw++;
        hash.set(args[i], args[i + 1]);
      }
      return nieuw;
    }
    case 'hgetall': {
      const value = store.get(args[0]);
      if (!(value instanceof Map)) return null;
      return [...value.entries()].flat();
    }
    case 'del': {
      let verwijderd = 0;
      for (const key of args) if (store.delete(key)) verwijderd++;
      return verwijderd;
    }
    case 'expire':
      // TTL heeft geen betekenis in een testproces dat toch zo weer stopt.
      return store.has(args[0]) ? 1 : 0;
    case 'incr': {
      const huidig = Number(store.get(args[0]) ?? 0) + 1;
      store.set(args[0], String(huidig));
      return huidig;
    }
    case 'flushdb':
      store.clear();
      return 'OK';
    default:
      throw new Error(`fake-upstash: commando "${naam}" is niet geïmplementeerd`);
  }
}

/**
 * De SDK stuurt `Upstash-Encoding: base64` mee en decodeert dan elke string in
 * het antwoord. Zonder dit komt alles als onleesbare bytes terug.
 */
function encodeer(waarde) {
  if (typeof waarde === 'string') return Buffer.from(waarde, 'utf8').toString('base64');
  if (Array.isArray(waarde)) return waarde.map(encodeer);
  return waarde;
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const base64 = req.headers['upstash-encoding'] === 'base64';
    const verpak = (waarde) => (base64 ? encodeer(waarde) : waarde);

    try {
      const payload = body ? JSON.parse(body) : [];
      const isPipeline = req.url?.includes('pipeline') || req.url?.includes('multi-exec');

      const resultaat = isPipeline
        ? payload.map((c) => {
            try {
              return { result: verpak(voerUit(c)) };
            } catch (error) {
              return { error: String(error.message) };
            }
          })
        : { result: verpak(voerUit(payload)) };

      res.end(JSON.stringify(resultaat));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: String(error.message) }));
    }
  });
});

server.listen(poort, '127.0.0.1', () => {
  console.log(`fake-upstash luistert op http://127.0.0.1:${poort}`);
});
