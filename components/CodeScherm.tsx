'use client';

import { useState } from 'react';
import { api, ApiFout } from '@/lib/client';
import { Merk } from './Merk';

/**
 * Zonder show-code (de link zonder `?s=`, of een code die verlopen is): de code van de avond
 * invoeren. Staat op de QR-poster en op het wachtscherm.
 */
export function CodeScherm({ onCode, melding }: { onCode: (code: string) => void; melding?: string | null }) {
  const [waarde, setWaarde] = useState('');
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
