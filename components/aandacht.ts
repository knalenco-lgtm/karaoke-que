'use client';

import { useEffect, useRef, useState } from 'react';
import type { QueueEntry } from '@/lib/types';

/**
 * 'onbeschikbaar' = browser kent de Notification API niet (o.a. iOS Safari
 * buiten een geïnstalleerde webapp). Voor de gebruiker is dat hetzelfde als uit.
 */
export type MeldingStatus = 'granted' | 'denied' | 'default' | 'onbeschikbaar';

function huidigeStatus(): MeldingStatus {
  if (typeof Notification === 'undefined') return 'onbeschikbaar';
  return Notification.permission;
}

/**
 * Houdt de permissiestatus bij en biedt een functie om hem aan te vragen.
 * Moet vanuit een klik aangeroepen worden: browsers weigeren de prompt anders.
 */
export function useMeldingen() {
  const [status, setStatus] = useState<MeldingStatus>('onbeschikbaar');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(huidigeStatus());
  }, []);

  async function vraagPermissie(): Promise<MeldingStatus> {
    if (typeof Notification === 'undefined') return 'onbeschikbaar';
    try {
      const antwoord = await Notification.requestPermission();
      setStatus(antwoord);
      return antwoord;
    } catch {
      // Sommige browsers weigeren de prompt buiten een gebruikersgebaar.
      const nu = huidigeStatus();
      setStatus(nu);
      return nu;
    }
  }

  return { status, vraagPermissie };
}

function trilt(patroon: number[]): void {
  navigator.vibrate?.(patroon);
}

function meldt(titel: string, tekst: string, tag: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    // `renotify` staat niet in de TS-typings maar zorgt op Android dat een
    // herhaalde melding met dezelfde tag opnieuw trilt.
    new Notification(titel, { body: tekst, tag, renotify: true } as NotificationOptions);
  } catch {
    // Op Android vereist de Notification-constructor soms een service worker.
  }
}

/**
 * Trekt de aandacht zolang `actief` waar is: trilsignaal + browsermelding bij
 * het verschijnen, en een knipperende tab-titel zolang de tab op de achtergrond
 * staat. Herhaalt het trilsignaal elke 30 seconden.
 */
export function useAandacht(actief: boolean, titel: string, tekst: string): void {
  const origineleTitel = useRef<string>('');

  useEffect(() => {
    if (!actief) return;

    origineleTitel.current = document.title;
    trilt([200, 100, 200, 100, 400]);
    meldt(titel, tekst, 'karaoke-checkin');

    const herhaal = setInterval(() => {
      trilt([200, 100, 200, 100, 400]);
      if (document.visibilityState !== 'visible') meldt(titel, tekst, 'karaoke-checkin');
    }, 30_000);

    let aan = false;
    const knipper = setInterval(() => {
      aan = !aan;
      document.title = aan ? `🎤 ${titel}` : origineleTitel.current;
    }, 900);

    return () => {
      clearInterval(herhaal);
      clearInterval(knipper);
      document.title = origineleTitel.current;
    };
    // `titel`/`tekst` bewust buiten de deps: die veranderen bij elke poll mee
    // (positie schuift op) en zouden het trilsignaal steeds opnieuw starten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actief]);
}

/**
 * Waarschuwt zodra een eigen nummer bijna aan de beurt is: één melding bij #2
 * en één bij #1, per aanvraag. Draait bij elke poll mee, maar de set met al
 * gemelde combinaties zorgt dat er niets dubbel afgaat.
 */
export function useBijnaAanDeBeurt(wachtrij: QueueEntry[]): void {
  const gemeld = useRef(new Set<string>());

  useEffect(() => {
    wachtrij.slice(0, 2).forEach((entry, index) => {
      if (!entry.isMijn) return;

      const positie = index + 1;
      const sleutel = `${entry.id}:${positie}`;
      if (gemeld.current.has(sleutel)) return;
      gemeld.current.add(sleutel);

      if (positie === 1) {
        trilt([300, 120, 300]);
        meldt('Jij bent aan de beurt! 🎤', `${entry.titel} — kom naar voren!`, `beurt-${entry.id}`);
      } else {
        trilt([200]);
        meldt(
          'Bijna jouw beurt 🎤',
          `Nog één nummer en dan is ${entry.titel} aan de beurt.`,
          `beurt-${entry.id}`
        );
      }
    });
  }, [wachtrij]);
}
