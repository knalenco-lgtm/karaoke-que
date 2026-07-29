'use client';

import { useEffect, useState } from 'react';
import { QueueRow } from '@/components/QueueRow';
import { useQueue } from '@/components/useQueue';
import { api, ApiFout, getPin, setPin, wisPin } from '@/lib/client';
import { VERRASSING_BESCHERMDE_TOP, VERRASSING_MIN_RIJ } from '@/lib/constants';
import { zangersTekst } from '@/lib/zangers';

export default function HostPagina() {
  const [pin, setPinState] = useState<string | null>(null);

  // Zie de gastenpagina: localStorage pas na hydratie lezen.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPinState(getPin()), []);

  if (pin === null) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="puls text-fuchsia-200/60">Laden…</p>
      </main>
    );
  }
  if (pin === '') return <PinScherm onOk={setPinState} />;

  return <HostPaneel pin={pin} onUitloggen={() => setPinState('')} />;
}

function HostPaneel({ pin, onUitloggen }: { pin: string; onUitloggen: () => void }) {
  const { data, fout, ververs } = useQueue(null);
  const [bezigId, setBezigId] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ tekst: string; fout: boolean } | null>(null);

  async function hostActie(actie: string, requestId?: string) {
    setBezigId((requestId ?? '') + actie);
    setMelding(null);
    try {
      const res = await api<{ verrassing?: { titel: string; positie: number } }>('/api/host', {
        method: 'POST',
        body: { actie, requestId },
        pin,
      });
      if (res.verrassing) {
        setMelding({
          tekst: `🎲 "${res.verrassing.titel}" stond op #${res.verrassing.positie} en is nu aan de beurt.`,
          fout: false,
        });
      }
      await ververs();
    } catch (error) {
      if (error instanceof ApiFout && error.code === 'PIN') {
        wisPin();
        onUitloggen();
        return;
      }
      setMelding({
        tekst: error instanceof ApiFout ? error.message : 'Actie mislukt.',
        fout: true,
      });
    } finally {
      setBezigId(null);
    }
  }

  const rijLengte = data?.wachtrij.length ?? 0;
  const magVerrassen = rijLengte >= VERRASSING_MIN_RIJ;

  const knop =
    'min-h-11 flex-1 rounded-lg border text-sm font-semibold disabled:opacity-40 px-2';

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-5 pb-16">
      <header className="mb-5 flex items-baseline justify-between">
        <h1 className="text-2xl font-black tracking-tight">
          Host<span className="text-neon">.</span>
        </h1>
        <button
          type="button"
          onClick={() => {
            wisPin();
            onUitloggen();
          }}
          className="text-sm text-fuchsia-200/60 underline-offset-4 hover:underline"
        >
          Vergrendelen
        </button>
      </header>

      {melding && (
        <p
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            melding.fout
              ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
              : 'border-lime-400/30 bg-lime-400/10 text-lime-100'
          }`}
        >
          {melding.tekst}
        </p>
      )}
      {fout && (
        <p className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {fout}
        </p>
      )}

      <button
        type="button"
        onClick={() => hostActie('verrassing')}
        disabled={!magVerrassen || bezigId === 'verrassing'}
        title={
          magVerrassen
            ? `Trekt willekeurig een nummer van buiten de top ${VERRASSING_BESCHERMDE_TOP} naar voren`
            : `vanaf ${VERRASSING_MIN_RIJ} nummers`
        }
        className="mb-4 min-h-14 w-full rounded-xl border border-limoen/50 bg-limoen/10 text-base
                   font-bold text-limoen active:bg-limoen/25 disabled:border-white/10
                   disabled:bg-transparent disabled:text-fuchsia-200/40"
      >
        {bezigId === 'verrassing' ? 'Bezig…' : '🎲 Verrassing'}
        {!magVerrassen && (
          <span className="ml-2 text-xs font-normal">(vanaf {VERRASSING_MIN_RIJ} nummers)</span>
        )}
      </button>

      {data && data.wachtrij.length === 0 && (
        <p className="kaart px-4 py-6 text-center text-sm text-fuchsia-200/60">
          De wachtrij is leeg.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {data?.wachtrij.map((entry, i) => (
          <QueueRow
            key={entry.id}
            entry={entry}
            positie={i + 1}
            aanDeBeurt={i === 0}
            acties={
              <span className="flex w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-white/10 py-1 text-fuchsia-200/70">
                <span aria-hidden="true" className="text-sm leading-none">
                  ▲
                </span>
                <span className="text-sm leading-tight font-bold tabular-nums">{entry.stemmen}</span>
              </span>
            }
            onderActies={
              <>
                {i === 0 && (
                  <button
                    type="button"
                    onClick={() => hostActie('volgende', entry.id)}
                    disabled={bezigId === entry.id + 'volgende'}
                    className={`${knop} border-lime-400/50 bg-lime-400/15 text-lime-200 active:bg-lime-400/30`}
                  >
                    Gezongen ▶
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => hostActie('skip', entry.id)}
                  disabled={bezigId === entry.id + 'skip'}
                  className={`${knop} border-white/15 text-fuchsia-100/80 active:bg-white/10`}
                >
                  Skip ↓
                </button>
                <button
                  type="button"
                  onClick={() => hostActie('verwijder', entry.id)}
                  disabled={bezigId === entry.id + 'verwijder'}
                  className={`${knop} border-rose-400/40 text-rose-200 active:bg-rose-500/20`}
                >
                  Verwijder
                </button>
              </>
            }
          />
        ))}
      </ul>

      {data && data.gepauzeerd.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 px-1 text-xs font-semibold tracking-widest text-fuchsia-300/70 uppercase">
            Gepauzeerd (check-in gemist)
          </h2>
          <ul className="flex flex-col gap-2">
            {data.gepauzeerd.map((entry) => (
              <li key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="truncate font-semibold text-fuchsia-100/70">{entry.titel}</p>
                <p className="truncate text-sm text-fuchsia-200/40">
                  {entry.artiest} · door {zangersTekst(entry.zangerNaam, entry.extraSingers)} ·{' '}
                  {entry.stemmen} stemmen
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => hostActie('herstel', entry.id)}
                    disabled={bezigId === entry.id + 'herstel'}
                    className={`${knop} border-lime-400/50 bg-lime-400/15 text-lime-200 active:bg-lime-400/30`}
                  >
                    Terug in de rij
                  </button>
                  <button
                    type="button"
                    onClick={() => hostActie('verwijder', entry.id)}
                    disabled={bezigId === entry.id + 'verwijder'}
                    className={`${knop} border-rose-400/40 text-rose-200 active:bg-rose-500/20`}
                  >
                    Verwijder
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-center text-xs text-fuchsia-200/40">
        Sortering: verrassingskeuze → minst geskipt → meeste stemmen → wie het eerst aanvroeg
      </p>
    </main>
  );
}

function PinScherm({ onOk }: { onOk: (pin: string) => void }) {
  const [waarde, setWaarde] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function verstuur(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);
    try {
      await api('/api/host', { method: 'POST', body: { actie: 'login' }, pin: waarde });
      setPin(waarde);
      onOk(waarde);
    } catch (error) {
      setFout(error instanceof ApiFout ? error.message : 'Inloggen mislukt.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-10">
      <h1 className="text-center text-3xl font-black tracking-tight">Hostpaneel</h1>
      <p className="mt-3 text-center text-fuchsia-100/70">Voer de pincode in.</p>

      <form className="mt-7" onSubmit={verstuur}>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={waarde}
          onChange={(e) => setWaarde(e.target.value)}
          placeholder="••••"
          autoFocus
          className="kaart min-h-14 w-full px-4 text-center text-2xl tracking-[0.5em]
                     placeholder:tracking-normal placeholder:text-fuchsia-200/40
                     focus:outline-none focus:ring-2 focus:ring-fuchsia-400/60"
        />
        {fout && <p className="mt-3 text-center text-sm text-rose-300">{fout}</p>}
        <button
          type="submit"
          disabled={bezig || waarde.length === 0}
          className="mt-4 min-h-14 w-full rounded-xl bg-fuchsia-500 text-lg font-bold text-white
                     active:bg-fuchsia-600 disabled:opacity-40"
        >
          {bezig ? 'Bezig…' : 'Ontgrendelen'}
        </button>
      </form>
    </main>
  );
}
