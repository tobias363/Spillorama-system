# Live Casino Room Architecture — Industry Research

_Dato: 2026-04-27_
_Forfatter: Agent CASINO-RESEARCH_
_Formål: Sammenligne Spillorama (live bingo, multi-hall) sin rom-modell med live-casino-industriens etablerte mønstre — primært Evolution Gaming, Pragmatic Play Live og Playtech Live._

---

## Executive Summary

**De ledende live-casino-leverandørene (Evolution ~70 % markedsandel, Pragmatic Play, Playtech) bruker en hybrid-modell der ÉN fysisk dealer/bord streamer til UBEGRENSET antall spillere på tvers av MANGE operatører samtidig.** Den fysiske kapasitets-begrensningen som finnes ved et fysisk bord (typisk 7 seter i blackjack) er løst arkitektonisk via tre mekanismer: (1) "Bet Behind" (flere spillere veter på samme hånd som en seated player), (2) "Infinite/Scalable" varianter (Evolution Infinite Blackjack — alle spillere får samme initial-2-kort, deretter individuelle valg), og (3) game shows (Crazy Time, Monopoly Live) som er designet bottom-up for ubegrenset publikum (40 000+ samtidige spillere på Crazy Time peak). Spiller-account, wallet, betting og payout administreres per-operatør gjennom backend-integrasjon, mens video-stream og game-state er felles.

**Operator-skille er IKKE per rom — det er per LAYER.** Stream + dealer + spill-utfall er felles infrastruktur. Wallet + RBAC + compliance-rapportering er per-operatør. Dette er motsatt av hva Spillorama-Spill-1-modellen gjør (canonical-room PER hall). Casino-leverandører tilbyr en "dedikert rom"-tier (mot fast månedsavgift) der en enkelt operatør får eksklusiv tilgang til et bord — men dette er en branding/VIP-funksjon, ikke en arkitektonisk default.

**For bingo spesifikt: Playtech Bingo (Virtue Fusion-nettverket) støtter 100+ operatør-skin og opptil 15 000 samtidige spillere på én delt rom-pool.** Dette er den nærmeste industri-parallellen til Spillorama-Spill-2/3-modellen — og validerer at "ÉN GLOBAL ROM på tvers av operatører" er industri-standard for bingo.

---

## 1. Provider Comparison

### 1.1 Evolution Gaming (markedsleder, ~70 % live casino-markedsandel)

**Rom-modell:** Hybrid med tre tiers:
1. **Generic tables (felles)** — basis-tilgang. Stream + dealer deles på tvers av operatører. Operatør betaler kommisjon på inntekter generert.
2. **Dedicated tables** — eksklusivt for én operatør, fast månedsavgift. Branded studio, native-language dealere, custom uniformer. Eksempel: ComeOn Group fikk dedikert miljø rullet ut for alle deres brands i 2022.
3. **VIP / native-language tables** — variant av dedicated.

**Capacity-modell:**
- **Tradisjonelt Live Blackjack:** 7 seter (fysisk bord-begrensning).
- **Live Infinite Blackjack:** ubegrenset spillere via "shared initial hand"-mekanikken — alle får samme to start-kort, deretter individuelle hit/stand-valg. Streames fra Riga.
- **Bet Behind:** flere spillere veter på samme hånd som seated player (i tradisjonelle 7-seter-bord). "Limitless number of people take a bet behind".
- **Live Roulette:** ubegrenset spillere på samme hjul (alle veter mot samme spin).
- **Game Shows (Crazy Time, Monopoly Live, Lightning Roulette):** designet for ubegrensede publikum. Crazy Time har bekreftet 40 000+ samtidige spillere på peak.

**Operatør/hall-skille:**
- Backend-API skiller wallet, account, RBAC og compliance per operatør.
- Stream + game-utfall er delt.
- Operatør får sin egen white-label-skin på top av delt infrastruktur.

**Streaming + state-sync:**
- 99,98 % uptime SLA.
- Studio cameras → encoder farms → multi-CDN-distribusjon → operator API/webhooks.
- OCR (Optical Character Recognition) konverterer fysiske kort/hjul-tall til digitale events i sann tid.
- Sub-250ms latens (industri-best practice for å holde betting-vindu synket med dealer).

**Failover:**
- Crazy Time fikk en **andre identisk studio** (samme regler, sannsynligheter, gameplay) for å håndtere peak-belastning. Dette fungerer som de facto failover/scaling-strategi.
- Korte disconnects: auto-reconnect.
- Lange disconnects: bets enten "stand" eller refunderes per operatør-policy.

