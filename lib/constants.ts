/**
 * Spelregels die zowel de server als de UI nodig heeft. Staat los van lib/queue.ts
 * zodat client-componenten deze kunnen importeren zonder de Redis-code mee te trekken.
 */

/** Na dit interval zonder bevestiging krijgt de aanvrager een "ben je er nog?"-melding. */
export const CHECKIN_INTERVAL_MS = 15 * 60 * 1000;
/** Zoveel tijd heeft de aanvrager om te bevestigen voordat de aanvraag pauzeert. */
export const CHECKIN_RESPIJT_MS = 5 * 60 * 1000;
/** De bovenste posities krijgen geen check-in: die zijn zo aan de beurt. */
export const CHECKIN_VRIJE_POSITIES = 2;
/** Tweede gemiste check-in betekent definitief vervallen. */
export const MAX_GEMISTE_CHECKINS = 2;
/** Zoveel nummers mag één telefoon tegelijk in de rij hebben staan. */
export const MAX_AANVRAGEN_PER_DEVICE = 2;

/** Aantal extra zangers naast de aanvrager: samen dus maximaal 3 op één nummer. */
export const MAX_EXTRA_ZANGERS = 2;
/** Maximale lengte van de naam van een extra zanger. */
export const MAX_EXTRA_ZANGER_LENGTE = 30;
/** Maximale lengte van de naam van de aanvrager zelf. */
export const MAX_ZANGER_LENGTE = 40;

/** Vanaf deze rijlengte springt de rondewinnaar twee plekken in plaats van één. */
export const GROTE_RIJ_VANAF = 7;
/** Sprong van de rondewinnaar bij een korte rij. */
export const SPRONG_KORTE_RIJ = 1;
/** Sprong van de rondewinnaar bij een volle rij. */
export const SPRONG_VOLLE_RIJ = 2;
/**
 * Na zoveel rondes zonder op te schuiven is een aanvraag beschermd: de
 * rondewinnaar mag er niet meer overheen springen.
 */
export const BESCHERMING_NA_RONDES = 2;

/** Vanaf zoveel nummers in de rij mag de host een verrassingskeuze trekken. */
export const VERRASSING_MIN_RIJ = 30;
/** De bovenste posities blijven buiten de loting: daar is echt op gestemd. */
export const VERRASSING_BESCHERMDE_TOP = 5;
/** Hoe vaak de clients de wachtrij opnieuw ophalen. */
export const POLL_MS = 4000;
