'use client';

import { useEffect, useState } from 'react';
import { SongSearch } from '@/components/SongSearch';
import { QueueRow } from '@/components/QueueRow';
import { useQueue } from '@/components/useQueue';
import { useBijnaAanDeBeurt, useMeldingen, type MeldingStatus } from '@/components/aandacht';
import { api, ApiFout, getDeviceId, getNaam, getShow, setNaam, setShow } from '@/lib/client';
import { CodeScherm } from '@/components/CodeScherm';
import { Merk } from '@/components/Merk';
import { JouwScore, Leaderboard, useScoreMelding } from '@/components/Scores';
import {
  DRUKKE_RIJ_VANAF,
  MAX_AANVRAGEN_PER_DEVICE,
  MAX_EXTRA_ZANGERS,
  MAX_ZANGER_LENGTE,
  VERRASSING_MIN_RIJ,
} from '@/lib/constants';
import { zangersTekst } from '@/lib/zangers';
import type { CatalogSong, QueueEntry } from '@/lib/types';

export default function GastenPagina() {
  // Fase 13: elke avond heeft een eigen show-code (uit de QR-code, `?s=`).
  const [show, setShowState] = useState<string | null>(null);
  const [codeMelding, setCodeMelding] = useState<string | null>(null);
  // Via /go (meerdere of geen actieve shows): de codepagina met de actieve shows, niet een bewaarde show.
  const [viaGo, setViaGo] = useState(false);
  useEffect(() => {
    const go = new URLSearchParams(window.location.search).get('go') === '1';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViaGo(go);
    if (go) {
      setShow('');
      const url = new URL(window.location.href);
      url.searchParams.delete('go');
      window.history.replaceState(null, '', url);
    }
    setShowState(go ? '' : getShow());
  }, []);

  if (show === null) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="puls text-tekst/60">Laden…</p>
      </main>
    );
  }
  if (show === '') {
    return (
      <CodeScherm
        viaGo={viaGo}
        melding={codeMelding}
        onCode={(code) => {
          setShow(code);
          setShowState(code);
        }}
      />
    );
  }
  return (
    <Gasten
      key={show}
      onVerlopen={(melding) => {
        setShow('');
        setCodeMelding(melding);
        setShowState('');
      }}
    />
  );
}

