/** "Kenneth + Lisa + Tom" — de aanvrager voorop, daarna de extra zangers. */
export function zangersTekst(zangerNaam: string, extraSingers: string[] = []): string {
  return [zangerNaam, ...extraSingers].filter(Boolean).join(' + ');
}
