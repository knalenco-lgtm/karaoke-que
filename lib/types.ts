/**
 * `playing` is het nummer dat op dit moment gezongen wordt: dat staat niet meer
 * in de wachtrij. Alleen `queued`, `playing` en `paused` tellen als "levend".
 */
export type RequestStatus = 'queued' | 'playing' | 'paused' | 'done' | 'removed';

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
   * binnenkomst en verschuift alleen door een rondesprong, een skip of de
   * verrassingskeuze van de host.
   */
  arrivalSeq: number;
  status: RequestStatus;
  lastConfirmedAt: number;
  missedCheckins: number;
  /** Aantal rondes op rij zonder op te schuiven; vanaf 2 is de aanvraag beschermd. */
  stilstandRondes: number;
  /** Positie aan het eind van de vorige ronde (0 = nog niet gemeten). */
  vorigePositie: number;
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
  /** Aantal stemmen in de lopende ronde. */
  stemmen: number;
  missedCheckins: number;
  /** Kan niet meer ingehaald worden door de rondewinnaar. */
  isBeschermd: boolean;
  /** Won de vorige stemronde; badge blijft tot de volgende ronde is afgerekend. */
  isWinnaarVorigeRonde: boolean;
  /** Door de host als verrassing naar voren getrokken (0 = nee). */
  verrassingOp: number;
  /** Door de host aangemeld, niet door een gast. */
  viaHost: boolean;
  /** Is deze aanvraag van het opvragende device? */
  isMijn: boolean;
  /** Heeft het opvragende device deze ronde op dit nummer gestemd? */
  heeftMijnStem: boolean;
  /** Mag het opvragende device hierop stemmen? (niet op je eigen aanvraag) */
  magStemmen: boolean;
}

/** Openstaande check-in voor het opvragende device. */
export interface CheckinPrompt {
  requestId: string;
  titel: string;
  positie: number;
  /** Deadline (epoch ms) waarop de aanvraag gepauzeerd wordt. */
  vervaltOp: number;
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
  isMijn: boolean;
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
  gepauzeerd: QueueEntry[];
  checkin: CheckinPrompt | null;
  /** Nummer van de lopende stemronde; wijzigt betekent: nieuwe ronde. */
  ronde: number;
  /** Waar dit device deze ronde op gestemd heeft, of null. */
  mijnStem: string | null;
  /** Aantal openstaande aanvragen van dit device (queued + playing + paused). */
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
