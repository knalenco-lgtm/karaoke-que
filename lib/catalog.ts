import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalize } from './normalize';
import type { CatalogSong } from './types';

/** [id, titel, artiest, genormaliseerd zoekveld] — zie scripts/prepare-catalog.mjs */
type Row = [string, string, string, string];

export class CatalogusOntbreekt extends Error {
  constructor() {
    super(
      'data/catalog.json ontbreekt. Draai `npm run prepare-catalog` om de KaraFun-CSV om te zetten.'
    );
    this.name = 'CatalogusOntbreekt';
  }
}

let rows: Row[] | null = null;
let byId: Map<string, number> | null = null;

/**
 * Laadt de catalogus één keer per serverless-instantie (module scope), zodat
 * warme requests geen 7 MB opnieuw hoeven te parsen.
 */
function laad(): Row[] {
  if (rows) return rows;

  let raw: string;
  try {
    raw = readFileSync(join(process.cwd(), 'data', 'catalog.json'), 'utf8');
  } catch {
    throw new CatalogusOntbreekt();
  }

  rows = JSON.parse(raw) as Row[];
  byId = new Map(rows.map((r, i) => [r[0], i]));
  return rows;
}

export function catalogusGrootte(): number {
  return laad().length;
}

export function getSongById(id: string): CatalogSong | null {
  laad();
  const index = byId!.get(id);
  if (index === undefined) return null;
  const row = rows![index];
  return { id: row[0], titel: row[1], artiest: row[2] };
}

/**
 * Zoekt genormaliseerd in "titel artiest". Alle losse woorden uit de zoekterm
 * moeten voorkomen, zodat "hazes bloed" ook "Bloed, Zweet & Tranen" vindt.
 * Sortering: vroegste treffer eerst, daarna het kortste veld.
 */
export function zoek(query: string, limiet = 20): CatalogSong[] {
  const genormaliseerd = normalize(query);
  if (genormaliseerd.length < 2) return [];

  const termen = genormaliseerd.split(' ').filter(Boolean);
  const alle = laad();

  const treffers: { row: Row; positie: number }[] = [];

  for (const row of alle) {
    const veld = row[3];

    let positie = -1;
    let alleGevonden = true;
    for (const term of termen) {
      const index = veld.indexOf(term);
      if (index === -1) {
        alleGevonden = false;
        break;
      }
      if (positie === -1 || index < positie) positie = index;
    }
    if (!alleGevonden) continue;

    treffers.push({ row, positie });

    // Ruim genoeg om nog zinnig te kunnen sorteren, maar niet de hele catalogus.
    if (treffers.length >= limiet * 25) break;
  }

  treffers.sort((a, b) => a.positie - b.positie || a.row[3].length - b.row[3].length);

  return treffers.slice(0, limiet).map(({ row }) => ({
    id: row[0],
    titel: row[1],
    artiest: row[2],
  }));
}
