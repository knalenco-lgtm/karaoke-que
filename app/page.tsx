'use client';

import { useEffect, useRef, useState } from 'react';
import { SongSearch } from '@/components/SongSearch';
import { CheckinModal } from '@/components/CheckinModal';
import { QueueRow, StemKnop } from '@/components/QueueRow';
import { useQueue } from '@/components/useQueue';
import { useBijnaAanDeBeurt, useMeldingen, type MeldingStatus } from '@/components/aandacht';
import { api, ApiFout, getDeviceId, getNaam, setNaam } from '@/lib/client';
import {
  BESCHERMING_NA_RONDES,
  DRUKKE_RIJ_VANAF,
  GROTE_RIJ_VANAF,
  MAX_AANVRAGEN_PER_DEVICE,
  MAX_EXTRA_ZANGERS,
  MAX_ZANGER_LENGTE,
  SPRONG_KORTE_RIJ,
  SPRONG_VOLLE_RIJ,
  VERRASSING_MIN_RIJ,
} from '@/lib/constants';
import { zangersTekst } from '@/lib/zangers';
import type { CatalogSong, QueueEntry } from '@/lib/types';

export default function GastenPagina() {
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

  const { data, fout, klokverschil, ververs } = useQueue(deviceId);
  useBijnaAanDeBeurt(data?.wachtrij ?? []);
  const nieuweRonde = useRondeWissel(data?.ronde ?? null);

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
    setMelding(
      `"${song.titel}" staat in de rij! 🎉 Je schuift vanzelf op in de rij. Extra snel? ` +
        'Vraag je vrienden om deze ronde op jullie nummer te stemmen.'
    );
    await ververs();
  }

  if (naam === null) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="puls text-fuchsia-200/60">Laden…</p>
      </main>
    );
  }
  if (naam === '') return <NaamScherm onKlaar={setNaamState} />;

  // De server bepaalt de limiet (die zakt naar 1 bij een drukke rij) en geeft
  // hem mee, zodat de knop en de melding niet uit de pas kunnen lopen.
  const maxAanvragen = data?.maxAanvragen ?? MAX_AANVRAGEN_PER_DEVICE;
  const vol = (data?.eigenAanvragen ?? 0) >= maxAanvragen;
  const mijnGepauzeerd = data?.gepauzeerd.filter((e) => e.isMijn) ?? [];

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-5 pb-16">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-black tracking-tight">
          Karaoke<span className="text-neon">.</span>
        </h1>
        <button
          type="button"
          onClick={() => setNaamState('')}
          className="truncate text-sm text-fuchsia-200/60 underline-offset-4 hover:underline"
        >
          {naam}
        </button>
      </header>

      <NuAanDeBeurt entry={data?.nuAanDeBeurt ?? null} laadt={!data} />

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-xs font-semibold tracking-widest text-fuchsia-300/70 uppercase">
          Nummer aanvragen
        </h2>
        <SongSearch
          zangerNaam={naam}
          onAanvragen={vraagAan}
          geblokkeerdeReden={
            !vol
              ? null
              : maxAanvragen === 1
                ? `Het is druk in de rij, dus even één nummer per telefoon — zo komt iedereen aan de beurt. Zodra jouw nummer geweest is, mag je weer.`
                : `Je hebt al ${maxAanvragen} nummers openstaan. Zodra er eentje geweest is, mag je weer.`
          }
        />
      </section>

      {melding && (
        <p className="mt-4 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm">
          {melding}
        </p>
      )}
      {fout && (
        <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {fout}
        </p>
      )}

      {toonMeldingUitleg && meldingStatus === 'default' && (
        <div className="mt-4 rounded-xl border border-lime-400/30 bg-lime-400/10 px-4 py-4">
          <p className="text-sm leading-relaxed">
            Zet meldingen aan, dan waarschuwen we je als je bijna aan de beurt bent en voor de
            ben-je-er-nog-check.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => vraagPermissie()}
              className="min-h-12 flex-1 rounded-xl bg-lime-400 font-bold text-black active:bg-lime-500"
            >
              Meldingen aanzetten
            </button>
            <button
              type="button"
              onClick={() => setToonMeldingUitleg(false)}
              className="min-h-12 rounded-xl border border-white/15 px-4 text-sm text-fuchsia-100/70
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
          <span className="text-xs font-semibold tracking-widest text-fuchsia-300/70 uppercase">
            De wachtrij
          </span>
          {data && (
            <span className="text-xs text-fuchsia-200/50">
              {data.wachtrij.length} {data.wachtrij.length === 1 ? 'nummer' : 'nummers'}
            </span>
          )}
        </h2>

        <p className="px-1 text-xs leading-relaxed text-fuchsia-100/70">
          Wie het eerst komt, die het eerst zingt — de rondewinnaar springt vooruit.
        </p>

        <Spelregels maxAanvragen={maxAanvragen} />

        {nieuweRonde && (
          <p className="mb-2 rounded-xl border border-lime-400/40 bg-lime-400/10 px-4 py-3 text-sm font-semibold text-lime-100">
            🔔 Nieuwe stemronde! Je hebt weer één stem.
          </p>
        )}

        {data && data.wachtrij.length === 0 ? (
          <p className="kaart px-4 py-6 text-center text-sm text-fuchsia-200/60">
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
                                 text-fuchsia-100/70 active:bg-white/10 disabled:opacity-50"
                    >
                      Intrekken
                    </button>
                  ) : (
                    <StemKnop
                      entry={entry}
                      bezig={bezigId === entry.id}
                      onStem={() =>
                        actie(
                          () =>
                            api('/api/vote', {
                              method: 'POST',
                              body: { requestId: entry.id, deviceId },
                            }),
                          entry.id
                        )
                      }
                    />
                  )
                }
              />
            ))}
          </ul>
        )}

        {data && data.wachtrij.length > 0 && (
          <p className="mt-2 px-1 text-xs text-fuchsia-200/40">
            Eén stem per ronde — druk op een ander nummer om je stem te verplaatsen. Stemmen is
            optioneel en anoniem.
          </p>
        )}
      </section>

      {mijnGepauzeerd.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-2 px-1 text-xs font-semibold tracking-widest text-fuchsia-300/70 uppercase">
            Gepauzeerd
          </h2>
          <ul className="flex flex-col gap-2">
            {mijnGepauzeerd.map((entry) => (
              <li key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="truncate font-semibold text-fuchsia-100/70">{entry.titel}</p>
                <p className="truncate text-sm text-fuchsia-200/40">{entry.artiest}</p>
                <p className="mt-1 text-xs text-fuchsia-200/50">
                  Je hebt de check-in gemist. Nog één keer en je aanvraag vervalt.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    actie(
                      () =>
                        api('/api/checkin', {
                          method: 'POST',
                          body: { actie: 'hervat', requestId: entry.id, deviceId },
                        }),
                      entry.id
                    )
                  }
                  disabled={bezigId === entry.id}
                  className="mt-3 min-h-12 w-full rounded-xl bg-lime-400 font-bold text-black
                             active:bg-lime-500 disabled:opacity-50"
                >
                  Ik ben er weer!
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-center text-xs leading-relaxed text-fuchsia-200/40">
        Volgorde van binnenkomst · max {maxAanvragen}{' '}
        {maxAanvragen === 1 ? 'aanvraag' : 'aanvragen'} tegelijk
        {maxAanvragen === 1 && ' (drukke rij)'} · één stem per stemronde, te verplaatsen zolang de
        ronde loopt · hou deze pagina open
      </p>

      {data?.checkin && (
        <CheckinModal
          checkin={data.checkin}
          klokverschil={klokverschil}
          onBevestig={() =>
            actie(() =>
              api('/api/checkin', {
                method: 'POST',
                body: { requestId: data.checkin!.requestId, deviceId },
              })
            )
          }
          onAfmelden={async () => {
            const id = data.checkin!.requestId;
            try {
              await api('/api/request', { method: 'DELETE', body: { requestId: id, deviceId } });
              setMelding('Je nummer is uit de lijst gehaald. Tot de volgende keer! 👋');
            } catch (error) {
              setMelding(error instanceof ApiFout ? error.message : 'Er ging iets mis.');
            }
            await ververs();
          }}
        />
      )}
    </main>
  );
}

/**
 * Signaleert dat er een nieuwe stemronde begonnen is. Blijft acht seconden
 * staan; lang genoeg om te zien, kort genoeg om niet in de weg te zitten.
 */
function useRondeWissel(ronde: number | null): boolean {
  const vorige = useRef<number | null>(null);
  const [zichtbaar, setZichtbaar] = useState(false);

  useEffect(() => {
    if (ronde === null) return;
    if (vorige.current === null || vorige.current === ronde) {
      vorige.current = ronde;
      return;
    }
    vorige.current = ronde;
    setZichtbaar(true);
    const timer = setTimeout(() => setZichtbaar(false), 8000);
    return () => clearTimeout(timer);
  }, [ronde]);

  return zichtbaar;
}

function MeldingStatusregel({
  status,
  onAanzetten,
}: {
  status: MeldingStatus;
  onAanzetten: () => void;
}) {
  if (status === 'granted') {
    return <p className="mt-4 px-1 text-xs text-lime-300/80">🔔 Meldingen aan</p>;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
      <p className="text-xs text-fuchsia-200/50">
        🔕 Meldingen uit
        {status === 'default'
          ? ' — mis niks als je aan de beurt bent'
          : ' — zet ze aan via je browserinstellingen'}
      </p>
      {status === 'default' && (
        <button
          type="button"
          onClick={onAanzetten}
          className="text-xs font-semibold text-neon underline underline-offset-2"
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
        <span className="text-fuchsia-300/70">▸</span> Spelregels
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-fuchsia-100/80">
        De rij is op volgorde van aanvragen. Tijdens elk nummer mag je één stem uitbrengen op je
        favoriet; de winnaar van de ronde springt {SPRONG_KORTE_RIJ} plekje vooruit (
        {SPRONG_VOLLE_RIJ} bij een volle rij, {GROTE_RIJ_VANAF}+). Daarna beginnen de stemmen
        opnieuw. Een nummer dat {BESCHERMING_NA_RONDES} rondes stilstaat kan niet nog eens worden
        ingehaald. Stemmen is optioneel en anoniem. En onthoud: het is geen wedstrijd — het
        belangrijkste is dat we er samen een gezellige avond van maken. 🎤
      </p>
      <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-fuchsia-100/70">
        <li>
          Je mag {MAX_AANVRAGEN_PER_DEVICE} nummers tegelijk in de lijst hebben. Staan er meer dan{' '}
          {DRUKKE_RIJ_VANAF - 1} nummers in de rij, dan wordt dat één per telefoon, zodat er meer
          verschillende mensen aan de beurt komen.{' '}
          {maxAanvragen === 1 && (
            <strong className="text-neon">Op dit moment geldt die krappere limiet.</strong>
          )}{' '}
          Op je eigen aanvraag stemmen kan niet.
        </li>
        <li>
          Zing je met z&apos;n tweeën of drieën? Voeg bij het aanvragen extra zangers toe —
          maximaal {MAX_EXTRA_ZANGERS + 1} per nummer.
        </li>
        <li>
          Hou deze pagina open en zet meldingen aan. Sta je lang in de rij, dan vragen we elk
          kwartier of je er nog bent. Twee keer niet reageren, of &quot;nee&quot; antwoorden,
          betekent dat je nummer vervalt.
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
      <p className="text-xs font-semibold tracking-[0.2em] text-fuchsia-300/70 uppercase">
        Nu aan de beurt
      </p>
      {laadt ? (
        <p className="puls mt-2 text-fuchsia-200/50">…</p>
      ) : entry ? (
        <>
          <p className="mt-2 text-2xl leading-tight font-black text-balance">{entry.titel}</p>
          <p className="mt-1 text-sm text-fuchsia-200/60">{entry.artiest}</p>
          <p className="mt-2 text-lg font-semibold text-neon text-balance">
            🎤 {zangersTekst(entry.zangerNaam, entry.extraSingers)}
          </p>
        </>
      ) : (
        <p className="mt-2 text-fuchsia-200/60">
          Nog niks gestart — de spelleider kiest het eerste nummer.
        </p>
      )}
    </section>
  );
}

function NaamScherm({ onKlaar }: { onKlaar: (naam: string) => void }) {
  const [waarde, setWaarde] = useState('');
  const opgeschoond = waarde.trim().slice(0, MAX_ZANGER_LENGTE);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-10">
      <h1 className="text-center text-4xl font-black tracking-tight">
        Karaoke<span className="text-neon">.</span>
      </h1>
      <p className="mt-3 text-center text-fuchsia-100/70">
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
          className="kaart min-h-14 w-full px-4 text-center text-lg placeholder:text-fuchsia-200/40
                     focus:outline-none focus:ring-2 focus:ring-fuchsia-400/60"
        />
        <button
          type="submit"
          disabled={!opgeschoond}
          className="mt-4 min-h-14 w-full rounded-xl bg-fuchsia-500 text-lg font-bold text-white
                     active:bg-fuchsia-600 disabled:opacity-40"
        >
          Laat maar horen 🎤
        </button>
      </form>
    </main>
  );
}
