#!/usr/bin/env node
/**
 * Zet data/karafun-catalog.csv om naar een compacte data/catalog.json.
 *
 * De KaraFun-CSV is puntkomma-gescheiden met quoted velden:
 *   Id;Title;Artist;Year;Duo;Explicit;"Date Added";Styles;Languages
 *
 * Output: array van tuples [id, titel, artiest, genormaliseerd zoekveld].
 * Tuples i.p.v. objecten scheelt ~40% bestandsgrootte bij 85k nummers.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CSV_PATH = join(ROOT, 'data', 'karafun-catalog.csv');
const JSON_PATH = join(ROOT, 'data', 'catalog.json');

if (!existsSync(CSV_PATH)) {
  console.error(
    `\n  Catalogus niet gevonden: ${CSV_PATH}\n\n` +
      `  Download de complete CSV-catalogus van KaraFun:\n` +
      `    https://www.karafun.com/karaoke-song-list.html  ->  "Entire catalog" -> "Available in CSV format"\n` +
      `  en sla hem op als data/karafun-catalog.csv\n`
  );
  process.exit(1);
}

/** Detecteer het scheidingsteken aan de hand van de header. */
function detectDelimiter(headerLine) {
  const counts = [';', ',', '\t'].map((d) => [d, headerLine.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ';';
}

/** Volwaardige CSV-parser: verwerkt quotes, escaped quotes en newlines in velden. */
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Genormaliseerd zoekveld: kleine letters, zonder accenten en zonder leestekens.
 * Moet exact overeenkomen met normalize() in lib/normalize.ts.
 */
function normalize(input) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

console.log(`Lezen: ${CSV_PATH}`);
const raw = readFileSync(CSV_PATH, 'utf8').replace(/^\ufeff/, '');
const firstLine = raw.slice(0, raw.indexOf('\n'));
const delimiter = detectDelimiter(firstLine);
console.log(`Scheidingsteken: "${delimiter === '\t' ? '\\t' : delimiter}"`);

const rows = parseCsv(raw, delimiter);
if (rows.length < 2) {
  console.error('CSV bevat geen rijen.');
  process.exit(1);
}

const header = rows[0].map((h) => normalize(h));
const findCol = (...names) => {
  for (const name of names) {
    const idx = header.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
};

const idCol = findCol('id', 'song id', 'songid');
const titleCol = findCol('title', 'titel', 'song', 'song title');
const artistCol = findCol('artist', 'artiest', 'artists');

if (titleCol === -1 || artistCol === -1) {
  console.error(`Kolommen "Title"/"Artist" niet gevonden. Header: ${rows[0].join(' | ')}`);
  process.exit(1);
}
console.log(`Kolommen -> id: ${idCol}, titel: ${titleCol}, artiest: ${artistCol}`);

const seen = new Set();
const catalog = [];

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const titel = (row[titleCol] ?? '').trim();
  const artiest = (row[artistCol] ?? '').trim();
  if (!titel || !artiest) continue;

  const id = idCol !== -1 && row[idCol]?.trim() ? row[idCol].trim() : String(i);
  if (seen.has(id)) continue;
  seen.add(id);

  catalog.push([id, titel, artiest, normalize(`${titel} ${artiest}`)]);
}

// Alfabetisch op zoekveld: geeft stabiele, voorspelbare volgorde bij gelijke score.
catalog.sort((a, b) => (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));

writeFileSync(JSON_PATH, JSON.stringify(catalog));

const mb = (readFileSync(JSON_PATH).length / 1024 / 1024).toFixed(1);
console.log(`Geschreven: ${JSON_PATH}`);
console.log(`${catalog.length.toLocaleString('nl-NL')} nummers, ${mb} MB`);
