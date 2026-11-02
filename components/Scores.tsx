'use client';

import { useEffect, useRef } from 'react';
import type { Uitslag } from '@/lib/types';
import { zangersTekst } from '@/lib/zangers';

const getal = (n: number) => Math.round(n).toLocaleString('nl-NL');

/** Fase 13: de score van de Knal-meter voor je eigen optreden, met de labels. */
export function JouwScore({ uitslagen }: { uitslagen: Uitslag[] }) {
  if (uitslagen.length === 0) return null;
  const [laatste, ...eerder] = uitslagen;
  return (
    <section className="kaart gloed mt-6 px-5 py-5 text-center" aria-live="polite">
      <p className="kop text-base tracking-[0.18em] text-tekst/60">De Knal-meter zegt</p>
      <p className="kop verlooptekst mt-1 text-7xl leading-none tabular-nums">{getal(laatste.score)}</p>
      <p className="mt-2 text-sm text-tekst/70">
        {laatste.titel} · {laatste.artiest}
      </p>
      {laatste.labels.length > 0 && (
        <p className="mt-3 flex flex-wrap justify-center gap-2">
          {laatste.labels.map((l) => (
            <span key={l} className="knop-verloop kop rounded-full px-4 py-1 text-xl tracking-[0.08em]">
              {l}
            </span>
          ))}
        </p>
      )}
      {eerder.length > 0 && (
        <p className="mt-3 text-xs text-tekst/50">
          Eerder vanavond: {eerder.map((u) => `${u.titel} ${getal(u.score)}`).join(' · ')}
        </p>
      )}
    </section>
  );
}

/** Het leaderboard van de avond (top 10), in te klappen. */
export function Leaderboard({ lijst }: { lijst: Uitslag[] }) {
  if (lijst.length === 0) return null;
  return (
    <details className="kaart mt-6 px-4 py-3">
      <summary className="cursor-pointer list-none marker:hidden">
        <span className="kop text-base tracking-[0.16em] text-tekst/60">▸ Leaderboard van de avond</span>
      </summary>
      <ol className="mt-3 flex flex-col gap-1.5">
        {lijst.map((u, i) => (
          <li key={u.id} className={`flex items-baseline gap-3 ${u.isMijn ? 'text-roze' : ''}`}>
            <span className="kop verlooptekst w-6 shrink-0 text-xl">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm">
              <strong>{zangersTekst(u.zangerNaam, u.extraSingers)}</strong>
              <span className="text-tekst/50"> · {u.titel}</span>
            </span>
            <span className="kop text-xl tabular-nums">{getal(u.score)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Een melding (trillen en een browsermelding) zodra er een nieuwe score van jezelf binnenkomt. */
export function useScoreMelding(uitslagen: Uitslag[]): void {
  const bekend = useRef<Set<string> | null>(null);
  useEffect(() => {
    const sleutels = uitslagen.map((u) => `${u.id}:${u.score}`);
    if (bekend.current === null) {
      // Bij het openen van de pagina niets melden: dat waren oude scores.
      bekend.current = new Set(sleutels);
      return;
    }
    for (const u of uitslagen) {
      const k = `${u.id}:${u.score}`;
      if (bekend.current.has(k)) continue;
      bekend.current.add(k);
      navigator.vibrate?.([200, 80, 200]);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(`Je score: ${getal(u.score)}`, { body: [u.titel, ...u.labels].join(' · '), tag: `score-${u.id}` });
        } catch {
          // Op Android vereist de Notification-constructor soms een service worker.
        }
      }
    }
  }, [uitslagen]);
}
