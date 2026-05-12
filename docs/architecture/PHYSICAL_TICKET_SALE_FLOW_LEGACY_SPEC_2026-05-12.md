# Fysisk-bong-salg fra Cash In/Out — Legacy 1:1-spec (2026-05-12)

**Status:** Research-spec — IKKE implementert ennå. Selvstendig referanse for
implementasjons-agent. Genereres som svar på Tobias-direktiv 2026-05-12 om at
`localhost:5174/admin/#/agent/cash-in-out` mangler scanner-funksjon for fysiske
bonger sammenlignet med legacy.

**Eier:** PM (research-agent) + Tobias for godkjenning av plan.
**Kanoniske kilder:**
- `docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf` (PDF 17)
- `docs/wireframes/WF_B_Spillorama_Admin_V1.0_13-09-2024.pdf` (PDF 16)
- `docs/architecture/WIREFRAME_CATALOG.md` §11, §15, §17

**Konflikt-regel:** Dette dokumentet er kun research. Hvis det motsier
`SPILL_REGLER_OG_PAYOUT.md` eller `SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`,
vinner de kanoniske doc-ene. Flagg avvik i §10 i stedet for å overstyre.

> **NB om legacy-kode:** `legacy/`-mappen finnes IKKE i repoet per 2026-05-12.
> Spec-en er derfor 1:1 mot **wireframene** (PDF 17 §17.13/§17.15 + PDF 17
> §17.22 + wireframe-katalog), ikke mot legacy-PHP/Node-implementasjon.
> Implementasjons-agent skal IKKE prøve å lete frem legacy-koden — wireframene
> + den eksisterende moderne implementasjonen er ground-truth.

---

## 1. TL;DR

Tobias bekrefter at Cash In/Out i legacy hadde scanner-funksjon for fysiske
bonger som lar agenten:

1. **Registrere flere bonger** (utvide inventaret av usolgte bonger pre-skift)
   ved å skanne start-+slutt-ID per ticket-type.
2. **Registrere solgte bonger** (markere hvor mange som er solgt frem til
   neste planlagte spill starter) ved å skanne kun slutt-ID per ticket-type;
   start-ID følger automatisk fra carry-forward.

Den moderne stacken har **modal-implementasjon ferdig** (`RegisterMoreTicketsModal.ts`
+ `RegisterSoldTicketsModal.ts`) som matcher wireframe-spec'en — men flere
ting mangler eller er suboptimale:

- **A.** Knappene vises kun i `AgentCashInOutPage` (`/admin/agent/cash-in-out`),
  IKKE i `CashInOutPage` (`/admin/cashinout`) hvor master-konsollet bor.
- **B.** `gameId` resolves via `window.prompt(...)` i stedet for auto-pickup
  fra neste planlagte scheduled-game (NextGamePanel-staten).
- **C.** Barcode-scanner-integrasjon bruker `window.prompt()` per rad i stedet
  for hardware USB-scanner-pattern (komponenten `BarcodeScanner.ts` finnes
  men er ikke wired inn i modalene).
- **D.** Sub-game-velger (dropdown over Game 1-pågående spill, jf. PDF §17.13
  header "Game: Wheel of Fortune") mangler — ÉN gameId om gangen.
- **E.** "Add Physical Tickets"-side (sidebar-leaf, jf. wireframe §15.1 / §17.22)
  for pre-skift-registrering av hele stack-batcher har ingen UI i agent-route-treet.
- **F.** F1/F2-hotkey-paritet er delvis (F1 funker, F2 inni Sold-modal funker,
  men kreves også fra page-level + Enter-hopp mellom rader).
