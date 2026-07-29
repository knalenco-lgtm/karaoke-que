/** Status van een aanvraag. Alleen `queued` en `paused` tellen als "openstaand". */
export type RequestStatus = 'queued' | 'paused' | 'done' | 'removed';

/** Zoals opgeslagen in Redis (hash `req:{id}`). */
export interface KaraokeRequest {
  id: string;
  songId: string;
  titel: string;
  artiest: string;
  zangerNaam: string;
  deviceId: string;
  createdAt: number;
  status: RequestStatus;
  lastConfirmedAt: number;
  missedCheckins: number;
  /** Hoe vaak de host dit nummer naar onderen heeft geskipt. */
  skips: number;
}

/** Zoals de client hem ziet, verrijkt met stemmen en device-context. */
export interface QueueEntry {
  id: string;
  songId: string;
  titel: string;
  artiest: string;
  zangerNaam: string;
  createdAt: number;
  status: RequestStatus;
  stemmen: number;
  skips: number;
  missedCheckins: number;
  /** Is deze aanvraag van het opvragende device? */
  isMijn: boolean;
  /** Heeft het opvragende device al gestemd? */
  heeftGestemd: boolean;
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

export interface QueueResponse {
  nuAanDeBeurt: QueueEntry | null;
  wachtrij: QueueEntry[];
  gepauzeerd: QueueEntry[];
  checkin: CheckinPrompt | null;
  /** Aantal openstaande aanvragen van dit device (queued + paused). */
  eigenAanvragen: number;
  serverTijd: number;
}

export interface CatalogSong {
  id: string;
  titel: string;
  artiest: string;
}
