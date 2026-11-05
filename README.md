# Karaoke Queue

Wachtrij-app voor een karaokefeestje. Gasten scannen een QR-code, zoeken een nummer in de
échte KaraFun-catalogus en vragen het aan. De host heeft een eigen pagina met pincode om de
rij af te werken; meestal doet de Speler van de Knal Showcomposer dat.

- **Gastenpagina** `/`: naam invullen, nummer zoeken, aanvragen (alleen of als duet), je plek
  in de rij, je score met opbouw als je gezongen hebt, het leaderboard, eigen aanvraag intrekken
- **Hostpagina** `/host`: tik het nummer aan dat gaat zingen, skippen, verwijderen,
  verrassingskeuze trekken
- **QR-pagina** `/qr?s=CODE`: QR-code naar de gastenpagina van een show, met downloadknop

**Shows (sinds de karaoke-module van de Knal Showcomposer):** elke avond heeft een eigen
show-code van 5 tekens, zodat twee hosts op één avond elk een eigen wachtrij hebben. De host
maakt een show op `/host` (na de pincode), of de Showcomposer maakt hem. Gasten komen binnen met
`/?s=CODE` (de QR-code) of typen de code in. Een show verloopt na 48 uur. Host-acties mogen met
de pincode of met het Speler-token van de show (`Authorization: Bearer …`), zodat de pincode
nooit in een speelpakket hoeft. De Knal-meter van de Showcomposer schrijft per optreden een
score terug (`actie: uitslag`, sinds fase 13.8 met de opbouw: meter, klassieker, herhaling en
de bonus van de jury); de zanger ziet die op zijn telefoon, iedereen ziet het leaderboard.
Sinds fase 13.8 (na de eerste echte avond) zijn de stemronde en de check-in eruit: de rij is
puur de volgorde van binnenkomst plus wat de host doet. Opmaak in de Knal-huisstijl: Bebas Neue en Montserrat (via `next/font`, in de
site zelf), het roze-oranje verloop en één collage-accent, de gouden microfoon uit de decorset
(`public/microfoon.webp`).

Stack: Next.js (App Router) + TypeScript + Tailwind, Upstash Redis als datastore, live updates
via polling elke 4 seconden (de Speler van de Showcomposer elke 2 seconden). Draait op Vercel zonder verdere infrastructuur.

---

## Lokaal draaien

```bash
npm install
npm run prepare-catalog        # zet de KaraFun-CSV om naar data/catalog.json
cp .env.example .env.local     # vul UPSTASH_* en HOST_PIN in
npm run dev
```

Open http://localhost:3000/host, maak een show en open de QR-link. Gebruik `localhost`, niet
`127.0.0.1`: de dev-server van Next 16 weigert zijn scripts voor een ander adres.

### Zonder Upstash-account

Er zit een kleine in-memory nabootsing van de Upstash REST API bij, handig om even
lokaal te spelen:

```bash
node scripts/fake-upstash.mjs 39117
# in een tweede terminal:
UPSTASH_REDIS_REST_URL=http://127.0.0.1:39117 \
UPSTASH_REDIS_REST_TOKEN=test \
HOST_PIN=4821 \
npm run dev
```

Alles staat dan in het geheugen en is weg zodra je het proces stopt. Niet voor productie.

## Catalogus verversen

`data/karafun-catalog.csv` is de officiële KaraFun-catalogus (85.000+ nummers). Ververs hem
vlak voor het feest even, dan zitten de nieuwste nummers erin:

1. Ga naar https://www.karafun.com/karaoke-song-list.html
2. Onder "Entire catalog" → **Available in CSV format** → download
3. Sla op als `data/karafun-catalog.csv`
4. `npm run prepare-catalog`

Het script detecteert zelf het scheidingsteken en de kolomnamen, en schrijft een compacte
`data/catalog.json` met een genormaliseerd zoekveld (kleine letters, zonder accenten en
leestekens). Dat bestand is gegenereerd en staat daarom niet in git — `npm run build` maakt
het automatisch aan.

Aanvragen kan **uitsluitend** door een resultaat uit deze catalogus te kiezen. Vrije invoer
bestaat niet, dus alles wat in de rij staat, bestaat gegarandeerd op KaraFun.

## Testen

```bash
npm run test:api
```

Start een fake-Upstash plus een dev-server, speelt een compleet feestscenario af (aanvragen,
dubbele nummers, duetten, host-acties, de aanvraaglimiet die bij een drukke rij naar één zakt,
een verrassingskeuze uit een rij van 30+, shows en het Speler-token, scores met opbouw en de
bonus van de jury, scores aan en uit, nummer toevoegen door de host, /go) en ruimt daarna
alles op. Geen Upstash-account nodig.

Tegen een al draaiende server met echte Redis:

```bash
BASE_URL=http://localhost:3000 HOST_PIN=4821 npm run test:api
```

## Omgevingsvariabelen

