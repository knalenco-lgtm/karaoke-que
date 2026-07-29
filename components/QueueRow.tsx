'use client';

import type { ReactNode } from 'react';
import type { QueueEntry } from '@/lib/types';
import { zangersTekst } from '@/lib/zangers';

interface Props {
  entry: QueueEntry;
  positie: number;
  /** Extra markering voor het nummer dat als eerstvolgende in de rij staat. */
  eerstvolgende?: boolean;
  /** Knoppen rechts in de rij. */
  acties?: ReactNode;
  /** Knoppen op een tweede regel (host). */
  onderActies?: ReactNode;
  /** Maakt de hele rij aanklikbaar (hostpagina). */
  onKlik?: () => void;
}

export function QueueRow({ entry, positie, eerstvolgende, acties, onderActies, onKlik }: Props) {
  const inhoud = (
    <>
      <div className="flex items-center gap-3">
        <span
          className={`w-9 shrink-0 text-center text-lg font-black tabular-nums ${
            eerstvolgende ? 'text-neon' : 'text-fuchsia-300/50'
          }`}
          aria-label={`Positie ${positie}`}
        >
          {positie}
        </span>

        <div className="min-w-0 flex-1">
          <Badges entry={entry} positie={positie} />
          <p className="truncate leading-tight font-semibold">{entry.titel}</p>
          <p className="truncate text-sm text-fuchsia-200/60">{entry.artiest}</p>
          <p className="mt-0.5 truncate text-sm">
            <span className="text-fuchsia-200/50">door </span>
            <span className={entry.isMijn ? 'font-semibold text-neon' : 'text-fuchsia-100/90'}>
              {zangersTekst(entry.zangerNaam, entry.extraSingers)}
              {entry.isMijn && ' (jij)'}
            </span>
          </p>
        </div>

        {acties}
      </div>

      {onderActies && <div className="mt-3 flex gap-2">{onderActies}</div>}
    </>
  );

  const opmaak = `kaart px-3 py-3 ${eerstvolgende ? 'gloed' : ''} ${
    entry.isMijn ? 'border-fuchsia-400/50' : ''
  }`;

  if (!onKlik) return <li className={opmaak}>{inhoud}</li>;

  return (
    <li className={`${opmaak} cursor-pointer active:bg-fuchsia-500/15`} onClick={onKlik}>
      {inhoud}
    </li>
  );
}

function Badges({ entry, positie }: { entry: QueueEntry; positie: number }) {
  const labels: string[] = [];
  if (positie === 1 && entry.verrassingOp > 0) labels.push('🎲 verrassingskeuze');
  if (entry.isWinnaarVorigeRonde) labels.push('🏆 winnaar vorige ronde');
  if (entry.isBeschermd) labels.push('🛡️ kan niet meer ingehaald worden');

  if (labels.length === 0) return null;

  return (
    <p className="mb-0.5 flex flex-wrap gap-x-3 text-xs font-bold tracking-wide text-limoen">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </p>
  );
}

/** Stemknop met de stand van deze ronde. */
export function StemKnop({
  entry,
  onStem,
  bezig,
}: {
  entry: QueueEntry;
  onStem: () => void;
  bezig: boolean;
}) {
  const uit = !entry.magStemmen || bezig;
  const label = entry.isMijn
    ? 'Je eigen aanvraag'
    : entry.heeftMijnStem
      ? 'Hier gaat je stem deze ronde naartoe'
      : `Stem deze ronde op ${entry.titel}`;

  return (
    <button
      type="button"
      onClick={onStem}
      disabled={uit}
      aria-label={label}
      title={label}
      className={`flex min-h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border
                  transition-colors ${
                    entry.heeftMijnStem
                      ? 'border-lime-400/70 bg-lime-400/20 text-lime-300'
                      : uit
                        ? 'border-white/10 text-fuchsia-200/40'
                        : 'border-fuchsia-400/50 bg-fuchsia-500/15 text-neon active:bg-fuchsia-500/35'
                  }`}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        {entry.heeftMijnStem ? '★' : '▲'}
      </span>
      <span className="text-sm leading-tight font-bold tabular-nums">{entry.stemmen}</span>
    </button>
  );
}
