# Migrasjonsplan: Unity WebGL → Web-native spillmotor

**Dato:** 2026-04-13
**Utarbeidet av:** Tobias Haugen, teknisk leder
**Status:** Utkast til prosjektleder

---

## 1. Sammendrag

Spillorama har i dag 5 bingospill bygget i Unity WebGL. Game 4 (Theme Bingo) utgår og skal ikke migreres. De resterende 4 spillene bruker i hovedsak ikke tunge Unity-spesifikke funksjoner som 3D, partikkelsystemer, skelettanimasjon eller avanserte shadere. Alt er 2D sprite-basert UI med enkel tweening-animasjon, med unntak av begrenset 2D-fysikk i Game 5 (ruletthjul).

**Anbefaling:** Migrer 4 spill (Game 1, 2, 3, 5) til PixiJS + GSAP (TypeScript). Game 4 (Theme Bingo) utgår. Eksisterende backend-kontrakter beholdes uendret.

### Netto gevinster

| Område | Før (Unity) | Etter (Web) |
|--------|------------|-------------|
| Byggestørrelse per spill | 5–15 MB wasm-bundle | 100–500 KB |
| Lastetid (mobil) | 3–10 sekunder | Under 1 sekund |
| Utviklerverktøy | Unity Editor + C# | VS Code + TypeScript, hot reload |
| Iframe-bridge | Komplekst mellomledd (WebHostBridge) | Fjernes helt — spill lever i web-appen |
| Lisenskostnad | Unity-lisens | Ingen (open source) |
| Rekruttering | Krever Unity-kompetanse | Standard webutviklere |

---

## 2. Nåsituasjon

### 2.1 Spilloversikt