| Variabele | Waarvoor |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST-endpoint (`KV_REST_API_URL` werkt ook) |
| `UPSTASH_REDIS_REST_TOKEN` | Bijbehorend token (`KV_REST_API_TOKEN` werkt ook) |
| `HOST_PIN` | Pincode voor `/host` |

Ontbreken ze, dan geeft de app een duidelijke melding in plaats van een cryptische stacktrace.

## Deployen op Vercel

1. **GitHub** — push dit project naar een (private) repo.
2. **Vercel** — vercel.com → *Add New Project* → importeer de repo. Next.js wordt automatisch
   herkend; `npm run build` draait ook `prepare-catalog`.
3. **Upstash Redis** — in je Vercel-project → tab *Storage* → *Create Database* → Upstash Redis.
   De env vars worden automatisch gekoppeld; afhankelijk van de integratie heten ze
   `UPSTASH_REDIS_REST_*` of `KV_REST_API_*`. De app accepteert allebei.
4. **Pincode** — Settings → Environment Variables → `HOST_PIN` toevoegen (bijv. `4821`).
5. **Deploy** — gebruik de **productie-URL** (`https://<project>.vercel.app`), niet de
   deployment-URL met een hash erin: die laatste zit achter Vercel-login en verandert bij
   elke deploy.
6. **Testen** — open de URL op twee telefoons, vraag een nummer aan en check `/host`.
7. **QR-code** — ga naar `/qr` en download de PNG, of maak er een op
   https://www.qrcode-monkey.com.

> Na stap 3 en 4 nog één keer opnieuw deployen, anders draait de app nog zonder de env vars.

---

## Spelregels

**Volgorde**: de wachtrij staat puur op volgorde van binnenkomst (`arrivalSeq`). Alleen de host
verandert daar iets aan: skippen zet een nummer achteraan, de Speler van de Showcomposer kan een
nummer als volgende zetten (`actie: toevoegen` met `volgende: true`), en bij een hele volle rij
kan de host een verrassingskeuze trekken.