**Studio-nettverk (regional):**
- Riga (hoved-studio, primært engelsk)
- Malta (native-language tables)
- Bucharest (regulert under Romania iGaming, 2016)
- Tbilisi (2018, "service hub for multiple licenses and markets")
- Pluss flere i Latvia, USA, etc. — totalt 700+ live tables/game show environments i 15 språk

**Compliance/audit:**
- ISO 27001:2013 sertifisert (først i bransjen til 2013-versjonen).
- Audit-strukturen omfatter "hvordan live game logic kontrolleres, hvordan payout-logikk endres, hvordan player funds er segregert fra operational cash".
- GLI WLA-SCS-sertifisering for europeiske og afrikanske jurisdiksjoner.

**Kilder:**
- [Dedicated Live Casino Tables — Evolution Gaming](https://www.evolution.com/games/dedicated-tables-environments/)
- [Business Model — Evolution AB Investors](https://www.evolution.com/investors/company-overview/business-model/)
- [Infinite Blackjack — Evolution Games](https://games.evolution.com/live-casino/live-blackjack/infinite-blackjack/)
- [Evolution launches Infinite Blackjack — press release](https://www.evolution.com/news/evolution-launches-infinite-blackjack-unlimited-seats-players/)
- [Evolution rolls out dedicated environment for ComeOn — Yogonet](https://www.yogonet.com/international/news/2022/02/03/61237-evolution-rolls-out-dedicated-online-live-casino-environment-for-all-comeon-group-brands)
- [ISO 27001 first achievement — Evolution](https://www.evolutiongaming.com/news/evolution-gaming-first-achieve-latest-iso-27001-global-standard/)
- [Tbilisi studio launch — World Casino Directory](https://news.worldcasinodirectory.com/evolution-gamings-new-tbilisi-studio-goes-live-54417)

---

### 1.2 Pragmatic Play Live

**Rom-modell:** Identisk hybrid-tiering som Evolution:
- **Generic tables:** ~100 classic 7-seter-blackjack-bord (grønne + Azure-blå), pluss Ruby + Emerald VIP-bord.
- **Dedicated tables:** branded miljø per operatør (eks. Madison Casino Belgium fikk 4 dedikerte bord, 888 Casino fikk dedikert blackjack-studio).
- **Fully dedicated environment:** komplett white-label.

**Capacity-modell:**
- 43-bord-kapasitet i hoved-studio i Bucharest (ved åpning; senere doblet).
- Bet Behind Pro Blackjack — egen Pragmatic-variant med utvidet bet-behind.
- Auto Roulette Smart Studio (server-trukket roulette) — ubegrenset spillere.

**Operatør/hall-skille:** Samme modell som Evolution — backend per-operator wallet, stream/dealer delt på generic tier.

**Studio:** Bucharest (Romania), state-of-the-art.

**Kilder:**
- [Pragmatic Play Live Casino](https://www.pragmaticplay.com/en/live-casino/)
- [Madison Casino Belgium-utvidelse — iGaming Future](https://igamingfuture.com/madison-casino-adds-pragmatic-play-live-tables-in-belgium/)
- [Pragmatic Play Live Blackjack — Live Dealer review](https://www.livedealer.org/live-casino-games/live-blackjack/pragmatic-play-live-blackjack/)

---

### 1.3 Playtech Live + Playtech Bingo (Virtue Fusion)

**Live Casino:**
- Studios i Latvia (flagship), Romania (2017, doblet 2020), Spania, Peru, Brazil, USA.
- Native dealere på rumensk, engelsk, spansk, italiensk, gresk.
- ONE Omni-channel-arkitektur: én wallet og én konto per spiller på tvers av kanaler.
- Driften av Playtech IMS (Information Management System).
- Dedicated studios per operatør tilgjengelig (eks. "Club Aurora" for Evoke = 888 + William Hill + Mr Green).

**Playtech Bingo (Virtue Fusion):**
- **15 000 samtidige spillere på delt nettverk.**
- **100+ operatør-skin** (Mecca, Gala, Paddy Power, Buzz Bingo).
- Shared player pool — gir progressive jackpotter på tvers av operatører mens hver beholder distinkt branding.
- Operatører har full autonomi over promo-strategier og kunde-akkvisisjon.
- Format: 75-ball + 90-ball, pluss branded titler (Deal or No Deal Bingo, Age of the Gods Bingo).
- HTML5-basert (eliminert Flash-avhengighet).

**Dette er den nærmeste parallellen til Spillorama Spill 2/3-modellen.**

**Kilder:**
- [Riga Studio — Playtech](https://www.playtech.com/products/live-casino/riga-studio)
- [Playtech opens Romania studio](https://www.playtech.com/news/playtech-opens-live-casino-romania-studio)
- [Virtue Fusion Bingo Network](https://diamondbingo.co.uk/virtue-fusion-bingo-network)
- [Playtech Bingo Full Review (Virtue Fusion)](https://latestbingobonuses.com/software/playtech-bingo)
- [Playtech Bingo product page](https://www.playtech.com/products/bingo/)

---

### 1.4 Andre leverandører (kort)

| Leverandør | Modell | Notater |
|---|---|---|
| **NetEnt Live** | Eid av Evolution siden 2020 — nå migrert inn i Evolution-stack. | Var tidligere selvstendig multi-tenant. |
| **Ezugi** | Eid av Evolution siden 2018. | Asia/LatAm-fokus. Multi-tenant generic tables. |
| **Authentic Gaming** | Live broadcasts FRA fysiske casinoer (Hilton Aruba, Foxwoods etc.). | Hybrid retail+online — kun ett studio per fysisk casino. |
| **Atmosfera** | LatAm-fokus. Multi-tenant generic tables. | Mindre kjent i EU. |
| **Vivo Gaming** | Multi-tenant. Filippinene + Bulgaria-studios. | Tier-2-leverandør. |

---

## 2. Common Patterns

### 2.1 Pattern A — "Generic shared table" (industri-default)

**Brukt av:** Alle store live-casino-leverandører på basis-tier.

**Modell:**
- ÉN dealer + ÉN fysisk eller virtuell bord-instans.
- Stream-en blir distribuert via CDN til alle integrerte operatører.
- Operatør-merkelapp legges på i frontend-laget per skin.
- Backend-API per-operatør: `placeBet`, `getBalance`, `creditWin`, `getHistory`.
- Compliance + KYC + responsible gaming håndteres per operatør i deres eget miljø.

**Pros:**
- Maks effektiv kostnad per spiller (én dealer betjener tusenvis).
- Konsistent spillopplevelse.
- Skalerer direkte til nye operatører uten ny studio-kapasitet.

**Cons:**
- Ingen branding-differensiering på generic-tier.
- Operatør har ingen kontroll over schedule/regler.
- Native-language må være pre-allokert per bord.

### 2.2 Pattern B — "Dedicated table" (premium-tier)

**Brukt av:** Evolution, Pragmatic Play, Playtech (alle store).

**Modell:**
- ÉN dealer + ÉN fysisk bord eksklusivt for én operatør.
- Operatør betaler fast månedsavgift (commission på winnings + dedicated table fee).
- Branded uniform, logo, native-language dealere, custom regler/limits mulig.

**Pros:**
- Sterk branding.
- Operatør kan kjøre egne promoer "fra dealer" (live cross-sell).

**Cons:**
- Dyrt — kun lønnsomt for store operatører.
- Underutnyttelse hvis operatørs trafikk er for lav.

### 2.3 Pattern C — "Game show" / "Massively scalable wheel"

**Brukt av:** Evolution (Crazy Time, Monopoly Live, Lightning Roulette, Dream Catcher), Pragmatic Play (Mega Wheel, Sweet Bonanza CandyLand).

**Modell:**
- Stort prod-studio med showvert + hjul/spinner/kort-mekanisme.
- Server-side trekk-RNG eller fysisk hjul (avhengig av spill).
- Designet bottom-up for tusenvis–titusenvis samtidige spillere.
- Ingen fysisk seat-begrensning — alle spillere veter på SAMME utfall.
- Crazy Time: 40 000+ peak.

**Når kapasiteten nås:** En andre identisk studio åpnes med samme regler/sannsynligheter (Evolution gjorde dette med Crazy Time). Spillere routes transparent til ledig instans.

**Dette er konseptuelt nærmest Spillorama-bingo-modellen** — felles trekk, ubegrensede spillere, kanal-uavhengig.

### 2.4 Pattern D — "Bet Behind" / "Shared hand"

**Brukt av:** Evolution Live Blackjack (klassisk 7-seter), Pragmatic Play Bet Behind Pro.

**Modell:**
- Tradisjonelt bord med 7 seter.
- Når alle seter er fylt: ekstra spillere kan plassere "Bet Behind" på en seated players hånd. "Limitless number of people" kan bet behind.
- Felles utfall, ingen kontroll over hit/stand-valg for tail-betters.

**Dette løser "bord fullt"-problemet** uten å bygge nytt fysisk bord.

### 2.5 Pattern E — "Regional / language hubs"

**Brukt av:** Evolution (Riga = engelsk + Malta = native-language + Tbilisi/Bucharest/USA = regional), Playtech (samme mønster).

**Modell:**
- Hovedhub for "neutral" (engelsk) trafikk på generic tables.
- Regional studios for native-språk (rumensk, italiensk, spansk, gresk, etc.).
- Operatører i en region får lavere latens via regional CDN-edge + studio i samme tidssone.

**Dette ER hall-segmentering på leverandør-nivå** — men begrunnelsen er språk + tidssone + jurisdiksjon, ikke "denne hallen tilhører kun operatør X".

---

## 3. Sammenligning med Spillorama-modellen

### 3.1 Spill 1 (per-hall canonical room) — er dette industri-standard?

**Kort svar: Nei, ikke for online live-casino. Ja, for fysisk bingo-hall.**

Casino-leverandører bygger IKKE separat rom per operatør som default. De bygger ÉN delt rom og lar operatør-laget håndtere branding/wallet/compliance.

**MEN:** Spillorama-Spill-1 har en spesiell forutsetning casino-leverandører ikke har — **fysiske haller med papir-tickets, agent-kassa, lokale spillere som er fysisk til stede**. Dette er hybrid retail + online, ikke ren online.

For hybrid retail er parallellen heller **Authentic Gaming** (live stream FRA Hilton Aruba etc.). Hver fysisk casino har sin egen studio fordi det er fysisk på det stedet. Authentic gjør IKKE en delt online-rom på tvers av flere fysiske casinoer.

**Konklusjon:** Spill 1 per-hall canonical room er **riktig arkitektur** for hybrid retail-bingo der hver hall har egne fysiske spillere som må synkroniseres med online-spillere på samme draw. Casino-industriens generic-tier-modell er IKKE applikabel her fordi den forutsetter ren online-context.

### 3.2 Spill 2/3 (shared global room) — er dette industri-standard?

**Kort svar: Ja, dette er industri-standard for online bingo.**

Playtech Virtue Fusion driver eksakt denne modellen: **100+ operatører deler én rom-pool, opptil 15 000 samtidige spillere**. Operatør har sin egen branding, men spiller-poolen og draws er felles.

Evolution game shows (Crazy Time, Monopoly Live) gjør tilsvarende for casino: ÉN delt mega-rom, alle operatører får samme stream + utfall, branding skjer i frontend.

**Konklusjon:** Spillorama Spill 2/3-modellen ER industri-standard og **bør beholdes**. Det er bingo-kjernens natur — alle spiller på samme draw, så det gir ingen mening å lage parallelle rom per hall.

### 3.3 Hva mangler i Spillorama vs industri?

| Mønster | Industri-praksis | Spillorama-status | Anbefaling |
|---|---|---|---|
| **Operatør/hall-skille på LAYER, ikke ROM** | Stream + draw delt; wallet + RBAC + compliance per-operatør | Spill 1: per-hall room (OK pga retail-kontekst). Spill 2/3: delt rom + per-hall compliance — matcher industri ✓ | Behold |
| **Failover via parallell-studio** | Crazy Time → andre identisk studio ved peak | Ikke implementert. Multi-hall-Spill-1 har "transferHallAccess"-handshake, men ingen parallell-rom-strategi for Spill 2/3 | Vurder for når Spill 2/3 går prod og treffer kapasitets-tak |
| **Bet Behind / Infinite-modus** | Ubegrensede spillere via shared-state-mekanikk | Ikke relevant for bingo (alle spiller allerede på samme draw — ingen seat-begrensning eksisterer) | N/A |
| **Regional language-hub** | Riga eng + Malta native + Tbilisi regional | Spillorama har kun NO/EN. Hver hall driftes av lokal agent. Naturlig regional binding via fysisk hall. | N/A i pilot. Vurder hvis ekspansjon til SE/DK |
| **ISO 27001 + GLI** | Evolution ISO 27001:2013 + GLI WLA-SCS | Pengespillforskriften krever ikke ekstern RNG-cert (per memory). Spillorama compliance er pengespillforskriften §66/§71 + intern audit. | Holder for pilot. Vurder ISO 27001 hvis ekspansjon til EU-marked |
| **Bord fullt → spillback til erstatningsrom** | Crazy Time: parallell-instans, transparent routing | Spill 2/3: ingen capacity-cap definert i kode. Server-belastning uavklart for >100k samtidige | Definer capacity-budsjett før kommersiell launch |
| **Sub-250ms stream-latens** | Industri-best practice | Spillorama Socket.IO + Norge → Frankfurt-region. Faktisk RTT ikke målt i pilot. | Mål under last-test. Optimer hvis >300ms |

### 3.4 VIP / high-limit-rom — relevant for Spillorama?

Casino-industrien skiller VIP via egne bord (Ruby/Emerald-blackjack hos Pragmatic, Salon Privé hos Evolution). Hver VIP-bord er per definisjon `dedicated`-tier.

For bingo har Playtech Virtue Fusion `high-stakes rooms` separert fra normale rom — men dette er fortsatt delt på tvers av operatører.

**Spillorama-relevans:** Lavt prioritert. Pengespillforskriften har felles §71-cap (2 500 kr enkeltpremie), så det er ikke høyt premie-tak å skape "high-limit"-rom rundt. Hold lik premie-struktur.

---

## 4. Compliance + Audit

### 4.1 Hva store leverandører gjør for regulatorisk-compliance

**Evolution-modellen:**
- ISO 27001:2013-sertifisert. Audit-fokus: "live game logic kontroll, payout-logikk-endringer, player funds-segregering fra operational cash".
- GLI WLA-SCS-sertifisering for hver jurisdiksjon (EU, Africa).
- Per-operatør audit-trail: hver bet, win, refund logges med operator-ID + spiller-ID + timestamp.
- 99,98 % uptime SLA — betyr at audit-logging må overleve restart/failover uten å miste events.

**Playtech Virtue Fusion-modellen:**
- IMS (Information Management System) sentraliserer alle bets/winnings/wagering på tvers av 100+ operatør-skin.
- Hver operatør får sin egen audit-eksport for sin lokale regulator (UKGC, MGA etc.).
- Shared draws → alle operatører ser samme draw-utfall i sin audit, men kun sine egne bets/winnings.

**MGA + UKGC krav (relevant for Spillorama hvis EU-ekspansjon):**
- Annual audited accounts 6 måneder etter year-end.
- AML/CFT iht FIAU.
- System audit som verifiserer at faktisk implementert system matcher specs sendt til regulator.

### 4.2 Hva Spillorama gjør / må gjøre

**Allerede på plass:**
- Per-hall ComplianceLedger (memory: "Spill 1-3: 15 % organisasjon, SpinnGo: 30 %").
- §66 obligatorisk pause etter 60 min spilling.
- §71 enkeltpremie-cap 2 500 kr.
- Kompalanse-fail-closed (compliance-tjeneste nede → spill blokkert).

**Gap vs industri-praksis (per R3 audit i [MASTER_PLAN_SPILL1_PILOT_2026-04-24.md](./MASTER_PLAN_SPILL1_PILOT_2026-04-24.md)):**
- Compliance multi-hall-bug: Game1TicketPurchaseService binder til master-hall i stedet for kjøpe-hall. Må fikses før pilot.
- Settlement-maskin-breakdown: Legacy hadde 93 linjer, ny stack har 8. Må utvides til full paritet for regnskap.

**Anbefalt ekstra (ikke pilot-blokker):**
- ISO 27001-modnings-prosess hvis EU-ekspansjon. Audit-strukturen Evolution dokumenterer (game logic kontroll, payout-endringer, fund-segregering) er en god mal.
- Tracksino-analogi: industrien har 3rd-party trackers (tracksino.com) som registrerer alle Crazy Time/Monopoly Live-utfall offentlig. Vurder offentlig draw-historikk for trans-hall-spill.

---

## 5. Topp-3 anbefalinger for Spillorama

### Anbefaling 1: Behold Spill 1 per-hall canonical room. Behold Spill 2/3 shared global room.

Begge mønstrene matcher industri-praksis for sine respektive use-cases:
- Spill 1 (hybrid retail+online): Authentic Gaming-pattern (én studio per fysisk lokasjon). Per-hall er korrekt.
- Spill 2/3 (ren online bingo): Playtech Virtue Fusion-pattern (én delt rom-pool på tvers av operatører/haller). Shared global er korrekt.

**Ikke fall for fristelsen** å re-arkitektere Spill 2/3 til per-hall pga "konsistens med Spill 1". Det ville være å gå MOT industri-standard.

### Anbefaling 2: Definer capacity-budsjett og parallell-instans-strategi for Spill 2/3 før kommersiell launch.

Crazy Time-presedensen er klar: Evolution måtte åpne en andre identisk studio ved 40 000+ peak. Spillorama Spill 2/3 har **ingen definert capacity-cap** og ingen parallell-instans-plan.

**Konkret action:**
- Last-test Socket.IO-rom med 1 000 / 5 000 / 10 000 simulerte spillere.
- Definer cap per rom (forslag: 5 000 — Playtech kjører 15 000 på rom-POOL, ikke ett enkelt rom).
- Implementer "spawn parallell-rom"-logikk når cap nås. Begge rom kjører samme draw-RNG-seed eller separate seeds (pengespillforskriften må sjekkes — sannsynligvis OK med separate så lenge utbetalings-prosent og premie-cap er like).

### Anbefaling 3: Implementer per-bet operator/hall-tagging på audit-laget — IKKE per-rom-segregering.

Industri-praksis (Evolution + Playtech) er klar: rom delt, audit per-operatør. Compliance multi-hall-bug-fixen (R3) bør binde hver bet til **kjøpe-hallen** (ikke master-hallen) på audit-laget, men beholde delt rom-state.

**Dette er allerede planlagt** i K1-bølgen (MASTER_PLAN_SPILL1_PILOT). Bekreftelsen fra industri-research: dette er riktig retning. Ikke drift mot å lage per-hall draw-engine.

---

## 6. Bonus: Hvorfor Norge er spesielt

Norge har unik regulatorisk struktur — Lotteritilsynet tillater kun Norsk Tipping og Norsk Rikstoto som kommersielle pengespill-operatører. Evolution Gaming + Playtech opererer **ikke** lovlig i Norge (deres lisensierte operatører kan ikke selge til norske spillere uten Norsk Tipping-paraply).

**Konsekvens:** Spillorama opererer i et nesten konkurranse-fritt domene under bingo-stiftelse-paraplyen (pengespillforskriften kap. 7). Det betyr:
- Mindre press på "vi må matche Evolutions spiller-opplevelse 1:1".
- Mer rom for å bygge norsk-spesifikke features (f.eks. hall-fysisk-binding, papir-billett-paritet).
- MEN: hvis Spillorama skal ekspandere til Sverige (Spelinspektionen), Danmark (Spillemyndigheden) eller bredere EU, må arkitekturen tåle å konkurrere med Playtech Bingo direkte. Da blir industri-paritet kritisk.

---

## 7. Kilder (komplett liste)

### Evolution Gaming
- [Dedicated Live Casino Tables](https://www.evolution.com/games/dedicated-tables-environments/)
- [Business Model — Investors](https://www.evolution.com/investors/company-overview/business-model/)
- [Infinite Blackjack — game page](https://games.evolution.com/live-casino/live-blackjack/infinite-blackjack/)
- [Infinite Blackjack launch — press release](https://www.evolution.com/news/evolution-launches-infinite-blackjack-unlimited-seats-players/)
- [Live Blackjack overview](https://www.evolution.com/games/live-blackjack/)
- [Crazy Time — game page](https://games.evolution.com/live-casino/game-shows/crazy-time/)
- [Game Shows overview](https://www.evolution.com/games/game-shows/)
- [Compliance & Markets](https://www.evolution.com/who-we-are/compliance-markets/)
- [ISO 27001 first achievement (2013)](https://www.evolutiongaming.com/news/evolution-gaming-first-achieve-latest-iso-27001-global-standard/)
- [Tbilisi studio launch (2018) — World Casino Directory](https://news.worldcasinodirectory.com/evolution-gamings-new-tbilisi-studio-goes-live-54417)
- [ComeOn Group dedicated environment — Yogonet](https://www.yogonet.com/international/news/2022/02/03/61237-evolution-rolls-out-dedicated-online-live-casino-environment-for-all-comeon-group-brands)
- [Evolution Gaming Wikipedia](https://en.wikipedia.org/wiki/Evolution_AB)
- [Live Casino Comparer review (Riga inside)](https://www.livecasinocomparer.com/inside-live-casino/evolution-gaming-review/)

### Pragmatic Play Live
- [Pragmatic Play Live Casino](https://www.pragmaticplay.com/en/live-casino/)
- [Live Blackjack at Pragmatic — Live Dealer.org](https://www.livedealer.org/live-casino-games/live-blackjack/pragmatic-play-live-blackjack/)
- [Madison Casino Belgium dedicated tables](https://igamingfuture.com/madison-casino-adds-pragmatic-play-live-tables-in-belgium/)
- [Pragmatic Play Bet Behind Pro Blackjack](https://www.livecasinocomparer.com/live-casino-software/pragmatic-play-live-casino/bet-behind-pro-blackjack/)
- [Live Casino Comparer Pragmatic review](https://www.livecasinocomparer.com/live-casino-software/pragmatic-play-live-casino/)

### Playtech (Live + Bingo / Virtue Fusion)
- [Playtech Live overview](https://www.playtech.com/products/live/)
- [Playtech Bingo product](https://www.playtech.com/products/bingo/)
- [Playtech Riga Studio](https://www.playtech.com/products/live-casino/riga-studio)
- [Playtech opens Romania studio (2017)](https://www.playtech.com/news/playtech-opens-live-casino-romania-studio)
- [Playtech doubles Romania capacity](https://www.playtech.com/news/playtech-doubles-dedicated-live-casino-space-romania)
- [Playtech rolls out third studio for Evoke (Club Aurora)](https://www.gamingintelligence.com/sectors/online-gaming/212711-playtech-rolls-out-third-live-casino-studio-for-evoke/)
- [Virtue Fusion Bingo Network — Diamond Bingo](https://diamondbingo.co.uk/virtue-fusion-bingo-network)
- [Playtech Bingo full review (Virtue Fusion)](https://latestbingobonuses.com/software/playtech-bingo)

### Compliance / regulatorisk
- [Malta Gaming Authority](https://www.mga.org.mt/)
- [MGA Compliance Reporting Obligations — EM Group](https://the-emgroup.com/mga-compliance-key-reporting-obligations/)
- [GLI Information System Security Audits](https://gaminglabs.com/services/igaming/security-auditing-vulnerability-analysis/)
- [GLI WLA-SCS expansion to Europe + Africa](https://gaminglabs.com/press-releases/gaming-laboratories-international-gli-expands-its-wla-scs-iso-27001-certification-audit-services-to-europe-and-africa/)
- [ISO 27001 for gaming — ISMS.online](https://www.isms.online/sectors/iso-27001-for-the-gaming-industry/)
- [Norwegian Gaming Authority (Lotteritilsynet)](https://www.gamingregulation.com/agency/norway/norwegian-gaming-authority-lotteritilsynet/)
- [Gambling in Norway — Wikipedia](https://en.m.wikipedia.org/wiki/Gambling_in_Norway)

### Streaming + tech
- [Red5 video streaming for casino/iGaming](https://www.red5.net/solutions/video-streaming-for-casino-igaming/)
- [Tecpinion live casino solutions B2B](https://www.tecpinion.com/live-casino-solutions/)
- [SDLC Corp — How Live Dealer Casinos Work](https://sdlccorp.com/post/how-live-dealer-casino-games-work/)
- [Tracksino Crazy Time + Monopoly Live tracker](https://tracksino.com/monopoly)

### Sammenligning og analyser
- [Live Dealer Studios overview — Livedealer.org](https://www.livedealer.org/studio-locations/noflash/)
- [Top 20 live dealer providers 2026 — KodeDice](https://www.kodedice.com/blog/top-live-dealer-casino-providers)
- [Bet Behind in Blackjack — LiveCasinoComparer](https://www.livecasinocomparer.com/casino-guides/blackjack-bet-behind/)
- [Bet Behind explained — Borgata](https://www.borgataonline.com/en/blog/what-is-bet-behind-in-blackjack/)
- [Live casino connection issues handling — CasinoRange](https://casinorange.com/how-to/live-game-is-interrupted-by-connection-issues)

---

_Slutt på rapport. Estimert lesetid: 12-15 min. Estimert verdi: gir Spillorama-arkitektur-team klart industri-anker for kommende beslutninger om Spill 2/3 capacity, multi-hall compliance, og eventuell EU-ekspansjon._
