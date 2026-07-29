'use client';

import type { ReactNode } from 'react';
import type { QueueEntry } from '@/lib/types';
import { zangersTekst } from '@/lib/zangers';

interface Props {
  entry: QueueEntry;
  positie: number;
  /** Extra markering voor het nummer dat aan de beurt is. */
  aanDeBeurt?: boolean;
  /** Knoppen rechts in de rij. */
  acties?: ReactNode;
  /** Knoppen op een tweede regel (host). */
  onderActies?: ReactNode;
}

export function QueueRow({ entry, positie, aanDeBeurt, acties, onderActies }: Props) {
  return (
    <li
      className={`kaart px-3 py-3 ${aanDeBeurt ? 'gloed' : ''} ${
        entry.isMijn ? 'border-fuchsia-400/50' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`w-9 shrink-0 text-center text-lg font-black tabular-nums ${
            aanDeBeurt ? 'text-neon' : 'text-fuchsia-300/50'
          }`}
          aria-label={`Positie ${positie}`}
        >
          {positie}
        </span>

        <div className="min-w-0 flex-1">
          {aanDeBeurt && entry.verrassingOp > 0 && (
            <p className="mb-0.5 text-xs font-bold tracking-wide text-limoen">
              🎲 verrassingskeuze
            </p>
          )}
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
    </li>
  );
}

/** Stemknop met het aantal stemmen eronder. */
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
    : entry.heeftGestemd
      ? 'Je hebt al gestemd'
      : `Stem op ${entry.titel}`;

  return (
    <button
      type="button"
      onClick={onStem}
      disabled={uit}
      aria-label={label}
      title={label}
      className={`flex min-h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border
                  transition-colors ${
                    entry.heeftGestemd
                      ? 'border-lime-400/60 bg-lime-400/15 text-lime-300'
                      : uit
                        ? 'border-white/10 text-fuchsia-200/40'
                        : 'border-fuchsia-400/50 bg-fuchsia-500/15 text-neon active:bg-fuchsia-500/35'
                  }`}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        ▲
      </span>
      <span className="text-sm leading-tight font-bold tabular-nums">{entry.stemmen}</span>
    </button>
  );
}