function Gasten({ onVerlopen }: { onVerlopen: (melding: string) => void }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [naam, setNaamState] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [bezigId, setBezigId] = useState<string | null>(null);
  /** Pas na de eerste aanvraag vragen we om meldingen — dan snapt de gast waarom. */
  const [toonMeldingUitleg, setToonMeldingUitleg] = useState(false);
  const { status: meldingStatus, vraagPermissie } = useMeldingen();

  // localStorage bestaat pas na hydratie: tijdens de server-render zou dit een
  // andere uitkomst geven en de hydratie breken. Vandaar de effect-hook.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeviceId(getDeviceId());
    setNaamState(getNaam());
  }, []);

  const { data, fout, foutCode, ververs } = useQueue(deviceId);
  useBijnaAanDeBeurt(data?.wachtrij ?? []);
  useScoreMelding(data?.mijnUitslagen ?? []);
  // Een show die niet (meer) bestaat: terug naar het invoeren van de code.
  useEffect(() => {
    if (foutCode === 'SHOW' || foutCode === 'CODE') onVerlopen(fout ?? 'Deze show-code bestaat niet (meer).');
  }, [foutCode, fout, onVerlopen]);
  async function actie(fn: () => Promise<unknown>, id?: string) {
    setMelding(null);
    if (id) setBezigId(id);
    try {
      await fn();
      await ververs();
    } catch (error) {
      setMelding(error instanceof ApiFout ? error.message : 'Er ging iets mis.');
    } finally {
      setBezigId(null);
    }
  }

  async function vraagAan(song: CatalogSong, extraSingers: string[]) {
    await api('/api/request', {
      method: 'POST',
      body: { songId: song.id, zangerNaam: naam, extraSingers, deviceId },
    });
    // Toestemming pas vragen als iemand echt meedoet, en met uitleg vooraf:
    // een prompt uit het niets wordt vrijwel altijd weggeklikt.
    setToonMeldingUitleg(true);
    setMelding(`"${song.titel}" staat in de rij! 🎉 Hou deze pagina open, dan zie je wanneer je aan de beurt bent.`);
    await ververs();
  }

  if (naam === null) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="puls text-tekst/60">Laden…</p>
      </main>
    );
  }
  if (naam === '') return <NaamScherm show={data?.show.naam} onKlaar={setNaamState} />;

  // De server bepaalt de limiet (die zakt naar 1 bij een drukke rij) en geeft
  // hem mee, zodat de knop en de melding niet uit de pas kunnen lopen.
  const maxAanvragen = data?.maxAanvragen ?? MAX_AANVRAGEN_PER_DEVICE;
  const vol = (data?.eigenAanvragen ?? 0) >= maxAanvragen;

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-5 pb-16">
      <Merk
        show={data?.show.naam}
        rechts={
          <button
            type="button"
            onClick={() => setNaamState('')}
            className="max-w-[40%] truncate pb-1 text-sm text-tekst/60 underline-offset-4 hover:underline"
          >
            {naam}
          </button>
        }
      />

      <NuAanDeBeurt entry={data?.nuAanDeBeurt ?? null} laadt={!data} />

      <JouwScore uitslagen={data?.mijnUitslagen ?? []} />

      <section className="mt-6">
        <h2 className="mb-2 px-1 kop text-base tracking-[0.16em] text-tekst/70 uppercase">
          Nummer aanvragen
        </h2>
        <SongSearch
          zangerNaam={naam}
          onAanvragen={vraagAan}
          geblokkeerdeReden={
            !vol
              ? null
              : maxAanvragen === 1
                ? `Het is druk in de rij, dus even één nummer per telefoon, zo komt iedereen aan de beurt. Zodra jouw nummer geweest is, mag je weer.`
                : `Je hebt al ${maxAanvragen} nummers openstaan. Zodra er eentje geweest is, mag je weer.`
          }
        />
      </section>

      {melding && (
        <p className="mt-4 rounded-xl border border-roze/30 bg-roze/10 px-4 py-3 text-sm">
          {melding}
        </p>
      )}
      {fout && (
        <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {fout}
        </p>
      )}

      {toonMeldingUitleg && meldingStatus === 'default' && (
        <div className="mt-4 rounded-xl border border-oranje/30 bg-oranje/10 px-4 py-4">
          <p className="text-sm leading-relaxed">
            Zet meldingen aan, dan waarschuwen we je als je bijna aan de beurt bent.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => vraagPermissie()}
              className="min-h-12 flex-1 rounded-xl knop-verloop font-bold text-white active:brightness-90"
            >
              Meldingen aanzetten
            </button>
            <button
              type="button"
              onClick={() => setToonMeldingUitleg(false)}
              className="min-h-12 rounded-xl border border-white/15 px-4 text-sm text-tekst/70
                         active:bg-white/10"
            >
              Later
            </button>
          </div>
        </div>
      )}

      <MeldingStatusregel status={meldingStatus} onAanzetten={vraagPermissie} />

      <section className="mt-7">
        <h2 className="mb-1 flex items-baseline justify-between px-1">
          <span className="kop text-base tracking-[0.16em] text-tekst/70 uppercase">
            De wachtrij
          </span>
          {data && (
            <span className="text-xs text-tekst/50">
              {data.wachtrij.length} {data.wachtrij.length === 1 ? 'nummer' : 'nummers'}
            </span>
          )}
        </h2>

        <p className="px-1 text-xs leading-relaxed text-tekst/70">
          Wie het eerst komt, die het eerst zingt. De spelleider bepaalt wie er aan de beurt is.
        </p>

        <Spelregels maxAanvragen={maxAanvragen} />

        {data && data.wachtrij.length === 0 ? (
          <p className="kaart px-4 py-6 text-center text-sm text-tekst/60">
            Nog niks in de rij. Wees de eerste! 🎶
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data?.wachtrij.map((entry, i) => (
              <QueueRow
                key={entry.id}
                entry={entry}
                positie={i + 1}
                eerstvolgende={i === 0}
                acties={
                  entry.isMijn ? (
                    <button
                      type="button"
                      onClick={() =>
                        actie(
                          () =>
                            api('/api/request', {
                              method: 'DELETE',
                              body: { requestId: entry.id, deviceId },
                            }),
                          entry.id
                        )
                      }
                      disabled={bezigId === entry.id}
                      className="min-h-14 shrink-0 rounded-xl border border-white/15 px-3 text-xs
                                 text-tekst/70 active:bg-white/10 disabled:opacity-50"
                    >
                      Intrekken
                    </button>
                  ) : null
                }
              />
            ))}
          </ul>
        )}

      </section>

      <Leaderboard lijst={data?.leaderboard ?? []} />

      <p className="mt-8 text-center text-xs leading-relaxed text-tekst/40">
        Volgorde van binnenkomst · max {maxAanvragen}{' '}
        {maxAanvragen === 1 ? 'aanvraag' : 'aanvragen'} tegelijk
        {maxAanvragen === 1 && ' (drukke rij)'} · hou deze pagina open
      </p>
    </main>
  );
}

