import { Redis } from '@upstash/redis';

/** Fout die de API-routes vertalen naar een nette 503 met uitleg. */
export class RedisNietGeconfigureerd extends Error {
  constructor() {
    super(
      'Redis is niet geconfigureerd. Zet UPSTASH_REDIS_REST_URL en UPSTASH_REDIS_REST_TOKEN ' +
        '(of KV_REST_API_URL en KV_REST_API_TOKEN) in .env.local (lokaal) of in de ' +
        'Vercel-projectinstellingen. Vergeet daarna niet opnieuw te deployen.'
    );
    this.name = 'RedisNietGeconfigureerd';
  }
}

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;

  // Vercel noemt de Upstash-variabelen afhankelijk van de integratie
  // UPSTASH_REDIS_REST_* of KV_REST_API_*. Beide worden geaccepteerd.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new RedisNietGeconfigureerd();

  client = new Redis({ url, token });
  return client;
}

/**
 * Sinds fase 13 van de Showcomposer heeft elke show een eigen code, zodat twee hosts op één
 * avond elk een eigen wachtrij hebben. Alle sleutels van een show staan onder `s:{code}:`.
 */
export const SHOW_KEYS = {
  /** Hash met de gegevens van een show: naam, aangemaakt, spelerToken. */
  show: (code: string) => `show:${code}`,
} as const;

export function keys(code: string) {
  const p = `s:${code}:`;
  return {
    /** Hash met de velden van één aanvraag. */
    request: (id: string) => `${p}req:${id}`,
    /** Set met alle aanvraag-ids die nog leven (queued of playing). */
    live: `${p}live`,
    /** Set met de aanvraag-ids die een score van de Knal-meter hebben (voor het leaderboard). */
    gescoord: `${p}gescoord`,
    /** Set met openstaande aanvraag-ids van dit device. */
    deviceRequests: (deviceId: string) => `${p}device:${deviceId}:requests`,
    /** Teller voor oplopende aanvraag-ids. */
    counter: `${p}request:counter`,
    /** Teller voor het volgnummer in de wachtrij (arrivalSeq). */
    seqCounter: `${p}seq:counter`,

    /**
     * De momentopname van de hele rij als één JSON-string: lezen kost dan één
     * commando in plaats van één per aanvraag. Elke wijziging gooit hem weg.
     */
    snapshot: `${p}snapshot`,

    /** Kortdurend slot zodat een host-klik nooit half uitgevoerd raakt. */
    slot: (naam: string) => `${p}slot:${naam}`,
  };
}

export type Keys = ReturnType<typeof keys>;
