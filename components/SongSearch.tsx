'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiFout } from '@/lib/client';
import type { CatalogSong } from '@/lib/types';

const DEBOUNCE_MS = 250;

interface Props {
  /** Verzendt de aanvraag; geeft een foutmelding terug of null bij succes. */
  onAanvragen: (song: CatalogSong) => Promise<void>;
  /** Uitgeschakeld als de gast al het maximum aantal nummers openstaan heeft. */
  geblokkeerdeReden: string | null;
}

export function SongSearch({ onAanvragen, geblokkeerdeReden }: Props) {
  const [query, setQuery] = useState('');
  /** Het laatst binnengekomen antwoord, mét de zoekterm waar het bij hoort. */
  const [antwoord, setAntwoord] = useState<{ term: string; songs: CatalogSong[] } | null>(null);
  const [gekozen, setGekozen] = useState<CatalogSong | null>(null);
  const [verzendt, setVerzendt] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  // Alleen het laatste antwoord telt: trage responses mogen nieuwere niet overschrijven.
  const zoekTeller = useRef(0);

  const term = query.trim();
  // Afgeleid uit de state, niet apart bijgehouden: zo kan het niet uit de pas lopen.
  const resultaten = antwoord?.term === term ? antwoord.songs : [];
  const zoekt = term.length >= 2 && antwoord?.term !== term;

  useEffect(() => {
    if (gekozen || term.length < 2) return;

    const nummer = ++zoekTeller.current;
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ resultaten: CatalogSong[] }>(
          `/api/songs?q=${encodeURIComponent(term)}`
        );
        if (nummer === zoekTeller.current) setAntwoord({ term, songs: res.resultaten });
      } catch (error) {
        if (nummer === zoekTeller.current) {
          setAntwoord({ term, songs: [] });
          setFout(error instanceof Error ? error.message : 'Zoeken mislukt.');
        }
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, gekozen]);

  async function bevestig() {
    if (!gekozen) return;
    setVerzendt(true);
    setFout(null);
    try {
      await onAanvragen(gekozen);
      setGekozen(null);
      setQuery('');
      setAntwoord(null);
    } catch (error) {
      setFout(error instanceof ApiFout ? error.message : 'Aanvragen mislukt.');
    } finally {
      setVerzendt(false);
    }
  }

  if (geblokkeerdeReden) {
    return (
      <div className="kaart px-4 py-5 text-center text-sm text-fuchsia-200/80">
        {geblokkeerdeReden}
      </div>
    );
  }

  if (gekozen) {
    return (
      <div className="kaart gloed p-4">
        <p className="text-xs uppercase tracking-widest text-fuchsia-300/70">Aanvragen?</p>
        <p className="mt-2 text-xl leading-tight font-semibold">{gekozen.titel}</p>
        <p className="text-fuchsia-200/70">{gekozen.artiest}</p>

        {fout && <p className="mt-3 text-sm text-rose-300">{fout}</p>}

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={bevestig}
            disabled={verzendt}
            className="min-h-14 flex-1 rounded-xl bg-fuchsia-500 text-lg font-bold text-white
                       active:bg-fuchsia-600 disabled:opacity-50"
          >
            {verzendt ? 'Bezig…' : 'Ja, zet in de rij'}
          </button>
          <button
            type="button"
            onClick={() => {
              setGekozen(null);
              setFout(null);
            }}
            disabled={verzendt}
            className="min-h-14 rounded-xl border border-white/15 px-5 font-medium
                       text-fuchsia-100/80 active:bg-white/10 disabled:opacity-50"
          >
            Terug
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek een nummer of artiest…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="kaart min-h-14 w-full px-4 text-base placeholder:text-fuchsia-200/40
                     focus:outline-none focus:ring-2 focus:ring-fuchsia-400/60"
        />
        {zoekt && (
          <span className="puls absolute top-1/2 right-4 -translate-y-1/2 text-xs text-fuchsia-300/70">
            zoeken…
          </span>
        )}
      </div>

      {fout && <p className="mt-2 text-sm text-rose-300">{fout}</p>}

      {term.length >= 2 && !zoekt && resultaten.length === 0 && (
        <p className="mt-3 px-1 text-sm text-fuchsia-200/60">
          Niks gevonden in de KaraFun-catalogus. Probeer een andere spelling.
        </p>
      )}

      {resultaten.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {resultaten.map((song) => (
            <li key={song.id}>
              <button
                type="button"
                onClick={() => {
                  setGekozen(song);
                  setFout(null);
                }}
                className="kaart flex min-h-14 w-full items-center px-4 py-3 text-left
                           active:bg-fuchsia-500/20"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{song.titel}</span>
                  <span className="block truncate text-sm text-fuchsia-200/60">{song.artiest}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
