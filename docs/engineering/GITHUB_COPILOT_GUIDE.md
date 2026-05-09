# GitHub Copilot — oppsett og bruk i Spillorama

**Status:** Aktivert 2026-05-08.
**Eier:** Tobias Haugen (teknisk lead).

Dette dokumentet forklarer hvordan GitHub Copilot er konfigurert for Spillorama-repoet, hvilken regelfil den leser, og hvordan utviklere kan bruke den uten å bryte prosjekt-konvensjoner. Lese sammen med `CLAUDE.md` (rotnivå) og fundament-doc-ene under `docs/architecture/`.

---

## 1. Hva er Copilot konfigurert til å gjøre?

Copilot er aktivert som assistent i editoren. Den foreslår kode-completions og chat-svar basert på:

1. Konteksten i filen utvikleren jobber i.
2. Naboer i samme repo (åpne tabs, importerte moduler).
3. **`.github/copilot-instructions.md`** — repo-nivå regelfil som Copilot laster automatisk før den foreslår kode.

Regelfilen er kondensatet av prosjekt-konvensjonene som ellers ligger spredt i:
- `CLAUDE.md` (Claude Code-agentenes prosjekt-CLAUDE)
- `docs/architecture/SPILL[1-3]_IMPLEMENTATION_STATUS_2026-05-08.md`
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md`
- `docs/architecture/SPILLKATALOG.md`

Mens Claude Code-agenter kan lese hele dokument-suiten ved behov (de har tool-tilgang), har Copilot et begrenset context-budget. Derfor er regelfilen et destillert kondensat — full detalj forblir i kildedokumentene som regelfilen peker på.

---

## 2. Hva regelfilen dekker

`.github/copilot-instructions.md` er ~390 linjer og dekker følgende seksjoner. Hver seksjon er kort fordi formålet er å Copilot skal kjenne **at en regel finnes** og hvor den fulle versjonen ligger — ikke å re-skrive fundament-doc-ene.

| Seksjon | Innhold |
|---|---|
| Project at a glance | Tech-stack quick reference (Node 22, TypeScript strict, Express, Socket.IO, Postgres 16, Redis 7, Vite, Pixi). |
| 🚨 Read-first blockers | Pekere til Spill 1/2/3-fundament-doc-er, live-rom-mandatet, og payout-doc-en. |
| Game catalog quick reference | Marketing-navn, kode-navn, slug og regulatorisk kategori. Eksplisitt "game4/themebingo deprecated". |
| ID disambiguation | `currentScheduledGameId` vs `planRunId`. Master-actions går via `/api/agent/game1/master/*`. |
| Deprecated patterns | Slettede importer, `console.log`, direkte SQL mot wallet-tabeller, `pauseGame1(planRunId)`. |
| Architectural conventions | Modul-grenser, `WalletAdapter`/`ComplianceLedger`-port, plan-runtime vs scheduled-game, idempotency, strict TypeScript. |
| Pengespillforskriften | §11, §66, §71, single-prize cap (kun databingo). |
| Bong-priser + payout | Auto-multiplikator (5/10/15 kr → ×1/×2/×3), pot-deling per bongstørrelse, Trafikklys + Oddsen avvikene. |
| File and code naming | PascalCase, camelCase, SCREAMING_SNAKE_CASE-konvensjoner + import-rekkefølge. |
| Testing | tsx --test for backend, vitest for game-client, skip-graceful for Postgres/Redis-tester, compliance-suite. |
| Commit conventions | Conventional Commits + scopes (`backend`, `game-client`, `admin-web`, `shared-types`, `infra`, `compliance`). |
| Local development | Dev-kommandoer + env-vars som ikke skal embedes. |
| Prefer / Avoid lister | Konkrete "do this, not that"-eksempler Copilot biases mot. |
| Authoritative docs-pekere | Tabell med doc per domene. |

### Hva regelfilen IKKE dekker (med vilje)

- **PM-orkestrering** (agent-spawning, worktrees, parallell-koordinering) — Claude Code-spesifikt, irrelevant for Copilot.
- **Linear-issue-tracking** — Copilot har ikke Linear-tilgang.
- **Secrets / env-verdier** — disse skal aldri foreslås.
- **Detaljert per-spill-mekanikk** — ligger i `SPILL_DETALJER_PER_SPILL.md`. Regelfilen peker dit i stedet.
- **Full ADR-katalog** — `docs/adr/README.md` er ferskere og enklere å vedlikeholde.

---

## 3. Hvor regelfilen laster fra

GitHub Copilot støtter [`copilot-instructions.md`](https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) på flere nivåer. Spillorama bruker:

- **Repo-nivå:** `.github/copilot-instructions.md` — den eneste regelfilen som er sjekket inn. Lastes automatisk for alle Copilot-kall i dette repoet.

Vi bruker **ikke**:
- Brukernivå-instruksjoner (`~/.config/github-copilot/`) — de er person-spesifikke og bør ikke styre prosjekt-konvensjoner.
- Per-fil-instruksjoner (`*.copilot-instructions.md` i samme katalog som koden) — vi har valgt én sentral fil for å forhindre drift.
- Org-nivå-policy (GitHub Copilot Enterprise) — ikke aktuelt p.t.

---

## 4. Hvordan bruke Copilot uten å bryte konvensjoner

### 4.1 Stol, men verifiser

Copilot kjenner regelfilen, men har ikke tool-tilgang for å lese fundament-doc-ene direkte. Hvis Copilot foreslår noe som ser kontroversielt ut — f.eks. en cap på Spill 1, en `console.log` i `apps/backend/src/`, eller direkte SQL mot `app_wallet_accounts` — så er det Copilot som tar feil, ikke regelfilen.

**Sjekk-rutiner:**

1. **Live-spill-endringer** → Les den relevante `SPILL[1-3]_IMPLEMENTATION_STATUS`-doc-en før du committer.
2. **Payout-endringer** → Les `SPILL_REGLER_OG_PAYOUT.md`.
3. **Wallet-touch** → Bruk `WalletAdapter`-port, aldri direkte SQL.
4. **Master-actions fra UI** → Gå alltid via `/api/agent/game1/master/*`. Aldri `/api/agent/game-plan/*` fra klient-kode.

### 4.2 Når Copilot foreslår noe deprecated

Hvis Copilot foreslår `import "@/api/agent-game-plan-adapter"` eller `pauseGame1(planRunId, reason)`, ignorer forslaget og bytt til den nye kontrakten:

```ts
// Bytt fra (deprecated) til (kanonisk)
import { fetchLobbyState, pauseMaster, resumeMaster } from "@/api/agent-game1";
await pauseMaster(currentScheduledGameId, { hallId });
```

Det samme gjelder `game4` / `themebingo` — disse er deprecated (BIN-496) og skal aldri inn i nye filer.

### 4.3 TypeScript strict + Zod

`tsconfig.json` har `strict: true` overalt. Hvis Copilot foreslår `// @ts-ignore` eller en bredere `any`, finn heller riktig type. Wire-formater (HTTP-/socket-payloads) kommer fra `@spillorama/shared-types` og er Zod-validerte. Når du legger til et nytt felt i en wire-payload, gjør det først i `packages/shared-types/`, kjør `npm run build`, og bruk så typen begge steder.

### 4.4 Idempotency på mutative endpoints

Alle endringer som muterer wallet, compliance-ledger eller scheduled-games krever idempotency. Copilot vil gjerne foreslå raske `INSERT`-er uten dedup — overstyr og bruk `clientRequestId` (sockets) eller `Idempotency-Key`-header (HTTP).

---

## 5. Når regelfilen skal oppdateres

Oppdater `.github/copilot-instructions.md` når en av følgende inntreffer:

1. **Ny fundament-doc** under `docs/architecture/` med `Lese-først-i-sesjon: JA` (legg til 🚨-blokk).
2. **Ny stor refaktor** som flytter en kanonisk path (eks: hvis vi engang bytter ut `MasterActionService` for noe annet).
3. **Nytt deprecated mønster** vi vil at agenter ikke skal foreslå. Legg det inn i "Deprecated patterns".
4. **Nytt regulatorisk krav** (pengespillforskriften-endring, ny §11-prosent, ny cap).
5. **Spillkatalog-endring** — nye spill, deprecation av eksisterende.

Gjør oppdateringen som en separat docs-PR, gjerne sammen med oppdatering av `CLAUDE.md` så de to filene holder seg synkrone på 🚨-blokkene.

**Antimønster:** Ikke ekspander regelfilen til å inneholde all detaljen fra fundament-doc-ene. Hvis du må forklare noe i over 5 linjer, lag en lenke i stedet.

---

## 6. Forholdet til Claude Code-agentene

Spillorama bruker både:

- **Claude Code-agenter** (PM-orkestrert, worktree-isolert, kan lese hele repoet via tool-calls). Regler ligger i `CLAUDE.md` + `docs/architecture/` + skills under `.claude/skills/`.
- **GitHub Copilot** (i editor, in-line completions + chat). Regler ligger i `.github/copilot-instructions.md`.

De to systemene er parallelle, ikke hierarkiske. Begge skal respektere de samme grunnregelene. Hvis du finner divergens mellom `CLAUDE.md` og `.github/copilot-instructions.md`, behandle det som en bug og oppdater den filen som er foreldet.

| Domene | Claude Code | Copilot |
|---|---|---|
| Lese fundament-docs ved behov | ✅ tool-calls | ❌ context-budget |
| Spawne sub-agenter | ✅ | ❌ |
| Lese Linear-issues | ✅ MCP | ❌ |
| Foreslå kode in-line i editor | ❌ | ✅ |
| Skills-aktivering | ✅ | ❌ |
| Git-orkestrering (commit + push) | ✅ feature-branch | ❌ |

---

## 7. Vanlige spørsmål

**Q: Bør jeg legge til en per-fil-instruksjon for moduler med uvanlige konvensjoner?**

A: Nei, ikke med mindre den sentrale regelfilen er utilstrekkelig. Vi har valgt én sentral fil for å forhindre drift. Hvis et modulnivå-mønster er kritisk, dokumenter det i `docs/architecture/` og legg en peker i regelfilen.

**Q: Kan Copilot bryte regelfilen uansett?**

A: Ja, regelfilen er en hint, ikke et håndhevet hardstop. Det er utviklerens ansvar å sjekke forslaget mot fundament-doc-ene. CI-gates (architecture-lint, compliance-gate) fanger det viktigste post-commit.

**Q: Hva om Copilot foreslår et endepunkt jeg ikke gjenkjenner?**

A: Sjekk `docs/auto-generated/API_ENDPOINTS.md` og `apps/backend/openapi.yaml`. Hvis det ikke finnes der, er det enten hallusinert av Copilot eller deprecated. Ikke commit forslaget før du har bekreftet at endepunktet eksisterer.

**Q: Hvor finner jeg current state av prosjektet?**

A: `docs/auto-generated/` regenereres på hver `main`-push. `MODULE_DEPENDENCIES.md`, `DB_SCHEMA_SNAPSHOT.md`, `API_ENDPOINTS.md`, `MIGRATIONS_LOG.md`, `SKILLS_CATALOG.md`, `SERVICES_OVERVIEW.md` er alltid friske. Håndskrevne docs kan henge etter.

---

## 8. Vedlikehold

| Aktivitet | Frekvens | Eier |
|---|---|---|
| Verifiser at regelfilen matcher `CLAUDE.md` 🚨-blokker | Etter store fundament-doc-endringer | PM-AI |
| Auditér deprecated-listen mot faktisk slettet kode | Hver kvartalsslutt | Tobias / PM |
| Sjekk linje-tall (mål 300–600) | Ad-hoc ved utvidelser | Hvem som helst |
| Oppdater Authoritative docs-tabell | Ved doc-rename / nye fundament-doc-er | Forfatteren av den nye doc-en |

---

## 9. Referanser

- `.github/copilot-instructions.md` — regelfilen Copilot leser.
- `CLAUDE.md` — Claude Code-agentenes prosjekt-CLAUDE.
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` — Spill 1 fundament.
- `docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md` — Spill 2 fundament.
- `docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md` — Spill 3 fundament.
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — Evolution-grade mandat.
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` — kanonisk regel- og payout-doc.
- `docs/architecture/SPILLKATALOG.md` — markedsføringsnavn vs slug.
- `docs/engineering/ENGINEERING_WORKFLOW.md` — PR-flyt og merge-rutiner.
- [GitHub-doc: Adding custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot)