- **G.** Sold-tickets-rapport på Cash In/Out-vinduet ("My Hall" / "Group Of
  Hall"-bokser per wireframe §17.2) mangler.

Estimert arbeid for full paritet: **~3-4 PR-er à 1-2 dev-dager** (kumulativ).
Detaljer i §8.

---

## 2. Wireframe-spec (komplett)

### 2.1 Cash In/Out master-vindu — fysisk-bong-relaterte knapper

Per PDF 17 side 8 (skjerm 17.2 — "Cash In/Out Management — Main View"):

**Cash In/Out-knapp-rad (6 knapper, ikke fysisk-bong-relatert, kun for kontekst):**

| # | Knapp | Farge | Wireframe-ref |
|---|---|---|---|
| 1 | Add Money Unique ID | Grønn | §17.10 |
| 2 | Add Money Registered User | Grønn | §17.7 |
| 3 | Create New Unique ID | Grønn | §17.9 |
| 4 | Withdraw Unique ID | Rød | §17.11 |
| 5 | Withdraw Registered User | Rød | §17.8 |
| 6 | Sell Products | Grønn | §17.12 |

**Next Game-panel (Spill 1-spesifikk, fysisk-bong-relevant):**

| # | Knapp | Farge | Wireframe-ref | Hva |
|---|---|---|---|---|
| 1 | **Register More Tickets** | Brun | §17.13 | Utvid inventar — scan Initial+Final per type |
| 2 | **Register Sold Tickets** | Grønn | §17.15 | Marker antall solgt — scan Final per type (carry-forward Initial) |
| 3 | Start Next Game | Blå (stor) | §17.16-19 | Trigger master-start |
| 4 | i (Ready/Not Ready info) | Lilla (liten) | §17.17 | Vis hall-ready-status-popup |

**Ongoing Game-panel** (etter spill-start) inkluderer også:

- `PAUSE Game and check for Bingo` (blå) — §17.16 + §17.34/17.35
- `Resume Game` (brun)
- `Add Physical Ticket` (separat fra Register More) — §17.22-24, kun
  pre-game og kun for **valgt sub-game** mens spilleplan er pre-start.

### 2.2 Register More Tickets — modal-spec (§17.13)

**Trigger:** F1 hotkey eller klikk på "Register More Tickets"-knapp.

**Header:** `Register More Tickets — {gameName}` (gameName valgfritt).

**Felter — én input-rad øverst:**

| Felt | Type | Validering |
|---|---|---|
| `Initial ID of the stack` | numerisk | ≥ 0, heltall |
| (pil) `→` | (display) | viser flyt-retning til Final |
| `Final ID of the stack` | numerisk | ≥ Initial |
| Scan-knapp | button | Åpner barcode-scan for **Initial** først |
| Submit-knapp | button | Klipper ut data og legger til tabellen |

> NB: Per wireframe-tekst (PDF 17 side 12 panel A):
>
> > "The agent can register the tickets either by inserting or scanning the
> > first ticket ID. This allows the system to record the tickets within range,
> > making them available for the agent to sell. And this will be for each ticket
> > type."
> >
> > "To scan the ticket, the agent needs to click on the scan button. Upon
> > scanning, the ticket ID will be automatically inserted into the input field
> > of the Initial ID of the stack, and any subsequent scanned tickets will be
> > added in the final ID of the stack."

Dette betyr: **scan-flyten er at agenten skanner FØRSTE bong → autofyll Initial,
deretter skanner SISTE bong → autofyll Final**. Tekst-input som backup.

**Tabell (vises EFTER agent har submittet en eller flere rader):**

| Kolonne | Type | Kilde |
|---|---|---|
| Ticket Type | label | mapping fra Initial-range til type (auto-detect via DB) |
| Initial ID | label | fra input |
| Final ID | label | fra input |
| Tickets Sold | label | beregnet — initial state = 0 (ingen solgt enda) |
| **Action** | 2 ikoner | (a) Edit (blyant) → åpner "Register More Tickets — Edit" popup med Initial-input, (b) Delete (søppelkasse) → fjerner rad |

Ticket-typer i wireframe-tabell (PDF 17 side 12, eksempel):
- Small Yellow (1–100, 10 sold)
- Small White (101–200, 20 sold)
- Large Yellow (201–300, 10 sold)
- Large White (301–400, 40 sold)
- Small Purple (401–500, 0 sold)
- Large Purple (501–600, 0 sold)

Hva som mangler i wireframe: **Red / Green / Blue / Small Green**. Tobias-
beslutning 2026-04-23 (LEGACY_1_TO_1_MAPPING §3.4 / §8 / Hotfix-tabell #3) er
at vi utvider til **11 farger** allerede (matcher `TICKET_TYPES`-array i
backend per 2026-10-01-migration).

**Edit-popup (PDF 17 side 12, høyre side):**

| Felt | Type |
|---|---|
| Initial ID of the stack | numerisk (pre-fylt fra rad) |
| Scan-knapp | button |
| Submit-knapp | button |

(Endring av Final ID gjøres ved å slette og legge til på nytt? Wireframe
viser kun Initial-input. Implementasjon-spørsmål for Tobias.)

**Hotkeys (wireframe note nederst side 12):**
- F1: Submit modal (legger til scanned-tickets i listen)
- Esc: avbryt
- (Manglende fra wireframe-note: Enter mellom Initial/Final-felter)

**Backend-effekt:** Legger til ÉN eller flere ranges i `app_ticket_ranges_per_game`
for **et planlagt spill** (krever derfor `gameId`-context). Note nederst
side 12: *"Tickets added by one agent will be automatically available for other
agents of the same hall"*.

### 2.3 Register Sold Tickets — modal-spec (§17.15)

**Trigger:** F1 hotkey fra page (på pages som IKKE har Register More) eller
klikk på "Register Sold Tickets"-knapp.

**Header:** `Register Sold Tickets` + sub-header `Game: {gameName}` (eks
"Wheel of Fortune").

**Felter — én input-rad øverst:**

| Felt | Type | Note |
|---|---|---|
| `Final ID of the stack` | numerisk | Initial er IKKE input — kommer fra carry-forward |
| Scan-knapp | button | Hardware-trigger |
| Submit-knapp | button | Submit ALLE rader |

**Tabell (vises etter første submit):**

| Kolonne | Verdi | Kilde |
|---|---|---|
| Ticket Type | Small Yellow / Small White / ... | Auto fra Initial-range |
| Initial ID | 1 / 101 / ... | Carry-forward (siste rundes final+1) |
| Final ID | scannet/tastet | input |
| **Action** | Delete (søppel) | Fjern rad |

Eksempel (PDF 17 side 13):

```
Game: Wheel of Fortune
Final ID of the stack: [____] [Scan] [Submit]

| Ticket Type   | Initial ID | Final ID | Action |
| Small Yellow  | 1          | 10       | 🗑      |
| Small White   | 101        | 20       | 🗑      |
```

> **Carry-forward-eksempel (PDF 17 side 13, høyre panel):**
>
> "Before the schedule begins for the current day, the agent scans the full
> stack of different ticket types. […] Before the start of each game, the
> agent will proceed to sell tickets to the players. When there are only X
> minutes left until the game begins, the agent must scan the next ticket
> after the last one sold. The system will then mark the previous tickets as
> sold, and those unsold tickets will be carried forward to the next game."
>
> Eksempel:
> - **09:00 Wheel of Fortune** schedule har Small Yellow stack 1–100 og Large
>   Yellow stack 101–200.
> - Pre-game scan: agent har solgt 10 Small Yellow (ID 1–10). Agent skanner
>   ticket "11" som siste solgte → system informerer at tickets 1–10 er solgt
>   for **denne** game, og 11–100 carry-forward til **neste** game.
> - **10:00 Wheel of Fortune**: agent har solgt 20 nye Small Yellow (11–30).
>   Agent skanner "31" → system vet 11–30 er solgt for denne, 31–100 carry-
>   forward.

**Footer-knapper (under tabell):** Submit | Cancel

**Hotkeys (wireframe note PDF 17 side 13, panel C):**
- **F2:** Submit modal
- **Enter:** Submit scan ticket (legg til i tabell)
- **Cancel-knapp:** avbryt

**Validering:**
- Final ≥ Initial
- Minst én rad må ha Final satt før Submit

**Backend-effekt:** Oppdaterer `final_id` på eksisterende `app_ticket_ranges_per_game`-rader
for det aktive spillet, trigger `Game1HallReadyService.markReady(...)` for
hall-status-flyt (§ ready-pill blir grønn).

**Important note (PDF 17 side 13, helt nederst):**
> "This scan module will only register tickets for the **next game only**."

Dvs hvis agenten har 2 pågående spill, må modalen vise dropdown (eller bruke
implisitt "neste planlagte"). Wireframe viser kun ett spill-navn, så
implementasjon antar **NextGamePanel.currentScheduledGameId** som kilde.

### 2.4 Add Physical Tickets — separat side (§15.1 / §17.22)

**Trigger:** Sidebar-leaf "Add Physical Ticket" (PDF 17 side 19) eller "Add
Physical Ticket"-knapp inni View Sub Game Details (§17.24).

**Forskjell fra Register More:**
- Per **sub-game** kontext, ikke generisk for hallen
- Brukes pre-skift / pre-schedule for å registrere **hele stacker** før
  noen spill starter
- Tabell på selve siden viser de 6 type-radene fra dag 1 (vs Register
  More som er per-modal-session)

**Layout (PDF 17 side 19):**

| Felt | |
|---|---|
| Initial ID of the stack | input → |
| Final ID of the stack | input |
| Scan | button |
| Submit | button |

| Ticket Type | Initial ID | Final ID | Tickets Sold | Action |
|---|---|---|---|---|
| Small Yellow | 1 | 100 | 10 | 🗑 |
| Small White | 101 | 200 | 20 | 🗑 |
| Large Yellow | 201 | 300 | 10 | 🗑 |
| Large White | 301 | 400 | 40 | 🗑 |
| Small Purple | 401 | 500 | 0 | 🗑 |
| Large Purple | 501 | 600 | 0 | 🗑 |

**Pre-game-eksempel (PDF 17 side 19 panel A):**
> "Agent will have to register the tickets everyday before the schedule starts.
> For example, consider a scenario where an agent scans small yellow ticket.
> On a given day, the agent scans tickets numbered from 1 to 100. Once all
> these tickets are sold, the agent proceeds to scan and register the next
> batch of 100 tickets, having ID from 101 to 200. Let's say the agent sells
> 50 tickets from this batch, leaving 50 remaining. Consequently, the agent
> will need to scan the remaining 50 tickets with ticket numbers ranging from
> 151 to 200 on the next day."

**Note:** *"Tickets added by one agent will be automatically available for
other agents of the same hall."*

**Add Physical Ticket inni Sub Game Details (§17.24) — popup:**

Header: `Add Physical Ticket — Game: Wheel of Fortune`

| Felt |
|---|
| Final ID of the Stack |
| Scan |
| Submit |

| Ticket Type | Initial ID | Final ID | Action |
| Small Yellow | 1 | 10 | 🗑 |
| Small White | 101 | 20 | 🗑 |

Submit / Cancel.

> Note (PDF 17 side 20): *"Physical ticket player will get auto-cashout from
> the system as soon as winnings are available."*

### 2.5 Scanning-funksjon — hardware-detaljer

Per `apps/admin-web/src/components/BarcodeScanner.ts`:

- **Hardware:** USB-barkode-scanner i kiosk-modus emulerer tastatur-input
- **Trigger:** Scanner sender hele barcode + Enter
- **Format:** Minimum 22 tegn total; ticket-ID sitter på pos 14..20 (7 sifre)
- **Debounce:** 250ms etter Enter for å la buffer-skrivinger lande
- **Filter:** Strings < 22 tegn ignoreres så manuell Enter ikke trigger scan

**Spec-implikasjon:** Modalene skal binde `BarcodeScanner.attach({...})` til
Initial/Final-input-feltet og lytte på Enter, ikke bruke `window.prompt()`
som dagens implementasjon (begrenser ergonomi for hall-terminal-bruk).

### 2.6 Backend-koblinger

**Tabeller** (eksisterer allerede):

| Tabell | Migration | Innhold |
|---|---|---|
| `app_ticket_ranges_per_game` | `20260726100000_ticket_ranges_per_game.sql` | Én rad per (game_id, hall_id, ticket_type) med initial_id / final_id / sold_count / round_number / carried_from_game_id |
| `app_physical_tickets` | Eldre migrations | Individuelle tickets med state (UNSOLD/SOLD/MARKED) — knytter mot agent-portal player-flow |
| `app_physical_ticket_batches` | Eldre migrations | Batch-import (bulk CSV) for pre-skift |

Migration `20261001000000_ticket_ranges_11_color_palette.sql` utvidet
ticket-color CHECK-constraint til 11 farger.

**Endpoints** (eksisterer):

| Endpoint | Hva |
|---|---|
| `GET /api/agent/ticket-registration/:gameId/initial-ids` | Returnerer initial_id + round + carry-forward per type |
| `POST /api/agent/ticket-registration/:gameId/final-ids` | Lagrer per-type final_ids → beregner sold_count → trigger Game1HallReadyService.markReady |
| `GET /api/agent/ticket-registration/:gameId/summary` | Admin-view |
| `PUT /api/agent/ticket-ranges/:rangeId` | REQ-091 edit av eksisterende range mellom runder |

**RBAC:**
- AGENT (aktiv shift) — kan registrere for `shift.hallId`
- HALL_OPERATOR — for `user.hallId`
- ADMIN — alle haller

**Audit:** Hver record/edit skriver til `AuditLogService` med før/etter-state.

### 2.7 Per-spill-flyt

Når master starter spill (POST `/api/agent/game1/master/start`):

1. **MasterActionService** sjekker at scheduled-game er `ready_to_start`
2. **Hall-ready-status** for hver hall bekreftet via `Game1HallReadyService.isReady(hallId, gameId)`
3. Ready-status leser fra `app_game1_hall_ready_status` der `physical_tickets_sold`
   = sum(sold_count) for hallens ranges på dette spillet
4. Når spillet kjører, fysiske bonger som vinner får auto-cashout via
   `PhysicalTicketPayoutService` (utenfor scope for denne specen — eksisterer)

**Konvertering fysisk → ticket-purchase:** Skjer IKKE som digital arming.
Fysiske bonger har egen lifecycle (UNSOLD → SOLD via scanner / MARKED via
auto-mark-engine). Tickets bindes til `scheduled_game_id` via
`app_ticket_ranges_per_game.game_id`.

---

## 3. Current state — hva eksisterer

### 3.1 Implementert (modal-lag)

| Komponent | Path | Status |
|---|---|---|
| RegisterMoreTicketsModal | `apps/admin-web/src/pages/agent-portal/modals/RegisterMoreTicketsModal.ts` | ✅ Full §17.13-paritet (Initial+Final-edit, scan-prompt, F1/Enter/Esc, edit eksisterende vs ny rad) |
| RegisterSoldTicketsModal | `apps/admin-web/src/pages/agent-portal/modals/RegisterSoldTicketsModal.ts` | ✅ Full §17.15-paritet (Final-only-input, carry-forward fra backend, F1/F2/Enter/Esc, REQ-091 edit-mode) |
| BarcodeScanner | `apps/admin-web/src/components/BarcodeScanner.ts` | ✅ Hardware-pattern (22-tegn min, debounce, Enter-trigger) — **IKKE wired** inn i modalene |
| Agent Cash In/Out-side | `apps/admin-web/src/pages/agent-portal/AgentCashInOutPage.ts` | ✅ Knapper "Register More" + "Register Sold" wired + F1 page-level hotkey |
| Admin Master Cash In/Out-side | `apps/admin-web/src/pages/cash-inout/CashInOutPage.ts` | ⚠️ Knappene mangler (kun Unique ID + balance vises) |
| Backend service | `apps/backend/src/agent/TicketRegistrationService.ts` | ✅ Full 11-farge-palette, carry-forward, validering |
| Backend route | `apps/backend/src/routes/agentTicketRegistration.ts` | ✅ Alle endpoints + RBAC + audit |
| Migration 11-farger | `apps/backend/migrations/20261001000000_ticket_ranges_11_color_palette.sql` | ✅ |

### 3.2 Sett fra screenshot Tobias delte

URL: `localhost:5174/admin/#/agent/cash-in-out` (note: dette er
`AgentCashInOutPage`, ikke master-konsoll `CashInOutPage`).

Visning:
- "Kontant inn/ut-administrasjon"-seksjon nederst
- Knapper "Registrer flere bonger (F1)" og "Registrer solgte bonger"
- Tekst: "Her vil de 6 knappene for Unique ID, Registrert bruker, Sell
  Products, Shift Log Out og Today's Sales Report bli implementert per
  Agent V1.0-wireframe."

Dette matcher `appendAgentActionsSection` i `AgentCashInOutPage.ts` (linje
145-194). Det er en **placeholder** under hovedinnholdet — ikke wireframe-
parisk plassering. I wireframe-spec (PDF 17 §17.2) skal disse knappene være
**øverst** i Cash In/Out-vinduet under cash-balanse-panelet, ikke nederst som
placeholder.

---

## 4. Gap-tabell

| # | Wireframe-feature | Spec-detalj | Current state | Gap | Pri |
|---|---|---|---|---|---|
| 1 | F1 hotkey åpner Register More fra master-konsoll | F1 fra alle agent-routes | F1 fungerer kun i `AgentCashInOutPage` | F1 mangler i `CashInOutPage` (master) | P1 |
| 2 | Register More-modal `gameId` auto-pickup | NextGamePanel.currentScheduledGameId | `window.prompt(t("enter_game_id"))` | gameId-resolution suboptimal, krever manuell input | **P0** |
| 3 | Register Sold-modal `gameId` auto-pickup | NextGamePanel.currentScheduledGameId | `window.prompt(t("enter_game_id"))` | Samme som 2 | **P0** |
| 4 | Barcode-scanner i input-felt | `BarcodeScanner.attach()` på Initial/Final-input | Bruker `window.prompt()` per rad | Scanner ikke wired — manuell input only via prompt | **P0** |
| 5 | Sub-game-velger header | Header "Game: Wheel of Fortune" m/dropdown hvis flere | Header viser bare gameId hvis sendt inn | Dropdown over pågående Spill 1-instanser mangler (lavt sannsynlig at det er > 1) | P2 |
| 6 | Add Physical Tickets — standalone sidebar-side | Sidebar-leaf "Add Physical Ticket" | Sidebar har "Physical Cashout" + admin-side "Physical Tickets", men ingen agent-leaf for batch-add | Ny side `apps/admin-web/src/pages/agent-portal/AgentAddPhysicalTicketsPage.ts` | P1 |
| 7 | Add Physical Ticket inni Sub Game Details | Popup per sub-game | Eksisterer ikke i UI | Ny modal koblet til admin sub-game-detail-side | P2 |
| 8 | F2 fra page-level åpner Register More | Page-level hotkey (komplementer F1) | Kun F1 (jf. tekst "Agent will register more tickets by F1") | Implementer F2 page-level (alternativ til F1) | P2 |
| 9 | Plassering av knappene i master `CashInOutPage` | Toppen av master cash-in-out per §17.2 | Knappene finnes IKKE i master-konsoll | Vurder å duplisere knapper (ADMIN/HALL_OPERATOR har samme behov når master tar over) | P1 |
| 10 | "Today's Sales Report" + "Shift Log Out"-knapper | Per §17.2 | Shift Log Out finnes; Today's Sales Report mangler i `AgentCashInOutPage` | (Out-of-scope for fysisk-bong-flyt, men flag) | P2 |
| 11 | Tekst "Her vil de 6 knappene… bli implementert" placeholder | Per wireframe §17.2 skal de 6 knappene være implementert | Bare tekstplaceholder finnes | Fjern placeholder + implementer 6-knapp-radet | **P0** |
| 12 | Carry-forward UI-indikator | Title-attribute viser "Carry-forward fra {gameId}" | Implementert | ✅ Ingen gap | — |
| 13 | Edit ticket-range mellom runder | PUT /api/agent/ticket-ranges/:rangeId | Implementert i Register Sold + More-modalene | ✅ Ingen gap | — |
| 14 | "Tickets added by one agent available for other agents" | Hall-level deling | Service-laget håndterer dette via hall_id-binding | ✅ Ingen gap (backend) | — |
| 15 | "Add Physical Ticket"-knapp på admin View Sub Game Details | §17.24 popup | Admin Sub Game Details-side eksisterer men har ikke knappen | Legg til knapp + modal | P2 |
| 16 | Selg-rapport per game: My Hall / Group Of Halls bokser | §17.2 nederst — "Winning My hall This Game" + "Winnings Group of hall" | Eksisterer ikke | (Out-of-scope for fysisk-bong-flyt — egen agent-portal sak) | P2 |
| 17 | Wireframe-parisk plassering av knapper i Cash In/Out master | Øverst etter cash-balanse | Placeholder nederst | Refaktor `AgentCashInOutPage` for å plassere knappene i wireframe-rekkefølge | P1 |

---

## 5. Detaljert anbefalt PR-plan

### PR 1 (P0): Auto-pickup av `gameId` fra Next Game-context + scanner-input
**Estimat:** 1.5 dev-dager.
**Mål:** Fjerne `window.prompt()`-friksjon for agenten.

**Endringer:**
1. Eksporter `getNextScheduledGameForHall(hallId)` fra `apps/admin-web/src/api/agent-game1.ts`
   (bruker eksisterende lobby-aggregator).
2. Modifiser `RegisterMoreTicketsModal.ts` + `RegisterSoldTicketsModal.ts`
   til å akseptere `gameId: string | null`-prop. Hvis null, vis dropdown
   over pågående/upcoming scheduled-games (kallér `getNextScheduledGameForHall`).
3. Wire `BarcodeScanner.attach({ input: initialInput, onScan: (id) => { ... } })`
   både på Initial- og Final-input i Register More, og på Final-input i Register Sold.
   Bevar manuell `window.prompt()`-scan-knapp som fallback for dev/testing.
4. I `AgentCashInOutPage.openRegisterMoreTicketsFromAgent` + `registerBtn`-handler,
   fjern `window.prompt(t("enter_game_id"))` — call `getNextScheduledGameForHall`
   i stedet.

**Tester:**
- Snapshot-test for modal-rendering med null `gameId` (vis dropdown)
- Snapshot-test med `BarcodeScanner` mock som emitterer 22-tegn-streng → input populeres med 7-sifret ticket-ID
- E2E: åpne Cash In/Out → klikk Register Sold → ingen prompt → dropdown vises eller auto-pickup hvis ett spill

### PR 2 (P0): Plasser knappene wireframe-parisk + fjern placeholder
**Estimat:** 0.5 dev-dager.
**Mål:** UI-paritet med §17.2.

**Endringer:**
1. Refaktor `AgentCashInOutPage.appendAgentActionsSection` — legg knappene i
   `Next Game`-seksjon mellom Cash In/Out-knapper og Ongoing Game-seksjon.
2. Slett tekst "Her vil de 6 knappene… bli implementert" — erstatt med faktisk
   6-knappers Cash In/Out-rad (Add Money Unique ID + Add Money Registered
   User + Create New Unique ID + Withdraw Unique ID + Withdraw Registered
   User + Sell Products).
3. De 6 Cash In/Out-knappene finnes allerede som modaler i `cash-inout/`-
   katalogen — wire bare opp `onClick`-handlere.

**Tester:**
- Snapshot-test for at knappene rendres i wireframe-rekkefølge
- Click-tests for hver knapp → riktig modal åpnes

### PR 3 (P1): Master `CashInOutPage` får samme fysisk-bong-knapper
**Estimat:** 0.5 dev-dager.
**Mål:** Master/admin har samme flyt som agent.

**Endringer:**
1. Importer `openRegisterMoreTicketsModal` + `openRegisterSoldTicketsModal`
   i `apps/admin-web/src/pages/cash-inout/CashInOutPage.ts`.
2. Wire 2 knapper i `Next Game`-seksjon (eksisterende `Spill1HallStatusBox`
   eller egen seksjon).
3. F1 page-level hotkey (kopier `installF1Hotkey` fra agent-portal).
4. ADMIN/HALL_OPERATOR-rolle får automatisk `hallId`-resolution via routes
   (eksisterer i backend).

**Tester:**
- Snapshot-test for at knappene rendres for ADMIN-rolle i master-konsoll
- F1-hotkey-test

### PR 4 (P1): Add Physical Tickets — standalone sidebar-side
**Estimat:** 1 dev-dag.
**Mål:** Pre-skift batch-registrering av hele stacker.

**Endringer:**
1. Ny side `apps/admin-web/src/pages/agent-portal/AgentAddPhysicalTicketsPage.ts`
   per §15.1 / §17.22.
2. Layout: Input-rad (Initial / Final / Scan / Submit) + tabell med alle 11
   ticket-typer i hall (queries backend for current state).
3. Sidebar-leaf "Add Physical Ticket" under Agent-seksjonen.
4. Backend: Bruker eksisterende `recordFinalIds` med dummy-gameId =
   "pre-shift" eller dedikert pre-shift-mekanisme. **Krever diskusjon med Tobias** —
   skal pre-shift-tickets bindes til en "default" eller "next scheduled" game,
   eller egen entitet?

**Avklaring kreves:** Hvordan pre-skift-stacker mappes til scheduled-games.
Wireframe-tekst sier "before the schedule starts" så det implisitt antas at
en agent registrerer alt før dagens første spill — men hvis hallens dag har
multiple Spill 1-runder, hvilken scheduled-game-id bindes batchen til?
Forslag: bind til **første scheduled-game av dagen**.

### PR 5 (P2 — kan utsettes): F2 page-level + sub-game-velger + Add Physical Ticket i Sub Game Details
**Estimat:** 0.5 dev-dager.

(Detaljer mindre kritiske — se Gap-tabell row 5, 7, 8.)

---

## 6. Test-strategi

| Test-nivå | Hva | Verktøy |
|---|---|---|
| Unit | Modal-rendering, hotkey-handling, validering | Vitest + jsdom |
| Integration | Backend-route end-to-end mot ekte Postgres | `apps/backend/src/routes/__tests__/agentTicketRegistration.test.ts` (eksisterer) |
| E2E | Full agent-flyt: åpne side → scan → submit → verify ready-pill | Playwright (krever ny test) |
| Visual | Snapshot av modal-layout vs wireframe | `npm run test:visual` |

---

## 7. Avhengigheter og koblinger

| Avhengighet | Status | Note |
|---|---|---|
| `Game1HallReadyService.markReady` | ✅ Eksisterer | Triggers etter recordFinalIds |
| `MasterActionService` | ✅ Eksisterer | Leser hall-ready-status før start |
| `app_ticket_ranges_per_game` table | ✅ Migration 20260726100000 | 11-farge utvidet 20261001000000 |
| `BarcodeScanner` component | ✅ Eksisterer | Må wires inn |
| Lobby aggregator (`GameLobbyAggregator`) | ✅ Eksisterer | Source for next scheduledGameId |
| Audit-log | ✅ Eksisterer | Skriver per record/edit |

---

## 8. Estimat-sammendrag

| PR | Pri | Estimat (dev-dager) | Kumulativ |
|---|---|---|---|
| PR 1 — gameId auto-pickup + scanner-input | **P0** | 1.5 | 1.5 |
| PR 2 — knapp-plassering + 6 Cash In/Out-knapper | **P0** | 0.5 | 2.0 |
| PR 3 — master CashInOutPage får samme knapper | P1 | 0.5 | 2.5 |
| PR 4 — Add Physical Tickets standalone-side | P1 | 1.0 | 3.5 |
| PR 5 — F2 hotkey + sub-game-velger + popup | P2 | 0.5 | 4.0 |

**Total:** ~4 dev-dager fordelt over 5 PR-er. Kan kjøres sekvensielt eller
parallelt (PR 1 og PR 4 har ingen avhengighet).

---

## 9. Spørsmål til Tobias

1. **Pre-skift batch-registrering — hvilken scheduled-game-id bindes batchen
   til?** Forslag: første scheduled-game av dagen (oppslag på `business_date`).
   Wireframe er ikke eksplisitt.
2. **Hardware-scanner config:** Er kiosk-terminalene satt opp med 22-tegn
   barcode-format som `BarcodeScanner.ts` antar? Eller skal vi støtte
   alternative formater (CODE128 / EAN-13)?
3. **F1 vs F2 hotkeys i wireframe** (PDF 17 side 13 panel C):
   - Tekst sier "F2 button will add the scan ticket to the list"
   - Vår implementasjon har F2 = "åpne Register More fra Sold-modal"
   - Hvilken er kanonisk?
4. **Master `CashInOutPage` (`/admin/cashinout`) — har ADMIN behov for samme
   fysisk-bong-flyt** som AGENT? Forslag PR 3 dupliserer knappene, men
   alternativ er at master alltid sender disse aksjonene via designert
   shift-agent.

---

## 10. Konflikter med kanoniske docs

Ingen åpenbare konflikter funnet mot:
- `SPILL_REGLER_OG_PAYOUT.md` — fysisk-bong-flyt rør ikke payout-mekanikk
- `SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` — fysisk-bong-flyt er en
  agent-portal sub-feature, ikke endring i master-flow
- `SPILLKATALOG.md` — kun Spill 1 har fysiske bonger (Spill 2/3 er online-only),
  jf. confirmed i §3.6/§3.7 av implementation-status-doc-ene

**Note:** Spill 3 status-doc sier eksplisitt "Online only — ingen fysiske
bonger via agent". Spill 2 har "ÉN ticket-type ('Standard'), default 10 kr"
men ingen fargevarianter. Dette betyr fysisk-bong-flyten gjelder **kun Spill 1**.

---

## 11. Referanser

| Doc | Hvor |
|---|---|
| Wireframe PDF Agent V1.0 | `docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf` |
| Wireframe PDF Admin V1.0 | `docs/wireframes/WF_B_Spillorama_Admin_V1.0_13-09-2024.pdf` |
| Wireframe-katalog | `docs/architecture/WIREFRAME_CATALOG.md` §11.1-3, §15.1-10, §17.13-24 |
| Spill 1 implementation status | `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` |
| Legacy 1:1 mapping | `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` §3.4, §3.5 |
| Master plan Spill 1 pilot | `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md` §2 |
| Pengespillforskriften compliance | `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` |

---

**Sluttnote:** Spec-en er self-contained for implementasjons-agent. PR-plan
i §5 kan kjøres umiddelbart. Spørsmål i §9 må besvares av Tobias før PR 4 og
PR 5.
