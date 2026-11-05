'use client';

import { useEffect, useState } from 'react';
import { QueueRow } from '@/components/QueueRow';
import type { QueueEntry } from '@/lib/types';
import { useQueue } from '@/components/useQueue';
import { api, ApiFout, getPin, getShow, setPin, setShow, wisPin } from '@/lib/client';
import { Merk } from '@/components/Merk';
import { VERRASSING_BESCHERMDE_TOP, VERRASSING_MIN_RIJ } from '@/lib/constants';
import { zangersTekst } from '@/lib/zangers';

export default function HostPagina() {
  const [pin, setPinState] = useState<string | null>(null);
  const [show, setShowState] = useState<string | null>(null);

  // Zie de gastenpagina: localStorage pas na hydratie lezen.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPinState(getPin());
    setShowState(getShow());
  }, []);

  if (pin === null) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="puls text-tekst/60">Laden…</p>
      </main>
    );
  }
  if (pin === '') return <PinScherm onOk={setPinState} />;
  if (!show) {
    return (
      <ShowKiezen
        pin={pin}
        onShow={(code) => {
          setShow(code);
          setShowState(code);
        }}
      />
    );
  }

  return (
    <HostPaneel
      key={show}
      pin={pin}
      code={show}
      onAndereShow={() => {
        setShow('');
        setShowState('');
      }}
      onUitloggen={() => setPinState('')}
    />
  );
}

/**
 * Fase 13: na de pincode kiest de host de show van vanavond, of maakt hij een nieuwe. Elke show
 * heeft een eigen wachtrij en een eigen QR-code, zodat twee hosts op één avond elk een rij hebben.
 */
function ShowKiezen({ pin, onShow }: { pin: string; onShow: (code: string) => void }) {
  const [naam, setNaamState] = useState('');
  const [code, setCode] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function nieuw(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);
    try {
      const r = await api<{ code: string }>('/api/show', { method: 'POST', body: { naam }, pin });
      onShow(r.code);
    } catch (error) {
      setFout(error instanceof ApiFout ? error.message : 'Aanmaken mislukt.');
    } finally {
      setBezig(false);
    }
  }

  async function bestaand(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);
    const c = code.toUpperCase().replace(/[\s-]/g, '');
    try {
      await api('/api/host', { method: 'POST', body: { actie: 'login', show: c }, pin });
      onShow(c);
    } catch (error) {
      setFout(error instanceof ApiFout ? error.message : 'Deze show bestaat niet.');
    } finally {
      setBezig(false);
    }
  }

  const veld =
    'kaart min-h-14 w-full px-4 text-center text-lg placeholder:text-tekst/40 focus:ring-2 focus:ring-roze/60 focus:outline-none';
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-10">
      <Merk titel="Host" groot />
      {fout && <p className="mt-4 text-center text-sm text-rose-300">{fout}</p>}
      <form className="mt-6" onSubmit={nieuw}>
        <p className="kop mb-2 text-base tracking-[0.16em] text-tekst/60">Nieuwe show</p>
        <input className={veld} value={naam} onChange={(e) => setNaamState(e.target.value)} placeholder="Naam, bijvoorbeeld Kerstborrel Acme" maxLength={80} />
        <button type="submit" disabled={bezig} className="knop-verloop mt-3 min-h-14 w-full rounded-xl text-lg font-bold active:brightness-90 disabled:opacity-40">
          Show maken
        </button>
      </form>
      <form className="mt-8" onSubmit={bestaand}>
        <p className="kop mb-2 text-base tracking-[0.16em] text-tekst/60">Of verder met een show</p>
        <input
          className={`${veld} kop text-3xl tracking-[0.3em]`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="CODE"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={14}
        />
        <button
          type="submit"
          disabled={bezig || code.trim().length < 3}
          className="mt-3 min-h-12 w-full rounded-xl border border-white/15 text-sm font-semibold text-tekst/80 active:bg-white/10 disabled:opacity-40"
        >
          Openen
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-tekst/40">Een show blijft twee dagen bestaan. Stuurt de Showcomposer de karaoke, dan maakt die de show.</p>
    </main>
  );
}

