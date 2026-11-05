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
            eerstvolgende ? 'text-roze' : 'text-tekst/50'
          }`}
          aria-label={`Positie ${positie}`}
        >
          {positie}
        </span>

        <div className="min-w-0 flex-1">
          <Badges entry={entry} positie={positie} />
          <p className="truncate leading-tight font-semibold">{entry.titel}</p>
          <p className="truncate text-sm text-tekst/60">{entry.artiest}</p>
          <p className="mt-0.5 truncate text-sm">
            <span className="text-tekst/50">door </span>
            <span className={entry.isMijn ? 'font-semibold text-roze' : 'text-tekst/90'}>
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
    entry.isMijn ? 'border-roze/50' : ''
  }`;

  if (!onKlik) return <li className={opmaak}>{inhoud}</li>;

  return (
    <li className={`${opmaak} cursor-pointer active:bg-roze/15`} onClick={onKlik}>
      {inhoud}
    </li>
  );
}

function Badges({ entry, positie }: { entry: QueueEntry; positie: number }) {
  const labels: string[] = [];
  if (positie === 1 && entry.verrassingOp > 0) labels.push('🎲 verrassingskeuze');
  if (entry.viaHost) labels.push('🎤 via host');

  if (labels.length === 0) return null;

  return (
    <p className="mb-0.5 flex flex-wrap gap-x-3 text-xs font-bold tracking-wide text-oranje-licht">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </p>
  );
}