function MeldingStatusregel({
  status,
  onAanzetten,
}: {
  status: MeldingStatus;
  onAanzetten: () => void;
}) {
  if (status === 'granted') {
    return <p className="mt-4 px-1 text-xs text-goed/80">🔔 Meldingen aan</p>;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
      <p className="text-xs text-tekst/50">
        🔕 Meldingen uit
        {status === 'default'
          ? '. Mis niks als je aan de beurt bent.'
          : '. Zet ze aan via je browserinstellingen.'}
      </p>
      {status === 'default' && (
        <button
          type="button"
          onClick={onAanzetten}
          className="text-xs font-semibold text-roze underline underline-offset-2"
        >
          Aanzetten
        </button>
      )}
    </div>
  );
}

function Spelregels({ maxAanvragen }: { maxAanvragen: number }) {
  return (
    <details className="kaart mt-2 mb-3 px-4 py-3">
      <summary className="cursor-pointer list-none text-sm font-semibold marker:hidden">
        <span className="text-tekst/70">▸</span> Spelregels
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-tekst/80">
        De rij is op volgorde van aanvragen: wie het eerst komt, die het eerst zingt. De spelleider
        roept je naar voren als je aan de beurt bent. En onthoud: het is geen wedstrijd, het
        belangrijkste is dat we er samen een gezellige avond van maken. 🎤
      </p>
      <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-tekst/70">
        <li>
          Je mag {MAX_AANVRAGEN_PER_DEVICE} nummers tegelijk in de lijst hebben. Staan er meer dan{' '}
          {DRUKKE_RIJ_VANAF - 1} nummers in de rij, dan wordt dat één per telefoon, zodat er meer
          verschillende mensen aan de beurt komen.{' '}
          {maxAanvragen === 1 && (
            <strong className="text-roze">Op dit moment geldt die krappere limiet.</strong>
          )}
        </li>
        <li>
          Zing je samen met iemand? Voeg bij het aanvragen een extra zanger toe, maximaal{' '}
          {MAX_EXTRA_ZANGERS + 1} per nummer.
        </li>
        <li>
          Je aanvraag blijft staan tot je gezongen hebt. Toch niet meer? Trek hem in, dan is de
          plek voor iemand anders. Hou deze pagina open en zet meldingen aan, dan hoor je het als
          je bijna aan de beurt bent.
        </li>
        <li>
          Na je optreden zie je hier de score van de Knal-meter, met wat erbij of eraf ging, en
          het leaderboard van de avond.
        </li>
        <li>
          Bij een hele volle lijst ({VERRASSING_MIN_RIJ}+ nummers) kan de spelleider af en toe een
          🎲 verrassingsnummer uit de rij trekken, zodat ook de onderkant een kans maakt.
        </li>
      </ul>
    </details>
  );
}

function NuAanDeBeurt({ entry, laadt }: { entry: QueueEntry | null; laadt: boolean }) {
  return (
    <section className={`kaart px-5 py-5 text-center ${entry ? 'gloed' : ''}`} aria-live="polite">
      <p className="kop text-base tracking-[0.18em] text-tekst/70 uppercase">
        Nu aan de beurt
      </p>
      {laadt ? (
        <p className="puls mt-2 text-tekst/50">…</p>
      ) : entry ? (
        <>
          <p className="mt-2 text-2xl leading-tight font-black text-balance">{entry.titel}</p>
          <p className="mt-1 text-sm text-tekst/60">{entry.artiest}</p>
          <p className="mt-2 text-lg font-semibold text-roze text-balance">
            🎤 {zangersTekst(entry.zangerNaam, entry.extraSingers)}
          </p>
        </>
      ) : (
        <p className="mt-2 text-tekst/60">
          Nog niks gestart. De spelleider kiest het eerste nummer.
        </p>
      )}
    </section>
  );
}

function NaamScherm({ show, onKlaar }: { show?: string; onKlaar: (naam: string) => void }) {
  const [waarde, setWaarde] = useState('');
  const opgeschoond = waarde.trim().slice(0, MAX_ZANGER_LENGTE);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-10">
      <Merk groot show={show} />
      <p className="mt-3 text-center text-tekst/70">
        Hoe heet je? Dit komt bij je nummer in de wachtrij te staan.
      </p>

      <form
        className="mt-7"
        onSubmit={(e) => {
          e.preventDefault();
          if (!opgeschoond) return;
          setNaam(opgeschoond);
          onKlaar(opgeschoond);
        }}
      >
        <input
          type="text"
          value={waarde}
          onChange={(e) => setWaarde(e.target.value)}
          placeholder="Je naam"
          maxLength={MAX_ZANGER_LENGTE}
          autoFocus
          autoComplete="given-name"
          enterKeyHint="go"
          className="kaart min-h-14 w-full px-4 text-center text-lg placeholder:text-tekst/40
                     focus:outline-none focus:ring-2 focus:ring-roze/60"
        />
        <button
          type="submit"
          disabled={!opgeschoond}
          className="mt-4 min-h-14 w-full rounded-xl knop-verloop text-lg font-bold text-white
                     active:brightness-90 disabled:opacity-40"
        >
          Laat maar horen
        </button>
      </form>
    </main>
  );
}
