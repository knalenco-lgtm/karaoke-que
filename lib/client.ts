'use client';

const DEVICE_KEY = 'karaoke.deviceId';
const NAAM_KEY = 'karaoke.naam';
const PIN_KEY = 'karaoke.hostPin';
const SHOW_KEY = 'karaoke.show';

/**
 * De show-code van deze avond (fase 13): uit `?s=` in de link (de QR-code), anders de laatst
 * gebruikte. Elke API-aanroep krijgt hem mee.
 */
let huidigeShow = '';

export function getShow(): string {
  const uitLink = new URLSearchParams(window.location.search).get('s');
  if (uitLink) {
    const code = uitLink.toUpperCase().replace(/[\s-]/g, '');
    localStorage.setItem(SHOW_KEY, code);
    huidigeShow = code;
    return code;
  }
  huidigeShow = localStorage.getItem(SHOW_KEY) ?? '';
  return huidigeShow;
}

export function setShow(code: string): void {
  huidigeShow = code;
  if (code) localStorage.setItem(SHOW_KEY, code);
  else localStorage.removeItem(SHOW_KEY);
  // De link in de adresbalk meenemen, zodat herladen en delen dezelfde show houden.
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('s', code);
  else url.searchParams.delete('s');
  window.history.replaceState(null, '', url);
}

/** De link naar de gastenpagina van een show, voor de QR-code. */
export function gastenLink(code: string): string {
  return `${window.location.origin}/?s=${encodeURIComponent(code)}`;
}

/** Stabiele, anonieme identiteit per apparaat. Geen accounts, geen login. */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getNaam(): string {
  return localStorage.getItem(NAAM_KEY) ?? '';
}

export function setNaam(naam: string): void {
  localStorage.setItem(NAAM_KEY, naam);
}

export function getPin(): string {
  return localStorage.getItem(PIN_KEY) ?? '';
}

export function setPin(pin: string): void {
  localStorage.setItem(PIN_KEY, pin);
}

export function wisPin(): void {
  localStorage.removeItem(PIN_KEY);
}

export class ApiFout extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ApiFout';
  }
}

/** fetch met JSON-body en foutmeldingen die direct aan de gast getoond kunnen worden. */
export async function api<T = unknown>(
  url: string,
  opties: { method?: string; body?: unknown; pin?: string } = {}
): Promise<T> {
  let res: Response;
  if (huidigeShow && !/[?&]s=/.test(url) && url.startsWith('/api/') && !url.startsWith('/api/songs')) {
    url += (url.includes('?') ? '&' : '?') + 's=' + encodeURIComponent(huidigeShow);
  }
  try {
    res = await fetch(url, {
      method: opties.method ?? 'GET',
      headers: {
        ...(opties.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opties.pin ? { 'x-host-pin': opties.pin } : {}),
      },
      body: opties.body !== undefined ? JSON.stringify(opties.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiFout('Geen verbinding. Check je wifi of mobiele data.', 'NETWERK');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const fout = (data as { fout?: string; code?: string } | null) ?? null;
    throw new ApiFout(fout?.fout ?? 'Er ging iets mis.', fout?.code, res.status);
  }
  return data as T;
}
