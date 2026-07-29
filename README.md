# Karaoke Queue

Wachtrij-app voor een karaokefeestje. Gasten scannen een QR-code, zoeken een nummer in de
échte KaraFun-catalogus, vragen het aan en stemmen op elkaars nummers. De host heeft een
eigen pagina met pincode om de rij af te werken.

- **Gastenpagina** `/` — naam invullen, nummer zoeken, aanvragen (alleen of als duet/trio),
  stemmen, eigen aanvraag intrekken
- **Hostpagina** `/host` — afvinken, skippen, verwijderen, gepauzeerde aanvragen herstellen,
  verrassingskeuze trekken
- **QR-pagina** `/qr` — QR-code van de eigen URL, met downloadknop

Stack: Next.js (App Router) + TypeScript + Tailwind, Upstash Redis als datastore, live updates
via polling elke 4 seconden. Draait op Vercel zonder verdere infrastructuur.

---

## Lokaal draaien

```bash
npm install
npm run prepare-catalog        # zet de KaraFun-CSV om naar data/catalog.json
cp .env.example .env.local     # vul UPSTASH_* en HOST_PIN in
npm run dev
```

Open http://localhost:3000.

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
dubbele nummers, duetten, stemlimieten, host-acties, een check-in die verloopt door de klok
terug te zetten, en een verrassingskeuze uit een rij van 30+) en ruimt daarna alles op.
71 checks, geen Upstash-account nodig.

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
6. **Testen** — open de URL op twee telefoons, vraag een nummer aan, stem, en check `/host`.
7. **QR-code** — ga naar `/qr` en download de PNG, of maak er een op
   https://www.qrcode-monkey.com.

> Na stap 3 en 4 nog één keer opnieuw deployen, anders draait de app nog zonder de env vars.

---

## Spelregels

**Sortering** — verrassingskeuze → minst geskipt → meeste stemmen → wie het eerst aanvroeg.
Bij gelijke stand staat degene die het eerst aanvroeg dus bovenaan.

**Duetten** — bij het aanvragen kun je maximaal 2 extra zangers toevoegen (samen dus 3). Die
namen zijn puur weergave: alleen de aanvrager hangt aan het apparaat en kan intrekken of de
check-in bevestigen. In de lijst staat er dan "Kenneth + Lisa + Tom".

**Stemmen** — één stem per telefoon per aanvraag, server-side afgedwongen met een Redis-set.
Stemmen op je eigen aanvraag kan niet, intrekken van een stem ook niet.

**Limieten** — maximaal 2 openstaande aanvragen per telefoon. Hetzelfde nummer kan maar één
keer tegelijk in de rij staan; wie het nogmaals aanvraagt krijgt "staat al in de lijst —
stem erop!".

**Check-in ("ben je er nog?")** — als je aanvraag langer dan 15 minuten in de rij staat én
niet op #1 of #2 staat, verschijnt elk kwartier een modal op je eigen pagina, met trilsignaal,
browsermelding en een knipperende tab-titel. Bevestig je niet binnen 5 minuten, dan wordt je
nummer gepauzeerd: het verdwijnt uit de actieve rij en komt in een grijs blokje met
"Ik ben er weer!" (stemmen blijven staan, de aanvraagtijd gaat opnieuw in). Mis je het een
tweede keer, dan vervalt de aanvraag definitief. Naast de JA-knop zit "Nee, haal ons maar uit
de lijst": daarmee verdwijnt de aanvraag meteen. De host ziet gepauzeerde aanvragen ook en kan
ze terugzetten.

**Meldingen** — na de eerste geslaagde aanvraag legt de app uit waarvoor meldingen dienen en
vraagt pas daarna toestemming; een prompt uit het niets wordt vrijwel altijd weggeklikt. Een
statusregel op de gastenpagina laat zien of ze aan of uit staan. Staan ze aan, dan krijg je
een melding als je nummer op #2 komt, als je aan de beurt bent, en bij elke check-in.

**Verrassingskeuze** — vanaf 30 nummers in de rij kan de host op "🎲 Verrassing" drukken.
Die trekt willekeurig een aanvraag van buiten de top 5 (daar is echt op gestemd) en zet hem op
#1, zonder één stem te verplaatsen: het gekozen nummer krijgt een vlag die in de sortering
vóór alles gaat. Zolang het bovenaan staat ziet iedereen "🎲 verrassingskeuze". Skipt de host
het alsnog, dan vervalt de vlag.

Dit alles wordt server-side berekend bij elke queue-read, dus er is geen cron of achtergrondtaak
nodig.

## Datamodel (Redis)

| Sleutel | Type | Inhoud |
| --- | --- | --- |
| `req:{id}` | hash | `songId`, `titel`, `artiest`, `zangerNaam`, `extraSingers`, `deviceId`, `createdAt`, `status`, `lastConfirmedAt`, `missedCheckins`, `skips`, `verrassingOp` |
| `live` | set | ids van aanvragen die nog leven (`queued` of `paused`) |
| `votes:{id}` | set | deviceIds die op deze aanvraag gestemd hebben |
| `device:{deviceId}:requests` | set | openstaande aanvragen van dit apparaat |
| `request:counter` | string | oplopende teller voor nieuwe ids |

`status` is `queued`, `paused`, `done` of `removed`. Afgeronde en verwijderde aanvragen houden
nog 24 uur een TTL en verdwijnen daarna vanzelf.

`extraSingers` is een JSON-lijst met maximaal 2 namen en `verrassingOp` een epoch-ms of 0.
Aanvragen die zonder die velden zijn weggeschreven blijven werken: ze worden gelezen als een
lege lijst en 0.

`GET /api/queue?deviceId=…` geeft in één response de gesorteerde rij, wie er nu aan de beurt is,
de gepauzeerde aanvragen en de check-in-status voor dat apparaat.

### Let op: het verbruik van de gratis Upstash-tier

De gratis tier geeft 10.000 commando's per dag. Met twintig telefoons die elke 4 seconden
pollen, zou dat binnen een half uur op zijn. Daarom houdt de server de rij-toestand 3 seconden
vast in het geheugen van de serverless-instantie (`SNAPSHOT_TTL_MS` in `lib/queue.ts`): alle
gasten die in dat venster pollen krijgen dezelfde momentopname, en elke wijziging gooit hem
meteen weg zodat je je eigen actie direct terugziet.

Bij een groot feest of een lange avond kan het alsnog krap worden. Knoppen om aan te draaien:

- `POLL_MS` in `lib/constants.ts` — van 4 naar 6 seconden scheelt een derde
- `SNAPSHOT_TTL_MS` in `lib/queue.ts` — hoger betekent minder Redis, iets tragere updates
- Upstash pay-as-you-go kost een paar cent voor een avond

## Prompt voor je QR-poster

Voor een beeldgenerator (of een ontwerper):

> Ontwerp een staande A3-poster voor een karaokefeest. Donkerpaars-naar-zwarte achtergrond met
> neonroze en cyaan accenten, in de sfeer van een jaren-80 synthwave-club. Bovenaan groot en
> vet de tekst "ZING MEE" in een strak schreefloos lettertype. Daaronder kleiner:
> "Scan de code, kies je nummer, stem op de rest." In het midden een groot wit vierkant vlak
> met veel ruimte eromheen waar de QR-code in geplakt kan worden — laat dat vlak leeg. Onderaan
> een subtiele microfoon-illustratie met neonrand. Veel negatieve ruimte, hoog contrast,
> leesbaar vanaf drie meter afstand.

Plak daarna je eigen QR-code (van `/qr` of qrcode-monkey.com) in het witte vlak.
