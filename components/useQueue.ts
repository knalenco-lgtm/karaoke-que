'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import type { QueueResponse } from '@/lib/types';
import { POLL_MS } from '@/lib/constants';

/**
 * Pollt /api/queue elke 4 seconden. Geen websockets: dat is op Vercel
 * onnodig gedoe voor een lijst die maar een paar keer per minuut verandert.
 */
export function useQueue(deviceId: string | null) {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  /** Verschil tussen server- en clientklok, zodat aftellingen kloppen. */
  const [klokverschil, setKlokverschil] = useState(0);
  /** Voorkomt dat trage pollverzoeken zich opstapelen. */
  const bezig = useRef(false);
  /** Alleen het antwoord op het nieuwste verzoek telt. */
  const teller = useRef(0);

  const ververs = useCallback(async () => {
    if (bezig.current) return;
    bezig.current = true;
    const nummer = ++teller.current;
    try {
      const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
      const res = await api<QueueResponse>(`/api/queue${query}`);
      if (nummer !== teller.current) return;
      setData(res);
      setKlokverschil(res.serverTijd - Date.now());
      setFout(null);
    } catch (error) {
      if (nummer === teller.current) {
        setFout(error instanceof Error ? error.message : 'Er ging iets mis.');
      }
    } finally {
      bezig.current = false;
    }
  }, [deviceId]);

  useEffect(() => {
    // Bij een nieuw deviceId moet er meteen opnieuw opgehaald worden: een nog
    // lopend verzoek van het vorige id mag dat niet vier seconden tegenhouden.
    bezig.current = false;
    teller.current++;

    // Eerste ophaal bij het monteren; daarna neemt de interval het over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    ververs();
    const timer = setInterval(ververs, POLL_MS);

    // Meteen bijwerken als de gast terugkomt in de tab.
    const bijTerugkeer = () => {
      if (document.visibilityState === 'visible') ververs();
    };
    document.addEventListener('visibilitychange', bijTerugkeer);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', bijTerugkeer);
    };
  }, [ververs]);

  return { data, fout, klokverschil, ververs };
}
