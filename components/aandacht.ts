'use client';

import { useEffect, useRef } from 'react';

/** Vraagt toestemming voor browsermeldingen. Aanroepen bij de eerste aanvraag. */
export async function vraagNotificatiePermissie(): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  try {
    await Notification.requestPermission();
  } catch {
    // Sommige browsers blokkeren dit buiten een gebruikersgebaar; niet erg.
  }
}

function trilt(): void {
  navigator.vibrate?.([200, 100, 200, 100, 400]);
}

function meldt(titel: string, tekst: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    // `renotify` staat niet in de TS-typings maar zorgt op Android dat een
    // herhaalde melding met dezelfde tag opnieuw trilt.
    new Notification(titel, { body: tekst, tag: 'karaoke-checkin', renotify: true } as NotificationOptions);
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
    trilt();
    meldt(titel, tekst);

    const herhaal = setInterval(() => {
      trilt();
      if (document.visibilityState !== 'visible') meldt(titel, tekst);
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
