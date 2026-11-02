'use client';

import { useEffect, useState } from 'react';
import { QueueRow } from '@/components/QueueRow';
import type { QueueEntry } from '@/lib/types';
import { useQueue } from '@/components/useQueue';
import { api, ApiFout, getPin, getShow, setPin, setShow, wisPin } from '@/lib/client';
import { Merk } from '@/components/Merk';
import {
  GROTE_RIJ_VANAF,
  SPRONG_KORTE_RIJ,
  SPRONG_VOLLE_RIJ,
  VERRASSING_BESCHERMDE_TOP,
  VERRASSING_MIN_RIJ,
} from '@/lib/constants';
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

  async function hostActie(actie: string, requestId?: string) {
    setBezigId((requestId ?? '') + actie);
    setMelding(null);
    try {
      const res = await api<{
        verrassing?: { titel: string; positie: number };
        start?: {
          gestart: { titel: string; zangerNaam: string };
          winnaar: { titel: string; stemmen: number; gesprongen: boolean } | null;
          ronde: number;
        };
      }>('/api/host', { method: 'POST', body: { actie, requestId }, pin });

      if (res.verrassing) {
        setMelding({
          tekst: `🎲 "${res.verrassing.titel}" stond op #${res.verrassing.positie} en staat nu vooraan.`,
          fout: false,
        });
      }
      if (res.start) {
        const w = res.start.winnaar;
        const uitslag = !w
          ? 'Er was niet gestemd, dus niemand sprong.'
          : w.gesprongen
            ? `"${w.titel}" won de ronde met ${w.stemmen} ${w.stemmen === 1 ? 'stem' : 'stemmen'} en sprong vooruit.`
            : `"${w.titel}" won de ronde, maar gaat zelf zingen — geen sprong.`;
        setMelding({
          tekst: `▶ "${res.start.gestart.titel}" — ${res.start.gestart.zangerNaam}. ${uitslag} Ronde ${res.start.ronde} loopt.`,
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
          Tik het nummer aan dat nu gaat zingen. Dat rekent meteen de stemronde af en start een
          nieuwe.
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
            acties={
              <span className="flex w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-white/10 py-1 text-tekst/70">
                <span aria-hidden="true" className="text-sm leading-none">
                  ▲
                </span>
                <span className="text-sm leading-tight font-bold tabular-nums">{entry.stemmen}</span>
              </span>
            }
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
              De lopende stemronde wordt afgerekend en er begint een nieuwe.
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

      {data && data.gepauzeerd.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 px-1 kop text-base tracking-[0.16em] text-tekst/70 uppercase">
            Gepauzeerd (check-in gemist)
          </h2>
          <ul className="flex flex-col gap-2">
            {data.gepauzeerd.map((entry) => (
              <li key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="truncate font-semibold text-tekst/70">{entry.titel}</p>
                <p className="truncate text-sm text-tekst/40">
                  {entry.artiest} · door {zangersTekst(entry.zangerNaam, entry.extraSingers)} ·{' '}
                  {entry.stemmen} stemmen
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => hostActie('herstel', entry.id)}
                    disabled={bezigId === entry.id + 'herstel'}
                    className={`${knop} border-oranje/50 bg-oranje/15 text-tekst active:bg-oranje/30`}
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

      <p className="mt-10 text-center text-xs text-tekst/40">
        Volgorde van binnenkomst · de rondewinnaar springt {SPRONG_KORTE_RIJ} plek vooruit
        ({SPRONG_VOLLE_RIJ} vanaf {GROTE_RIJ_VANAF} nummers)
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