**Geen stemronde, geen check-in** (sinds fase 13.8): op de eerste echte avond werkten ze niet
goed en de showmaster beheert de volgorde toch zelf. Een aanvraag blijft staan tot hij gezongen
is, de gast hem intrekt of de host hem weghaalt. De meldingen "bijna jouw beurt" (#2) en "jij
bent aan de beurt" (#1) blijven.

**De host tikt aan wie zingt**: er is geen aparte "volgende"-knop. De hele wachtrij is
aanklikbaar; de host tikt het nummer aan dat nu gezongen gaat worden (meestal #1, maar het mag
elk nummer zijn) en bevestigt één keer. Dat haalt het nummer uit de rij als "nu aan de beurt"
en zet het vorige op klaar. Het geheel draait onder een kortdurend slot, zodat twee klikken
elkaar niet kruisen. `actie: klaar` zet het spelende nummer op klaar zonder een volgende te
starten (de Speler, als het nummer afloopt).

**Duetten**: bij het aanvragen kun je één extra zanger toevoegen (samen dus 2). Die naam is
puur weergave: alleen de aanvrager hangt aan het apparaat en kan intrekken. In de lijst staat
er dan "Kenneth + Lisa".

**Limieten**: maximaal 2 openstaande aanvragen per telefoon, maar zodra er meer dan 10
nummers in de rij staan wordt dat er één, zodat er meer verschillende mensen aan de beurt
komen. Wie er op dat moment al twee had houdt ze gewoon; de limiet blokkeert alleen nieuwe
aanvragen. Zakt de rij weer onder de drempel, dan mag er weer een tweede bij. De server
berekent de geldende limiet en geeft hem mee in `GET /api/queue` (`maxAanvragen`), zodat de
knoptekst en de melding niet uit de pas kunnen lopen met wat de API accepteert. De host heeft
geen limiet.

Hetzelfde nummer kan maar één keer tegelijk in de rij staan (of gezongen worden); wie het
nogmaals aanvraagt krijgt "staat al in de rij". Na het zingen mag het opnieuw, de Knal-meter
rekent dan een aftrek voor de herhaling.

**Score met opbouw**: de Speler stuurt per optreden `score`, `labels` en `opbouw`
(`{meter, klassieker, herhaling, bonus}`); nogmaals sturen vervangt de vorige, bijvoorbeeld als
de showmaster achteraf een bonus geeft. De zanger ziet de eindscore met de opbouw eronder, het
leaderboard ook. Met `actie: scores` kan de host de scores uitzetten (geen leaderboard en geen
eigen score op de telefoons) en `actie: uitslagweg` haalt één score weg.

**Meldingen**: na de eerste geslaagde aanvraag legt de app uit waarvoor meldingen dienen en
vraagt pas daarna toestemming; een prompt uit het niets wordt vrijwel altijd weggeklikt. Een
statusregel op de gastenpagina laat zien of ze aan of uit staan. Staan ze aan, dan krijg je
een melding als je nummer op #2 komt en als je aan de beurt bent, en een trilsignaal bij een
nieuwe score.

**Verrassingskeuze**: vanaf 30 nummers in de rij kan de host op "🎲 Verrassing" drukken.
Die trekt willekeurig een aanvraag van buiten de top 5 (die zijn bijna aan de beurt) en zet hem
vooraan in de rij. Zolang het nummer bovenaan staat ziet iedereen "🎲 verrassingskeuze". Skipt
de host het alsnog, dan vervalt de markering.

## Datamodel (Redis)

Alle sleutels van een show staan onder `s:{code}:` (in de tabel zonder dat voorvoegsel, behalve
`show:{code}` en `actieve-shows`).

| Sleutel | Type | Inhoud |
| --- | --- | --- |
| `show:{code}` | hash | `naam`, `aangemaakt`, `spelerToken`, `scoresUit` (48 uur) |
| `actieve-shows` | set | codes van de shows achter `/go` |
| `s:{code}:snapshot` | string | de momentopname van de hele rij als JSON |
| `s:{code}:gescoord` | set | aanvragen met een score van de Knal-meter (leaderboard) |
| `req:{id}` | hash | `songId`, `titel`, `artiest`, `zangerNaam`, `extraSingers`, `deviceId`, `createdAt`, `arrivalSeq`, `status`, `verrassingOp`, `viaHost`, en na het zingen `score`, `labels`, `opbouw`, `gescoordOp` |
| `live` | set | ids van aanvragen die nog leven (`queued` of `playing`) |
| `device:{deviceId}:requests` | set | openstaande aanvragen van dit apparaat |
| `request:counter` | string | oplopende teller voor nieuwe ids |
| `seq:counter` | string | oplopende teller voor `arrivalSeq` |
| `slot:start` | string | kortdurend slot (NX + PX) rond een host-klik |

`status` is `queued`, `playing`, `done` of `removed`. Het nummer dat gezongen wordt staat op
`playing` en zit niet in de wachtrij. Afgeronde en verwijderde aanvragen houden nog 24 uur een
TTL en verdwijnen daarna vanzelf; een aanvraag met een score blijft twee dagen (het
leaderboard). Een aanvraag die vóór fase 13.8 op `paused` stond, telt weer als `queued`; de
oude velden en sleutels van de stemronde en de check-in (`ronde:*`, `lastConfirmedAt`,
`missedCheckins`, `stilstandRondes`, `vorigePositie`) worden niet meer gelezen of geschreven.

`extraSingers` is een JSON-lijst met maximaal 1 naam (zie `MAX_EXTRA_ZANGERS`) en
`verrassingOp` een epoch-ms of 0.
Aanvragen die zonder die velden zijn weggeschreven blijven werken: ze worden gelezen als een
lege lijst en 0.

`GET /api/queue?deviceId=…` geeft in één response de gesorteerde rij, wie er nu aan de beurt is,
het aantal eigen aanvragen en de geldende limiet, het leaderboard en de eigen scores.

### Let op: het verbruik van de gratis Upstash-tier

De gratis tier geeft 10.000 commando's per dag. Met twintig telefoons die elke 4 seconden
pollen, zou dat binnen een half uur op zijn. Daarom houdt de server de rij-toestand 3 seconden
vast in het geheugen van de serverless-instantie (`SNAPSHOT_TTL_MS` in `lib/queue.ts`): alle
gasten die in dat venster pollen krijgen dezelfde momentopname, en elke wijziging gooit hem
meteen weg zodat je je eigen actie direct terugziet. Daarnaast staat de momentopname als één
JSON-sleutel in Redis (`s:{code}:snapshot`), zodat ook een verse instantie hem met één commando
leest, en wachten gelijktijdige verzoeken op dezelfde lezing. Gemeten in `test:api`: 200 keer
pollen zonder wijziging kost 1 commando; een avond van vier uur naar schatting 13.000.

Bij een groot feest of een lange avond kan het alsnog krap worden. Knoppen om aan te draaien:

- `POLL_MS` in `lib/constants.ts` — van 4 naar 6 seconden scheelt een derde
- `SNAPSHOT_TTL_MS` in `lib/queue.ts` — hoger betekent minder Redis, iets tragere updates
- Upstash pay-as-you-go kost een paar cent voor een avond

## Prompt voor je QR-poster

Voor een beeldgenerator (of een ontwerper):

> Ontwerp een staande A3-poster voor een karaokefeest. Donkerpaars-naar-zwarte achtergrond met
> neonroze en cyaan accenten, in de sfeer van een jaren-80 synthwave-club. Bovenaan groot en
> vet de tekst "ZING MEE" in een strak schreefloos lettertype. Daaronder kleiner:
> "Scan de code, kies je nummer en kom zingen." In het midden een groot wit vierkant vlak
> met veel ruimte eromheen waar de QR-code in geplakt kan worden — laat dat vlak leeg. Onderaan
> een subtiele microfoon-illustratie met neonrand. Veel negatieve ruimte, hoog contrast,
> leesbaar vanaf drie meter afstand.

Plak daarna je eigen QR-code (van `/qr` of qrcode-monkey.com) in het witte vlak.
