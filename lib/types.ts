/**
 * `playing` is het nummer dat op dit moment gezongen wordt: dat staat niet meer
 * in de wachtrij. Alleen `queued` en `playing` tellen als "levend". (Sinds fase 13.8 is er
 * geen check-in meer, dus ook geen `paused`: een aanvraag blijft staan tot hij gezongen is of
 * de host hem weghaalt.)
 */
export type RequestStatus = 'queued' | 'playing' | 'done' | 'removed';

/** Zoals opgeslagen in Redis (hash `req:{id}`). */
export interface KaraokeRequest {
  id: string;
  songId: string;
  titel: string;
  artiest: string;
  zangerNaam: string;
  /** Extra zangers naast de aanvrager (duet/trio). Puur weergave. */
  extraSingers: string[];
  deviceId: string;
  createdAt: number;
  /**
   * Bepaalt de plek in de wachtrij: laag is vooraan. Start als volgnummer van
   * binnenkomst en verschuift alleen door een skip, "als volgende" of de
   * verrassingskeuze van de host.
   */
  arrivalSeq: number;
  status: RequestStatus;
  /** Tijdstip waarop de host dit nummer als verrassing naar voren trok (0 = nooit). */
  verrassingOp: number;
  /** Door de host aangemeld (de Speler van de Showcomposer), niet door een gast. */
  viaHost: boolean;
}

/** Zoals de client hem ziet. Bevat nooit wie er gestemd heeft, alleen aantallen. */
export interface QueueEntry {
  id: string;
  songId: string;
  titel: string;
  artiest: string;
  zangerNaam: string;
  extraSingers: string[];
  createdAt: number;
  arrivalSeq: number;
  status: RequestStatus;
  /** Door de host als verrassing naar voren getrokken (0 = nee). */
  verrassingOp: number;
  /** Door de host aangemeld, niet door een gast. */
  viaHost: boolean;
  /** Is deze aanvraag van het opvragende device? */
  isMijn: boolean;
}

/** De uitslag van de Knal-meter voor één optreden (Showcomposer, fase 13). */
export interface Uitslag {
  id: string;
  songId: string;
  titel: string;
  artiest: string;
  zangerNaam: string;
  extraSingers: string[];
  /** 0 tot 10.000. */
  score: number;
  /** Labelteksten zoals de meter ze gaf, bijvoorbeeld "Toonvast". */
  labels: string[];
  /** Epoch ms waarop de score binnenkwam. */
  tijd: number;
  /**
   * Fase 13.8: de opbouw van de score: de meterscore plus de klassiekerbonus, de aftrek bij een
   * herhaling en de bonus van de jury (elk 0 als het niet geldt). Null bij een score zonder opbouw.
   */
  opbouw: ScoreOpbouw | null;
  isMijn: boolean;
}

export interface ScoreOpbouw {
  meter: number;
  klassieker: number;
  /** Negatief of 0. */
  herhaling: number;
  bonus: number;
}

export interface ShowInfo {
  code: string;
  naam: string;
  /**
   * Scores aan (standaard). Zet de host ze uit, dan geven leaderboard en eigen scores niets;
   * de scores van eerder blijven bewaard en komen terug als ze weer aan gaan.
   */
  scoresAan: boolean;
}

export interface QueueResponse {
  show: ShowInfo;
  /** Het nummer dat nu gezongen wordt; staat niet in `wachtrij`. */
  nuAanDeBeurt: QueueEntry | null;
  wachtrij: QueueEntry[];
  /** Aantal openstaande aanvragen van dit device (queued + playing). */
  eigenAanvragen: number;
  /** Hoeveel aanvragen één telefoon nu open mag hebben; zakt naar 1 bij een drukke rij. */
  maxAanvragen: number;
  /** De hoogste scores van de avond (hoogstens 10), hoogste eerst. */
  leaderboard: Uitslag[];
  /** De scores van de optredens van dit device, nieuwste eerst. */
  mijnUitslagen: Uitslag[];
  serverTijd: number;
}

export interface CatalogSong {
  id: string;
  titel: string;
  artiest: string;
}
