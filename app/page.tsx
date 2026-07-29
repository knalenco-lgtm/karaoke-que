'use client';

import { useEffect, useState } from 'react';
import { SongSearch } from '@/components/SongSearch';
import { CheckinModal } from '@/components/CheckinModal';
import { QueueRow, StemKnop } from '@/components/QueueRow';
import { useQueue } from '@/components/useQueue';
import { vraagNotificatiePermissie } from '@/components/aandacht';
import { api, ApiFout, getDeviceId, getNaam, setNaam } from '@/lib/client';
import { MAX_AANVRAGEN_PER_DEVICE } from '@/lib/constants';
import type { CatalogSong, QueueEntry } from '@/lib/types';

export default function GastenPagina() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [naam, setNaamState] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [bezigId, setBezigId] = useState<string | null>(null);

  // localStorage bestaat pas na hydratie: tijdens de server-render zou dit een
  // andere uitkomst geven en de hydratie breken. Vandaar de effect-hook.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeviceId(getDeviceId());
    setNaamState(getNaam());
  }, []);

  const { data, fout, klokverschil, ververs } = useQueue(deviceId);

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

  async function vraagAan(song: CatalogSong) {
    await api('/api/request', {
      method: 'POST',
      body: { songId: song.id, zangerNaam: naam, deviceId },
    });
    // Toestemming pas vragen als iemand echt meedoet — dan snapt-ie waarom.
    vraagNotificatiePermissie();
    setMelding(`"${song.titel}" staat in de rij! 🎉`);
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

  const vol = (data?.eigenAanvragen ?? 0) >= MAX_AANVRAGEN_PER_DEVICE;
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
          onAanvragen={vraagAan}
          geblokkeerdeReden={
            vol
              ? `Je hebt al ${MAX_AANVRAGEN_PER_DEVICE} nummers openstaan. Zodra er eentje geweest is, mag je weer.`
              : null
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

      <section className="mt-7">
        <h2 className="mb-2 flex items-baseline justify-between px-1">
          <span className="text-xs font-semibold tracking-widest text-fuchsia-300/70 uppercase">
            De wachtrij
          </span>
          {data && (
            <span className="text-xs text-fuchsia-200/50">
              {data.wachtrij.length} {data.wachtrij.length === 1 ? 'nummer' : 'nummers'}
            </span>
          )}
        </h2>

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
                aanDeBeurt={i === 0}
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

      <p className="mt-10 text-center text-xs text-fuchsia-200/40">
        Eén stem per nummer per telefoon · max {MAX_AANVRAGEN_PER_DEVICE} aanvragen tegelijk
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
        />
      )}
    </main>
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
          <p className="mt-2 text-lg font-semibold text-neon">🎤 {entry.zangerNaam}</p>
        </>
      ) : (
        <p className="mt-2 text-fuchsia-200/60">Nog niemand — vraag het eerste nummer aan!</p>
      )}
    </section>
  );
}

function NaamScherm({ onKlaar }: { onKlaar: (naam: string) => void }) {
  const [waarde, setWaarde] = useState('');
  const opgeschoond = waarde.trim().slice(0, 40);

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
          maxLength={40}
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
