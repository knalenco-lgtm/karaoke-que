'use client';

import { useEffect, useState } from 'react';
import { api, ApiFout } from '@/lib/client';
import { Merk } from './Merk';

/**
 * Zonder show-code (de link zonder `?s=`, of een code die verlopen is): de code van de avond
 * invoeren. Staat op de QR-poster en op het wachtscherm.
 */
export function CodeScherm({ onCode, melding, viaGo = false }: { onCode: (code: string) => void; melding?: string | null; viaGo?: boolean }) {
  const [waarde, setWaarde] = useState('');
  // Via /go (meerdere of geen actieve shows): de actieve shows als knoppen, of "geen karaoke actief".
  const [actief, setActief] = useState<{ code: string; naam: string; aangemaakt: number }[] | null>(null);
  useEffect(() => {
    if (!viaGo) return;
    api<{ shows: { code: string; naam: string; aangemaakt: number }[] }>('/api/show/actief')
      .then((r) => setActief(r.shows))
      .catch(() => setActief([]));
  }, [viaGo]);
  const [fout, setFout] = useState<string | null>(melding ?? null);
  const [bezig, setBezig] = useState(false);
  const code = waarde.toUpperCase().replace(/[\s-]/g, '');

  async function controleer(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);
    try {
      await api(`/api/show?s=${encodeURIComponent(code)}`);
      onCode(code);
    } catch (error) {
      setFout(error instanceof ApiFout ? error.message : 'Er ging iets mis.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-10">
      <Merk groot />
      {viaGo && actief !== null && actief.length === 0 && (
        <p className="kaart mt-5 px-4 py-3 text-center text-lg font-semibold">Er is nu geen karaoke actief</p>
      )}
      {viaGo && actief !== null && actief.length > 0 && (
        <div className="mt-5 flex flex-col gap-3">
          <p className="text-center text-tekst/70">Kies jouw karaoke:</p>
          {actief.map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => onCode(s.code)}
              className="knop-verloop flex min-h-16 w-full flex-col items-center justify-center rounded-xl px-4 py-2 active:brightness-90"
            >
              <span className="text-lg font-bold">{s.naam}</span>
              <span className="text-sm opacity-80">
                gestart {new Date(s.aangemaakt).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-tekst/70">Scan de QR-code van de avond, of vul de code in die op het scherm staat.</p>
      <form className="mt-7" onSubmit={controleer}>
        <input
          type="text"
          value={waarde}
          onChange={(e) => setWaarde(e.target.value)}
          placeholder="CODE"
          maxLength={14}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          className="kaart kop min-h-16 w-full px-4 text-center text-4xl tracking-[0.3em] placeholder:tracking-[0.2em] placeholder:text-tekst/30 focus:ring-2 focus:ring-roze/60 focus:outline-none"
        />
        {fout && <p className="mt-3 text-center text-sm text-rose-300">{fout}</p>}
        <button
          type="submit"
          disabled={bezig || code.length < 3}
          className="knop-verloop mt-4 min-h-14 w-full rounded-xl text-lg font-bold active:brightness-90 disabled:opacity-40"
        >
          {bezig ? 'Bezig…' : 'Naar de avond'}
        </button>
      </form>
    </main>
  );
}
