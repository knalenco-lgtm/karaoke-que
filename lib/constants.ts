/**
 * Spelregels die zowel de server als de UI nodig heeft. Staat los van lib/queue.ts
 * zodat client-componenten deze kunnen importeren zonder de Redis-code mee te trekken.
 */

/** Zoveel nummers mag één telefoon tegelijk in de rij hebben staan. */
export const MAX_AANVRAGEN_PER_DEVICE = 2;
/** Bij een drukke rij nog maar zoveel, zodat er meer verschillende mensen aan bod komen. */
export const MAX_AANVRAGEN_DRUKKE_RIJ = 1;
/** Vanaf deze rijlengte (dus meer dan 10 nummers) geldt de krappere limiet. */
export const DRUKKE_RIJ_VANAF = 11;

/**
 * Hoeveel nummers één telefoon open mag hebben staan bij deze rijlengte.
 * Wie er al meer heeft houdt ze; de limiet blokkeert alleen nieuwe aanvragen.
 */
export function maxAanvragenBij(rijLengte: number): number {
  return rijLengte >= DRUKKE_RIJ_VANAF ? MAX_AANVRAGEN_DRUKKE_RIJ : MAX_AANVRAGEN_PER_DEVICE;
}

/** Aantal extra zangers naast de aanvrager: samen dus maximaal 2 op één nummer. */
export const MAX_EXTRA_ZANGERS = 1;
/** Maximale lengte van de naam van een extra zanger. */
export const MAX_EXTRA_ZANGER_LENGTE = 30;
/** Maximale lengte van de naam van de aanvrager zelf. */
export const MAX_ZANGER_LENGTE = 40;

/** Vanaf zoveel nummers in de rij mag de host een verrassingskeuze trekken. */
export const VERRASSING_MIN_RIJ = 30;
/** De bovenste posities blijven buiten de loting: die zijn bijna aan de beurt. */
export const VERRASSING_BESCHERMDE_TOP = 5;
/** Hoe vaak de clients de wachtrij opnieuw ophalen. */
export const POLL_MS = 4000;
