/**
 * Genormaliseerd zoekveld: kleine letters, zonder accenten en zonder leestekens.
 * Moet exact overeenkomen met normalize() in scripts/prepare-catalog.mjs,
 * anders matcht de zoekopdracht niet op het voorbewerkte zoekveld.
 */
export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
