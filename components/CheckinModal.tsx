'use client';

import { useEffect, useState } from 'react';
import { useAandacht } from './aandacht';
import type { CheckinPrompt } from '@/lib/types';

interface Props {
  checkin: CheckinPrompt;
  /** Verschil tussen serverklok en clientklok, in ms. */
  klokverschil: number;
  onBevestig: () => Promise<void>;
  /** Haalt de aanvraag meteen definitief uit de lijst. */
  onAfmelden: () => Promise<void>;
}

function resterend(ms: number): string {
  const totaal = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(totaal / 60)}:${String(totaal % 60).padStart(2, '0')}`;
}

export function CheckinModal({ checkin, klokverschil, onBevestig, onAfmelden }: Props) {
  const [bezig, setBezig] = useState<'ja' | 'nee' | null>(null);
  const [tijd, setTijd] = useState(() => checkin.vervaltOp - (Date.now() + klokverschil));

  useAandacht(
    true,
    'Ben je er nog?',
    `Je staat op #${checkin.positie} met ${checkin.titel}. Bevestig even!`
  );

  useEffect(() => {
    const timer = setInterval(
      () => setTijd(checkin.vervaltOp - (Date.now() + klokverschil)),
      1000
    );
    return () => clearInterval(timer);
  }, [checkin.vervaltOp, klokverschil]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkin-titel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="kaart gloed w-full max-w-sm p-6 text-center">
        <p className="text-5xl" aria-hidden="true">
          🎤
        </p>
        <h2 id="checkin-titel" className="mt-3 text-2xl font-bold">
          Ben je er nog?
        </h2>
        <p className="mt-2 text-fuchsia-100/80">
          Je staat op <strong className="text-neon">#{checkin.positie}</strong> met
          <br />
          <strong>{checkin.titel}</strong>
        </p>
        <p className="mt-3 text-sm text-fuchsia-200/60">
          Nog <span className="tabular-nums">{resterend(tijd)}</span> om te bevestigen, anders
          pauzeren we je nummer.
        </p>

        <button
          type="button"
          onClick={async () => {
            setBezig('ja');
            try {
              await onBevestig();
            } finally {
              setBezig(null);
            }
          }}
          disabled={bezig !== null}
          className="mt-6 min-h-16 w-full rounded-2xl bg-lime-400 text-xl font-black tracking-wide
                     text-black active:bg-lime-500 disabled:opacity-50"
        >
          {bezig === 'ja' ? 'Bezig…' : 'JA, IK BEN ER!'}
        </button>

        <button
          type="button"
          onClick={async () => {
            setBezig('nee');
            try {
              await onAfmelden();
            } finally {
              setBezig(null);
            }
          }}
          disabled={bezig !== null}
          className="mt-3 min-h-12 w-full rounded-xl border border-white/15 text-sm font-medium
                     text-fuchsia-100/70 active:bg-white/10 disabled:opacity-50"
        >
          {bezig === 'nee' ? 'Bezig…' : 'Nee, haal ons maar uit de lijst'}
        </button>
      </div>
    </div>
  );
}
