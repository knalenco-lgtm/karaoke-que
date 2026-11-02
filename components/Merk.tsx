'use client';

/* eslint-disable @next/next/no-img-element -- een klein vast knipsel; next/image voegt hier niets toe. */

/**
 * Kop van elke pagina in de Knal-huisstijl: "Karaoke" in Bebas Neue in het merkverloop, de naam
 * van de show eronder, en het enige collage-accent van de app: de gouden microfoon.
 */
export function Merk({ titel = 'Karaoke', show, groot, rechts }: { titel?: string; show?: string; groot?: boolean; rechts?: React.ReactNode }) {
  return (
    <header className={`relative flex items-end gap-3 ${groot ? 'mb-2 justify-center text-center' : 'mb-5 justify-between'}`}>
      <div className={groot ? 'flex flex-col items-center gap-2' : 'flex items-end gap-3'}>
        <img
          src="/microfoon.webp"
          alt=""
          aria-hidden="true"
          className={`microfoon shrink-0 ${groot ? 'h-28 w-auto' : 'h-14 w-auto'}`}
        />
        <div className="min-w-0">
          <h1 className={`kop verlooptekst leading-none ${groot ? 'text-6xl' : 'text-4xl'}`}>{titel}</h1>
          {show && <p className="mt-1 truncate text-sm font-semibold text-tekst/70">{show}</p>}
        </div>
      </div>
      {rechts}
    </header>
  );
}