function HostPaneel({ pin, code, onAndereShow, onUitloggen }: { pin: string; code: string; onAndereShow: () => void; onUitloggen: () => void }) {
  const { data, fout, foutCode, ververs } = useQueue(null);
  useEffect(() => {
    if (foutCode === 'SHOW' || foutCode === 'CODE') onAndereShow();
  }, [foutCode, onAndereShow]);
  const [bezigId, setBezigId] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ tekst: string; fout: boolean } | null>(null);
  /** Het nummer waarvoor om bevestiging gevraagd wordt, tegen misklikken. */
  const [teStarten, setTeStarten] = useState<QueueEntry | null>(null);
  // Is dit de show achter het vaste instapadres /go (de QR-code op het bord)?
  const [actief, setActief] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ actief?: boolean }>(`/api/show?s=${encodeURIComponent(code)}`)
      .then((r) => setActief(!!r.actief))
      .catch(() => setActief(null));
  }, [code]);
  async function zetActief(aan: boolean) {
    setActief(aan);
    try {
      await api('/api/show/actief', { method: 'POST', body: { show: code, actief: aan }, pin });
    } catch (error) {
      setActief(!aan);
      setMelding({ tekst: error instanceof ApiFout ? error.message : 'Actief zetten lukte niet.', fout: true });
    }
  }

  async function hostActie(actie: string, requestId?: string) {
    setBezigId((requestId ?? '') + actie);
    setMelding(null);
    try {
      const res = await api<{
        verrassing?: { titel: string; positie: number };
        start?: { gestart: { titel: string; zangerNaam: string } };
      }>('/api/host', { method: 'POST', body: { actie, requestId }, pin });

      if (res.verrassing) {
        setMelding({
          tekst: `🎲 "${res.verrassing.titel}" stond op #${res.verrassing.positie} en staat nu vooraan.`,
          fout: false,
        });
      }
      if (res.start) {
        setMelding({
          tekst: `▶ "${res.start.gestart.titel}", ${res.start.gestart.zangerNaam} is aan de beurt.`,
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

  async function start(entry: QueueEntry) {
    setTeStarten(null);
    await hostActie('start', entry.id);
  }

  const rijLengte = data?.wachtrij.length ?? 0;
  const magVerrassen = rijLengte >= VERRASSING_MIN_RIJ;

  const knop =
    'min-h-11 flex-1 rounded-lg border text-sm font-semibold disabled:opacity-40 px-2';

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-5 pb-16">
      <Merk
        titel="Host"
        show={data?.show.naam}
        rechts={
          <div className="flex flex-col items-end gap-1 pb-1 text-sm">
            <button
              type="button"
              onClick={() => {
                wisPin();
                onUitloggen();
              }}
              className="text-tekst/60 underline-offset-4 hover:underline"
            >
              Vergrendelen
            </button>
            <button type="button" onClick={onAndereShow} className="text-tekst/60 underline-offset-4 hover:underline">
              Andere show
            </button>
          </div>
        }
      />
      <div className="kaart mb-4 flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="kop text-base tracking-[0.16em] text-tekst/60">Show-code</p>
          <p className="kop verlooptekst text-4xl leading-none tracking-[0.2em]">{code}</p>
        </div>
        <a href={`/qr?s=${encodeURIComponent(code)}`} className="min-h-12 rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-tekst/80 active:bg-white/10">
          QR-code
        </a>
      </div>
      {actief !== null && (
        <label className="kaart mb-4 flex min-h-14 cursor-pointer items-center justify-between gap-3 px-4 py-3">
          <span>
            <span className="block font-semibold">Dit is de actieve show</span>
            <span className="block text-sm text-tekst/60">De vaste QR-code (/go) stuurt gasten naar de actieve show.</span>
          </span>
          <input type="checkbox" role="switch" checked={actief} onChange={(e) => zetActief(e.target.checked)} className="h-7 w-12 accent-[#F03786]" aria-label="Dit is de actieve show" />
        </label>
      )}

      {melding && (
        <p
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            melding.fout
              ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
              : 'border-oranje/30 bg-oranje/10 text-tekst'
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
        className="mb-4 min-h-14 w-full rounded-xl border border-oranje/50 bg-oranje/10 text-base
                   font-bold text-oranje-licht active:bg-oranje/25 disabled:border-white/10
                   disabled:bg-transparent disabled:text-tekst/40"
      >
        {bezigId === 'verrassing' ? 'Bezig…' : '🎲 Verrassing'}
        {!magVerrassen && (
          <span className="ml-2 text-xs font-normal">(vanaf {VERRASSING_MIN_RIJ} nummers)</span>
        )}
      </button>

      {data && data.wachtrij.length === 0 && (
        <p className="kaart px-4 py-6 text-center text-sm text-tekst/60">
          De wachtrij is leeg.
        </p>
      )}

      {data?.nuAanDeBeurt && (
        <div className="kaart gloed mb-4 px-4 py-3">
          <p className="kop text-base tracking-[0.16em] text-tekst/70 uppercase">
            Nu aan de beurt
          </p>
          <p className="mt-1 font-bold">{data.nuAanDeBeurt.titel}</p>
          <p className="text-sm text-tekst/60">
            {data.nuAanDeBeurt.artiest} · {zangersTekst(data.nuAanDeBeurt.zangerNaam, data.nuAanDeBeurt.extraSingers)}
          </p>
        </div>
      )}

      {rijLengte > 0 && (
        <p className="mb-2 px-1 text-xs text-tekst/50">
          Tik het nummer aan dat nu gaat zingen. Het vorige nummer is dan klaar.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {data?.wachtrij.map((entry, i) => (
          <QueueRow
            key={entry.id}
            entry={entry}
            positie={i + 1}
            eerstvolgende={i === 0}
            onKlik={() => setTeStarten(entry)}
            onderActies={
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    hostActie('skip', entry.id);
                  }}
                  disabled={bezigId === entry.id + 'skip'}
                  className={`${knop} border-white/15 text-tekst/80 active:bg-white/10`}
                >
                  Skip ↓
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    hostActie('verwijder', entry.id);
                  }}
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

      {teStarten && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="kaart gloed w-full max-w-sm p-6 text-center">
            <p className="kop text-base tracking-[0.16em] text-tekst/70 uppercase">
              Starten?
            </p>
            <p className="mt-2 text-xl leading-tight font-bold text-balance">{teStarten.titel}</p>
            <p className="mt-1 text-tekst/70">
              {zangersTekst(teStarten.zangerNaam, teStarten.extraSingers)}
            </p>
            <p className="mt-3 text-xs text-tekst/50">
              Het nummer dat nu speelt, is dan klaar.
            </p>

            <button
              type="button"
              onClick={() => start(teStarten)}
              disabled={bezigId === teStarten.id + 'start'}
              className="mt-5 min-h-14 w-full rounded-xl knop-verloop text-lg font-black text-white
                         active:brightness-90 disabled:opacity-50"
            >
              Ja, starten ▶
            </button>
            <button
              type="button"
              onClick={() => setTeStarten(null)}
              className="mt-3 min-h-12 w-full rounded-xl border border-white/15 text-sm
                         text-tekst/70 active:bg-white/10"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      <p className="mt-10 text-center text-xs text-tekst/40">
        Volgorde van binnenkomst · skippen zet een nummer achteraan · de Speler van de Showcomposer
        kan een nummer als volgende zetten
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
      <Merk titel="Host" groot />
      <p className="mt-3 text-center text-tekst/70">Voer de pincode in.</p>

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
                     placeholder:tracking-normal placeholder:text-tekst/40
                     focus:outline-none focus:ring-2 focus:ring-roze/60"
        />
        {fout && <p className="mt-3 text-center text-sm text-rose-300">{fout}</p>}
        <button
          type="submit"
          disabled={bezig || waarde.length === 0}
          className="mt-4 min-h-14 w-full rounded-xl knop-verloop text-lg font-bold text-white
                     active:brightness-90 disabled:opacity-40"
        >
          {bezig ? 'Bezig…' : 'Ontgrendelen'}
        </button>
      </form>
    </main>
  );
}