| Spill | Type | Rutenett | Linjer kode (C#) | Filer | Særtrekk |
|-------|------|----------|-------------------|-------|----------|
| **Game 1** — Classic Bingo | Multiplayer, sanntid | 5x5 | 3 463 | 23 | 4 mini-spill (lykkehjul, skattekiste, m.fl.) |
| **Game 2** — Rocket Bingo | Multiplayer, sanntid | 3x3 | 2 089 | 9 | Rakettstabling, paginering |
| **Game 3** — Monster Bingo | Multiplayer, sanntid | 5x5 | 2 472 | 12 | Animert kulekø med akselerasjon |
| ~~**Game 4** — Theme Bingo~~ | ~~Enkeltspiller, instant~~ | ~~5x3~~ | ~~2 159~~ | ~~11~~ | ~~Utgår — skal ikke migreres~~ |
| **Game 5** — Spillorama Bingo | Hybrid | 3x3 | 2 198 | 16 | Ruletthjul, free spin jackpot |
| **Totalt (ekskl. Game 4)** | | | **~10 200** | **60** | |

### 2.2 Hva Unity faktisk brukes til

**Brukes:**
- UI Canvas og Layout Groups (rutenett, paneler)
- LeanTween for animasjoner (skala, rotasjon, farge)
- TextMeshPro + I2 Localization
- Sprite-basert grafikk
- BestHTTP Socket.IO-klient

**Brukes også:**
- DOTween (i tillegg til LeanTween) — begge må migreres til GSAP
- `Rigidbody2D` + `Collider2D` i Game 5 (ruletthjul med kollisjonsdeteksjon)
- SoundManager for stemmeopplesning av bingonumre (norsk mann/kvinne, engelsk)
- Firebase Cloud Messaging for push-notifikasjoner
- Vuplex/GPM WebView for visning av webinnhold inne i Unity

**Brukes IKKE:**
- 3D-grafikk, mesh eller kameraer
- Partikkelsystemer
- Skelettanimasjoner eller Mecanim Animator
- Avanserte shadere

### 2.3 Fullstendig kodeomfang

Spillkoden utgjør bare ~24% av Unity-prosjektet. Totalt:

| Lag | LOC | Filer | Migreres? |
|-----|-----|-------|-----------|
| 5 spill | 12 400 | 71 | Ja — dette prosjektet |
| UI-paneler (lobby, login, profil, chat, innstillinger) | 19 800 | 78 | Nei — dekkes allerede av web shell |
| Core (UIManager, SoundManager, etc.) | 3 400 | 12 | Delvis — lyd migreres, resten dekkes av web shell |
| Nettverk (Socket, API-klient) | 3 500 | 7 | Ja — erstattes av fase 0-fundamentet |
| Bridge (GameBridge + WebHostBridge) | 1 400 | 2 | Fjernes helt — ikke lenger nødvendig |
| Utility + Prefabs | 7 600 | 55 | Nei — web-ekvivalenter finnes eller er trivielle |
| WebView (Vuplex, GPM) | ~500 | 3 | Fjernes — behovet forsvinner når alt er web |
| **Totalt Unity-prosjekt** | **~52 000** | **~242** | **~17 300 LOC migreres/erstattes** |

Prosjektet er dermed en migrering av **17 300 LOC** (spill + nettverk), ikke 52 000. Resten dekkes av eksisterende web shell eller forsvinner.

### 2.4 Backend (Express.js + PostgreSQL)

Eksisterende backend for **Game 1, 2, 3 og 5** er frikoblet fra Unity-motoren. Den eksponerer:

- **Socket.IO** med 15+ events (room:join, draw:next, claim:submit, etc.)
- **REST API** for spill, haller, lommebok, compliance, betalinger
- **JWT-autentisering** via socket handshake og HTTP Authorization

Eneste Unity-spor i backend: `pingInterval: 60000` (kommentar om WebGL heartbeat). Ingen client-type-deteksjon, ingen Unity-spesifikke payloads.

**Konklusjon:** Eksisterende backend-kontrakter beholdes uendret for Game 1, 2, 3 og 5.

---

## 3. Anbefalt teknisk stack

| Lag | Teknologi | Erstatter | Begrunnelse |
|-----|-----------|-----------|-------------|
| **Rendering** | PixiJS 8 | Unity Canvas/UI | Lettvekts 2D WebGL-renderer, GPU-akselerert, ~100 KB |
| **Animasjon** | GSAP 3 ¹ | LeanTween | Industristandard web-tweening, nesten 1:1 API-match |
| **Språk** | TypeScript | C# | Typesikkerhet, samme kompetanse som web shell |
| **Socket** | socket.io-client | BestHTTP (C#) | Native JS-bibliotek, null bridge |
| **Lokalisering** | i18next | I2 Localization | Standard web-i18n |
| **Bygg** | Vite | Unity Build Pipeline | Instant hot reload, tree-shaking |
| **Tekst** | PixiJS Text / HTML overlay | TextMeshPro | Nativ font-rendering |
| **Lyd** | Howler.js / Web Audio API | SoundManager + Unity AudioSource | Gjenbruk lydfiler, ~10 KB bibliotek |
| **Fysikk** (kun Game 5) | matter.js | Rigidbody2D + Collider2D | Lettvekts 2D-fysikk, ~15 KB |
| **Push** | Firebase JS SDK + Web Push API | Firebase FCM (Unity plugin) | Service Worker for bakgrunn |

> ¹ **GSAP-lisensiering må avklares i fase 0.** GSAP har en ikke-standard lisens. Gratisversjonen ("no-charge") dekker nettsider og apper som er gratis for sluttbrukere. For kommersielle produkter der brukere betaler — som en bingoplatform — kan det kreves en betalt "Business Green"-lisens. Avklar med GreenSock før kode skrives. Dersom lisensen er problematisk, er MIT-lisensierte alternativer tilgjengelige: **anime.js** eller **Motion One** dekker tweening-behovet, men har svakere easing-bibliotek og mindre community.

### Alternativ vurdert: Phaser 3
Phaser er et fullverdig spillrammeverk med innebygd fysikk, scene-håndtering og tween-system. Det er et godt alternativ dersom teamet foretrekker én pakke fremfor PixiJS + GSAP separat. Begge er viable — PixiJS gir mer fleksibilitet, Phaser gir mer "batteries included".

### 3.1 Målarkitektur og deploymodell

Dette må avklares eksplisitt i fase 0, slik at migreringen ikke stopper opp i repo- og deployspørsmål:

- **Kanonisk entrypoint beholdes som `/web/`** i overgangsperioden. Det reduserer risiko rundt eksisterende launch-lenker, auth-flyt og produksjonsruting.
- **Nye web-spill bygges som en egen TypeScript/Vite-klient i repoet**, men serveres på samme origin som dagens live bingo-app. Anbefalt struktur er et nytt klientområde for spill under `frontend/`, med bygde artefakter publisert til `/web/`.
- **Web shell eier fortsatt auth, wallet, compliance og navigasjon.** Spillene eier kun gameplay, animasjon og spillspesifikk presentasjon.
- **Hvert spill lastes lazy** fra shellet, slik at spilleren ikke laster alle fem spill samtidig.
- **Unity/web-valg styres med feature flag**, ikke med separate URL-er. Det gjør parallell drift og rollback mulig uten ny deploy.
- **CI/CD må utvides**. Dagens repo-scripts bygger i praksis bare backend; web-spillklienten må få egne build-, test- og deploysteg.

**Anbefalt beslutning i fase 0:**
- Hold `/web/` som offentlig kontrakt.
- Bygg én delt web-spillklient med felles runtime, ikke fem isolerte mikroapper.
- Publiser alt fra samme domene for å unngå ekstra CORS-, cookie- og service worker-kompleksitet.

---

## 4. Migrasjonsstrategi

### 4.1 Overordnet tilnærming

**Inkrementell migrering, spill for spill.** Ikke big-bang. Hvert spill migreres, testes og lanseres før neste påbegynnes. Begge versjoner (Unity og web) kan kjøre parallelt i overgangsperioden.

### 4.2 Faser

```
Fase 0: Fundament          ████░░░░░░░░░░░░░░░░░░░░  
Fase 1: Pilot (Game 2)     ░░░░████░░░░░░░░░░░░░░░░  
Fase 2: Game 1             ░░░░░░░░█████░░░░░░░░░░░  
Fase 3: Game 3             ░░░░░░░░░░░░░████░░░░░░░  
Fase 4: Game 5             ░░░░░░░░░░░░░░░░░████░░░  
Fase 5: Opprydding         ░░░░░░░░░░░░░░░░░░░░░██  
```

---

### Fase 0 — Fundament (delt infrastruktur)

**Mål:** Bygg det felles laget som alle spill bruker.

| Komponent | Beskrivelse | Erstatter |
|-----------|-------------|-----------|
| `SpilloramaSocket` | Socket.IO-klient med JWT-auth, reconnect, rate limiting | SpilloramaSocketManager.cs |
| `SpilloramaApi` | REST-klient med fetch(), typed responses | SpilloramaApiClient.cs |
| `GameBridge` | Event-emitter som oversetter snapshots til spilldata | SpilloramaGameBridge.cs |
| Datamodeller | TypeScript interfaces for alle 40+ payloads | EventResponse.cs POCOs |
| `BingoGrid` | Gjenbrukbar rutenett-renderer (3x3, 5x3, 5x5) | Separate per spill i dag |
| `TweenPresets` | GSAP-presets for vanlige animasjoner (blink, pulse, slide) | LeanTween + DOTween-kall spredt i koden |
| `AudioManager` | Howler.js-wrapper for nummeropplesning, lydeffekter, mobile unlock | SoundManager.cs |
| `GameHost` | Shell-komponent som velger Unity eller web per spill via feature flag | Dagens harde kobling mot Unity-host |
| `Telemetry` | Klientfeil, launch-funnel, reconnect-målinger, release tags | Mangler i dag |
| `AssetPipeline` | Eksporter sprites fra Unity, re-pakk som PixiJS spritesheets (TexturePacker e.l.) | Unity Sprite Atlas |
| Prosjektoppsett | Vite + TypeScript + PixiJS + GSAP + Howler.js, CI/CD pipeline | Unity Build Pipeline |

**Asset-pipeline (viktig avklaring):**
Unity sprite atlaser er i et Unity-spesifikt format og kan ikke brukes direkte i PixiJS. Individuelle sprite-bilder (PNG) må eksporteres fra Unity-prosjektet og re-pakkes til PixiJS-kompatible spritesheets. Verktøy som TexturePacker eller free-texture-packer håndterer dette. Prosessen er enkel men må gjøres systematisk — det er ~100+ sprites fordelt på 5 spill. Anbefalt: lag et script som en del av fase 0 som batch-eksporterer alle sprites, slik at det ikke blir manuelt arbeid per spill.

**Portabilitet fra eksisterende kode:**
- Alle 40+ datamodeller er rene serialiserbare klasser — direkte oversettelse til TS interfaces
- Snapshot-oversettelseslogikk (BuildGame1History, etc.) — ren forretningslogikk, portabel
- Validering og hjelpefunksjoner — direkte port

---

### Fase 1 — Pilot: Game 2 (Rocket Bingo)

**Hvorfor Game 2 først:**
- Enklest av alle (9 filer, 2 089 LOC)
- 3x3 rutenett (minimal UI-kompleksitet)
- Ingen mini-spill
- Rakettstablings-animasjon er enkel GSAP-tween
- Dekker hele flyten: lobby → billettvalg → spill → resultat

**Leveranse:**
- Fullt fungerende Rocket Bingo i web
- Validerer hele stacken (PixiJS + GSAP + Socket.IO)
- Ytelsessammenlikning mot Unity-versjonen
- Brukes som referanseimplementasjon for resten

**Portabilitet:**
| Komponent | Portabilitet | Notat |
|-----------|-------------|-------|
| Socket-flow | 90% | Event-navn identiske |
| Billettrendering | 90% | 3x3 grid, enkel |
| Rakettanimasjon | 85% | LeanTween → GSAP 1:1 |
| Paginering | 80% | ScrollView → CSS/PixiJS scroll |

---

### Fase 2 — Game 1 (Classic Bingo)

**Det mest komplekse spillet, men godt forstått.**

| Komponent | Kompleksitet | Strategi |
|-----------|-------------|----------|
| 5x5 rutenett + mønstergjenkjenning | Lav | Ren logikk, direkte port (5 design-typer) |
| Socket-flow (ball draw, patterns, winners) | Lav | Identisk med Game 2, bare flere events |
| Billettsortering ("best card first") | Lav | Array.sort med comparator |
| Lykkehjul (mini-spill) | Medium | Rotasjonsanimasjon → GSAP rotateZ |
| Skattekiste (mini-spill) | Lav | Grid med sprite-swap + klikk |
| Mystery Game / Color Draft | N/A | Ikke implementert — bygg direkte i web |
| Chat-panel | Lav | Standard web UI |

**Kodefordeling:**
- ~305 linjer ren spillogikk (26%) — direkte porterbar
- ~870 linjer Unity UI-wiring (74%) — reskrives, men enklere i web

---

### Fase 3 — Game 3 (Monster Bingo)

**Eneste spill med egen animasjonslogikk (kulebevegelse).**

| Komponent | Kompleksitet | Strategi |
|-----------|-------------|----------|
| BallScript (velocity + akselerasjon) | Lav | `gsap.to()` med custom ease, eller enkel frame-loop |
| BallPathRottate (waypoint-bane) | Medium | Lerp mellom waypoints med speed modifier |
| Kulekø (maks 5, FIFO) | Lav | Array pool med GSAP stagger |
| Mønsteranimasjon (ping-pong) | Lav | `gsap.to({yoyo: true, repeat: -1})` |
| Resten | Lav | Identisk med Game 1 (5x5 grid) |

**Konkret eksempel — kulefysikk:**
```csharp
// Unity (nå): velocity-basert bevegelse per frame
velocity += acc;
position += velocity * Time.deltaTime * direction;
```
```typescript
// Web (ny): GSAP med custom ease, eller Phaser arcade physics
gsap.to(ball, { x: targetX, duration: 1.2, ease: "power2.out" })
```

---

### Fase 4 — Game 5 (Spillorama Bingo)

**Hybrid-arkitektur + ruletthjul.**

| Komponent | Kompleksitet | Strategi |
|-----------|-------------|----------|
| 3x3 rutenett | Lav | Gjenbruk fra Game 2 |
| Ruletthjul (RouletteWheelController) | Medium-Høy | Bruker `Rigidbody2D` + `Collider2D` for kulefysikk. Krever matter.js (~15 KB) eller egenlaget fysikkløsning |
| Free Spin Jackpot | Medium | Lykkehjul-variant, gjenbruk fra Game 1 |
| Billettkustomisering (4 farger) | Lav | CSS/sprite-tinting |
| Hybrid socket-flow | Lav | Kombinasjon av rom-basert + instant |

---

### Fase 5 — Opprydding

- Fjern Unity-prosjektet fra repo
- Fjern `WebHostBridge` iframe-integrasjon fra web shell
- Senk Socket.IO `pingInterval` fra 60s til 25s (Unity-kompatibilitet ikke lenger nødvendig)
- Oppdater CI/CD pipeline
- Arkiver Unity-assets (sprites gjenbrukes i web-versjon)

### 4.3 Rollout og rollback

Parallell drift må være en bevisst release-strategi, ikke bare en teknisk mulighet.

- **Rollout styres per spill** og bør kunne brytes videre ned per hall, intern testgruppe eller liten prosent av brukere.
- **Standardvalg i pilotperioden er Unity**, mens web-versjonen aktiveres eksplisitt via feature flag.
- **Rollback skal være flag-basert**, slik at Game 2 kan settes tilbake til Unity uten kodeendring eller ny deploy dersom produksjonsmålingene avviker.
- **Samme `/web/`-entrypoint beholdes** under pilot, slik at brukerreise, auth og compliance ikke splittes mellom to ulike URLs.
- **Rollout-rekkefølge for pilot:** intern QA → staging-hall → én produksjonshall med lav trafikk → bredere produksjon.
- **Unity holdes i maintenance-only** til Game 5 er ute, for å unngå parallell feature-utvikling i to motorer.

### 4.4 Estimater og exit-kriterier

Estimatene under forutsetter 2 utviklere på migreringen, deltid QA og tilgang på eksisterende design/assets.

| Fase | Estimat | Exit-kriterier | Avhengigheter |
|------|---------|----------------|---------------|
| Fase 0 | 2–3 uker | Felles runtime, feature flags, build pipeline, telemetri og første smoke tester på plass | Avklare målarkitektur for `/web/` |
| Fase 1 — Game 2 | 2–3 uker | Game 2 fungerer i staging og pilot-prod, rollback er testet, målt lastetid og stabilitet er innenfor mål | Fase 0 ferdig |
| Fase 2 — Game 1 | 3–4 uker | 5x5-flow, mini-spill og chat/paritetsvalg avklart | Referanse fra Game 2 |
| Fase 3 — Game 3 | 2–3 uker | Kulekø og animasjonsbane matcher akseptabelt mot Unity | Game 1-grid og mønsterlogikk gjenbrukt |
| Fase 4 — Game 5 | 3–4 uker | Rulettfysikk og jackpotflyt er verifisert på mobil og desktop | Avklaring av fysikkløsning |
| Fase 5 | 1 uke | Unity kan deaktiveres, gamle assets er arkivert, CI/CD og runbooks er oppdatert | Alle spill live i web |

---

## 5. Hva som kan gjenbrukes direkte

### Fra Unity → TypeScript (ren logikk, bare syntax-endring)

| Kode | Linjer | Beskrivelse |
|------|--------|-------------|
| Datamodeller (40+ klasser) | ~800 | Alle payloads er JSON-serialiserbare POCOs |
| Mønstergjenkjenning (5 designs) | ~400 | Nested loops, array-operasjoner |
| Snapshot-oversettelse (BuildGameNHistory) | ~300 | Transformasjonslogikk |
| Billettsortering, countdown, validering | ~200 | Standard algoritmer |
| Socket event-navn og payload-strukturer | — | Identiske — backend endres ikke |
| **Totalt direkte porterbart** | **~1 700** | **~14% av total kodebase** |

### Fra Unity → Web (reskrives, men blir enklere)

| Konsept | Unity | Web | Kommentar |
|---------|-------|-----|-----------|
| Animasjon | LeanTween (C#) | GSAP (TS) | Nesten 1:1 API |
| Layout | RectTransform, Canvas | CSS Flexbox/Grid eller PixiJS Layout | Enklere, mer fleksibelt |
| Nettverk | BestHTTP + Bridge | socket.io-client + fetch | Direkte, ingen mellomledd |
| Tilstand | MonoBehaviour + static | Vanlig TS-klasser eller state manager | Enklere livssyklus |
| Lokalisering | I2 Localization | i18next | Standard web-løsning |
| Persistering | PlayerPrefs | localStorage | 1:1 erstatning |

### 5.1 Paritetsmatrise per spill

Paritet bør defineres eksplisitt per spill, slik at "ferdig" betyr det samme for utvikling, QA og prosjektledelse.

| Spill | Må-ha i første web-release | Kan vente til iterasjon 2 | Web-first / utgår |
|-------|----------------------------|---------------------------|-------------------|
| Game 2 | Lobby, billettvalg, 3x3-grid, draw-flow, rakettanimasjon, resultat/premie | Ekstra animasjonspolish og sekundære UI-effekter | Ingen |
| Game 1 | 5x5-grid, mønstre, vinnere, billettsortering, hovedflyt, nødvendige mini-spill | Chat eller sekundære sosiale funksjoner dersom de ikke er forretningskritiske dag 1 | Mystery Game / Color Draft bygges direkte i web hvis de prioriteres |
| Game 3 | 5x5-grid, draw-flow, kulekø, baneanimasjon, mønsteranimasjon | Ekstra visuell variasjon utover gameplay-paritet | Ingen |
| Game 5 | 3x3-grid, rulett, free spin jackpot, hybrid flow, billettfarger | Forfinet fysikkpolish dersom utfallet allerede er korrekt og lesbart | Ingen |

---

## 6. Risiko og mitigering

| # | Risiko | Sannsynlighet | Konsekvens | Mitigering |
|---|--------|--------------|------------|------------|
| 1 | Visuell forskjell mellom Unity og web-versjon | Høy | Lav | Sprite-assets gjenbrukes. Designgjennomgang per spill |
| 2 | Ytelse på eldre mobiler | Lav | Medium | PixiJS er lettere enn Unity WebGL. Benchmark i fase 1 |
| 3 | Parallellkjøring øker vedlikeholdsbyrde | Medium | Medium | Migrer raskt, hold Unity i maintenance-only |
| 4 | Teamet mangler PixiJS-erfaring | Medium | Medium | Game 2 som pilot gir læring før komplekse spill |
| 5 | Scope-glidning mot backend under migrering | Medium | Medium | Eksisterende kontrakter for Game 1, 2, 3 og 5 fryses. Ingen backend-endringer i scope |
| 6 | Spillvett/compliance-integrasjon | Lav | Høy | Allerede i web shell — spillene arver det automatisk |
| 7 | Tap av eksisterende Unity-kompetanse i teamet | Medium | Lav | Unity fjernes, ikke nødvendig å vedlikeholde |
| 8 | **Ingen eksisterende tester** — migrering uten sikkerhetsnett | Høy | Høy | Skriv tester parallelt med migrering (se § 6.1) |
| 9 | Game 5 rulettfysikk krever fysikkbibliotek | Lav | Medium | matter.js (~15 KB) eller egenlaget enkel kollisjonsløsning |
| 10 | Lydavspilling på mobil krever brukerinteraksjon | Medium | Medium | Web Audio API med user-gesture unlock (se § 6.2) |
| 11 | GSAP-lisens kan kreve betaling for kommersiell bingoplatform | Medium | Medium | Avklar med GreenSock i fase 0. MIT-alternativer finnes (se § 3) |
| 12 | Tilgjengelighet (a11y) — `<canvas>` er iboende vanskelig for skjermlesere | Lav | Ukjent | Avklar regulatoriske krav (se § 6.5) |

### 6.1 Teststrategi

Unity-prosjektet har **null testdekning**. Migreringen er en mulighet til å rette dette opp, men også en risiko — man porterer kode uten å kunne verifisere korrekthet automatisk.

**Anbefalt tilnærming:**
- **Fase 0:** Skriv integrasjonstester for Socket.IO-flow (room:join → draw:next → claim:submit). Disse testene kjører mot backenden og verifiserer at den nye klienten oppfører seg identisk med Unity-klienten.
- **Per spill:** Skriv enhetstester for portert spillogikk (mønstergjenkjenning, billettsortering, countdown). Denne logikken er ren — ingen UI-avhengigheter.
- **E2E:** Vurder Playwright for å verifisere at spill starter, kuler trekkes, og premie utbetales korrekt.

### 6.2 Lyd og stemmeopplesning

Unity-prosjektet har en `SoundManager` som håndterer:
- Stemmeopplesning av bingonumre (norsk mann/kvinne, engelsk)
- Språkvalg og volumkontroll
- Spillspesifikke lydeffekter

**Web-erstatning:**
- Web Audio API / Howler.js (~10 KB) for avspilling
- Samme lydfiler (.mp3/.ogg) kan gjenbrukes direkte
- **Viktig:** Mobile nettlesere krever brukerinteraksjon før lyd kan spilles. Løses med en "unlock"-gesture ved spillstart — standard mønster i web-spill.

### 6.3 Push-notifikasjoner

Unity-prosjektet bruker Firebase Cloud Messaging (FCM) for push-notifikasjoner. Ved migrering:
- **Web Push API** + Firebase JS SDK erstatter Unity FCM-plugin
- Service Worker kreves for bakgrunnsnotifikasjoner
- Brukersamtykke (Notification.requestPermission) må designes inn i UI
- Alternativt: evaluer om push-notifikasjoner er nødvendig i web-versjonen, eller om in-app-varsler er tilstrekkelig

### 6.7 Tilgjengelighet (universell utforming)

PixiJS renderer til `<canvas>`, som er en svart boks for skjermlesere og tastaturnavigasjon. Unity Canvas-basert UI har det samme problemet — så migreringen gjør det verken bedre eller verre.

**Hva bør avklares:**
- Har Lotteritilsynet eller WCAG-forskriften (likestillings- og diskrimineringsloven § 18) spesifikke krav til tilgjengelighet for nettbaserte pengespill?
- Stiller IKT-forskriften (universell utforming av IKT) krav som gjelder spillmotoren, eller bare lobby/registrering/betaling (som allerede er web-basert)?

**Mulige tiltak dersom krav gjelder:**
- Bruk HTML-overlay for kritiske interaksjoner (billettvalg, claim-knapper) med ARIA-attributter, mens PixiJS håndterer visuell presentasjon
- Legg til tastaturnavigasjon for rutenett og knapper
- Sørg for at lyd-annonsering av tall fungerer som alternativ til visuell presentasjon

**Anbefaling:** Avklar regulatoriske krav i fase 0. Ikke bygg a11y-lag før dere vet hva som faktisk kreves — men ikke gjør arkitekturvalg som gjør det umulig å legge til senere.

### 6.4 Spillerdata og sesjonskontinuitet

Unity-prosjektet lagrer brukerpreferanser (markørdesign, språkvalg, lydvolum) i `PlayerPrefs`. Ved migrering:

- **Preferanser:** `PlayerPrefs` har ingen web-ekvivalent. Verdiene må migreres til `localStorage`. Siden Unity WebGL allerede bruker `localStorage` som backend for `PlayerPrefs`, kan eksisterende nøkler leses direkte — men nøkkelnavnene må kartlegges i fase 0.
- **Sesjonskontinuitet:** Når feature-flagget skifter fra Unity til web (eller tilbake), må spillere som er midt i et spill fullføre på gjeldende motor. Flagget bør være **sticky per sesjon** — ikke per request. Spilleren bytter motor først ved neste spillstart.
- **Spilltilstand:** Ingen klientlagret spilltilstand trenger migrering. All spilltilstand (rom, billetter, trekninger) eies av backend og hentes via `room:state`-snapshot ved reconnect.

### 6.5 iOS Safari WebGL-begrensninger

Safari har aggressiv minnehåndtering for WebGL-kontekster. Under minnepress kan Safari terminere WebGL-konteksten (`CONTEXT_LOST_WEBGL`), noe som gjør at PixiJS-canvas blir svart.

**Mitigering:**
- PixiJS 8 har innebygd context-loss-håndtering — canvas gjenopprettes automatisk ved `CONTEXT_RESTORED_WEBGL`
- Spilltilstand hentes fra backend-snapshot (`room:state`) etter recovery, slik at ingen data går tapt
- Begrens antall samtidige teksturer per spill — bingo-UI-et er sprite-lett sammenlignet med typiske mobilspill
- Test på eldre iPhones (iPhone SE / iPhone 8) i fase 1 for å etablere minnebunnlinje
- Vurder å bruke PixiJS' `Canvas`-fallback for enheter som ikke støtter WebGL stabilt (sjeldent, men mulig)

**Kontekst:** Unity WebGL har det *samme* problemet, men med høyere minneforbruk (wasm-heap). Web-migrering reduserer sannsynligheten for context loss, men fjerner den ikke.

### 6.6 Observability og drift

Pilotfasen bør ha tydelig observability fra dag 1. Ellers blir "evaluer piloten" et magefølelse-spørsmål.

- **Klientfeil:** Sentry eller tilsvarende med `gameId`, release-versjon og hall-id i context.
- **Launch-funnel:** mål antall som går fra lobby → spill-lastet → room join/play submit → ferdig spill.
- **Socket-stabilitet:** reconnect-rate, reconnect-varighet, antall disconnects per spilløkt.
- **Kritiske forretningshendelser:** claim submit, premievisning og saldooppdatering logges med korrelasjons-id.
- **Pilot-dashboard:** ett samlet dashboard for Game 2 med feilrate, lastetid, FPS/lag-indikator og suksessrate i launch-flow.
- **Operativ beredskap:** definer hvem som eier rollback-beslutning og hvilke terskler som utløser fallback til Unity.

---

## 7. Hva som IKKE endres

For å være tydelig overfor prosjektleder — følgende berøres **ikke**:

- **Eksisterende backend-kontrakter** — Game 1, 2, 3 og 5 beholder samme API
- **Database** — PostgreSQL-skjema uendret
- **Spillregler** — RNG, mønstervalidering, premieberegning er server-side
- **Compliance** — Spillvett (tapslimiter, selvutelukkelse, pause) er allerede i web shell
- **Betalinger** — Swedbank-integrasjon er REST, uavhengig av spillmotor
- **Autentisering** — JWT + BankID-flyt er i web shell
- **Hallstruktur** — Organisering, spilleplaner, § 64-compliance er backend

---

## 8. Suksesskriterier

| Kriterie | Måles ved |
|----------|-----------|
| Funksjonell paritet | Alle prioriterte spillfunksjoner for Game 1, 2, 3 og 5 finnes i web-versjon |
| Lastetid < 2 sekunder | Lighthouse-måling på mobil (4G) |
| Byggestørrelse < 500 KB per spill | Bundle-analyse |
| Ingen iframe-bridge | Spill integrert direkte i web shell |
| Backend-kontrakter uendret | Ingen endringer for Game 1, 2, 3 og 5 |
| Alle compliance-krav opprettholdt | Spillvett-tester passerer |
| Pilotspill (Game 2) i produksjon | Før resten påbegynnes |
| Testdekning for spillogikk | Enhetstester for mønstergjenkjenning, sortering, countdown |
| Socket-integrasjonstester | Automatisert test av room:join → draw → claim-flow |
| Lyd fungerer på mobil | Stemmeopplesning verifisert på iOS Safari og Android Chrome |

### 8.1 Release-gate før produksjon

Før et spill går fra pilot til bred produksjon skal følgende være verifisert:

- **Nettlesere:** siste to hovedversjoner av iOS Safari, Android Chrome og desktop Chrome/Edge. Safari på desktop verifiseres for lyd og rendering.
- **Enheter:** minst én eldre mellomklasse-mobil, én nyere iPhone, én nyere Android og desktop.
- **Compliance-interrupts:** tapsgrenser, pause, selvutelukkelse og saldooppdatering må fortsatt bryte inn korrekt fra shellet.
- **Fallback:** feature-flag rollback er testet i staging og dokumentert i runbook.
- **Observability:** dashboard, feilsporing og alarmer er på plass før bred rollout.

---

## 9. Anbefalt beslutning

Unity gir verdi for 3D-spill, tung fysikk og avanserte animasjoner. Spillorama bruker i hovedsak ingen av disse, utover begrenset 2D-fysikk i ett rulettspill. Vi betaler overhead i byggestørrelse, lastetid, utviklerkompleksitet og lisenskostnader for funksjoner vi nesten ikke bruker.

Web-migrering fjerner dette gapet og gir oss:
- Raskere utvikling (hot reload, TypeScript, standard verktøy)
- Bedre brukeropplevelse (raskere lasting, ingen iframe-bridge)
- Lavere driftskostnad (ingen Unity-lisens, enklere CI/CD)
- Enklere rekruttering (webutviklere vs. Unity-utviklere)
- Sømløs integrasjon med eksisterende web shell, Spillvett og hallsystem

**Anbefaling:** Godkjenn oppstart av Fase 0 + Fase 1 (pilot med Game 2). Evaluer resultatet før fullskala migrering.
