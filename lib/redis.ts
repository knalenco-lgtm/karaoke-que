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

export const KEYS = {
  /** Hash met de velden van één aanvraag. */
  request: (id: string) => `req:${id}`,
  /** Set met alle aanvraag-ids die nog leven (queued of paused). */
  live: 'live',
  /** Set met deviceIds die op deze aanvraag gestemd hebben. */
  votes: (requestId: string) => `votes:${requestId}`,
  /** Set met openstaande aanvraag-ids van dit device. */
  deviceRequests: (deviceId: string) => `device:${deviceId}:requests`,
  /** Teller voor oplopende aanvraag-ids. */
  counter: 'request:counter',
} as const;
