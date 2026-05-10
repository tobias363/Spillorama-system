# Contributing til Spillorama-system

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen

> **Til ny PM:** Du leser feil dokument. Gå til
> [`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](./docs/engineering/PM_ONBOARDING_PLAYBOOK.md).
>
> **Til ny utvikler/agent:** Les denne (10 minutter), så
> [`MASTER_README.md`](./MASTER_README.md) og
> [`docs/engineering/ENGINEERING_WORKFLOW.md`](./docs/engineering/ENGINEERING_WORKFLOW.md).

---

## Kort versjon

Spillorama er et regulert pengespill-system. Det betyr:

1. **Doc-en vinner over kode** — hvis du finner kode som motsier en kanonisk
   doc, fiks koden, ikke doc-en.
2. **PM-sentralisert git-flyt** — du commit-er og push-er feature-branch.
   PM oppretter PR og merger. Aldri merge selv.
3. **Done er bare når commit er på `main` med file:line-bevis** — ikke "det
   er på feature-branch", ikke "tester passer lokalt".
4. **Quality > speed** — Tobias-direktiv 2026-05-05. All død kode slettes,
   ikke kommenteres ut.

Hvis ett av disse ikke gir mening — les playbook FØR du commit-er.

---

## Forutsetninger

```bash
# Verifiser
node --version    # 22.x
docker --version  # for lokal Postgres + Redis
gh --version      # GitHub CLI for PR-flyt
```

---

## Først ting først (5 min)

```bash
git clone https://github.com/tobias363/Spillorama-system.git
cd Spillorama-system

# Workspace-installer
npm install
npm --prefix apps/backend install
npm run build:types

# Lokal stack (én kommando — Docker + DB + backend + admin + game-client)
npm run dev:all
```

Hvis stack ikke kommer opp: se [`scripts/PILOT_SETUP_README.md`](./scripts/PILOT_SETUP_README.md).

---

## Branch-naming

```
codex/<scope>-<topic>          # AI-agent-arbeid
fix/<scope>-<topic>            # bug-fix
feat/<scope>-<topic>           # ny feature
chore/<scope>-<topic>          # vedlikehold
docs/<scope>-<topic>           # docs-only-endring
```

Inkluder dato hvis flere parallelle: `fix/wallet-recon-2026-05-10`.

## Commit-konvensjoner

Conventional Commits — påkrevd:

```
feat(backend): legg til hall-betting-grenser
fix(game-client): korriger spill1 ball-animasjon
docs(compliance): oppdater pengespillforskriften audit-trail
test(backend): tester for ResponsibleGamingStore
chore(deps): bump express til 4.21.2
```

**Scopes:** `backend`, `game-client`, `admin-web`, `shared-types`, `infra`,
`compliance`, `docs`, `ci`.

Ikke gjør `git add -A`. Adde eksplisitte filer — det forhindrer at lokale
secrets eller debug-filer havner i commit:

```bash
git add apps/backend/src/wallet/transferService.ts
git add apps/backend/src/wallet/transferService.test.ts
git commit -m "fix(backend): wallet-transfer idempotens på retry"
```

---

## PR-flyt (PM-sentralisert)

**Som agent/utvikler:**
1. Lag branch: `git checkout -b fix/scope-topic-$(date +%Y-%m-%d)`
2. Commit + push
3. Rapportér til PM med:
   - Branch-navn
   - SHA på siste commit
   - Test-status (hva ble verifisert lokalt)
   - File:line-bevis for endringen
4. **Aldri** kjør `gh pr create` eller `gh pr merge` selv.

**PM tar over fra punkt 4:** oppretter PR, sjekker CI etter 5–10 min, merger.

Detaljer: [`docs/engineering/ENGINEERING_WORKFLOW.md`](./docs/engineering/ENGINEERING_WORKFLOW.md)
og ADR-0009 (PM-sentralisert git-flyt).

---

## Definition of Done

Et item er Done når **alle** disse stemmer:

1. ✅ Commit MERGET til `main` (ikke feature-branch)
2. ✅ `file:line`-bevis dokumentert i PR-kommentar eller handoff
3. ✅ Test eller grønn CI-link verifiserer atferd

**"Tester passer på feature-branch" er IKKE Done.** Adoptert 2026-04-17 etter
fire false Done-funn (BIN-534). Se ADR-0010.

---

## Hva må oppdateres i en PR

Sjekk-listen i [PR-template](./.github/pull_request_template.md):

- [ ] **Hvis arkitektur-beslutning:** Skriv ADR i `docs/adr/NNNN-tittel.md`
- [ ] **Hvis ny modul:** README.md i modul-mappen
- [ ] **Hvis API-endring:** Oppdater `apps/backend/openapi.yaml`
- [ ] **Hvis migration:** Validate-script i `scripts/hooks/validate-migration-name.mjs`
- [ ] **Hvis pilot-blokker-status endrer seg:** Oppdater `BACKLOG.md`
- [ ] **Hvis ny invariant:** Oppdater relevant kanonisk doc

---

## Å lese FØR du rør

Hvis oppgaven berører:

| Område | Les FØRST |
|---|---|
| Spill 1 (`bingo`) | `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` |
| Spill 2 (`rocket`) | `docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md` |
| Spill 3 (`monsterbingo`) | `docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md` |
| Wallet / payout / økonomi | `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` + skill `wallet-outbox-pattern` |
| Live-rom robusthet | `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` |
| Compliance / regulatorisk | `docs/compliance/` + skill `pengespillforskriften-compliance` |

---

## Skills

Spillorama bruker prosjekt-spesifikke Claude-skills i `.claude/skills/`. Last
KUN den skill-en som matcher din oppgave (lazy-loading, vedtatt 2026-04-25).
For ren PM/orkestrering — last ingen skills.

---

## Sesjons-slutt

Hver sesjon avsluttes med handoff-doc:
[`docs/SESSION_HANDOFF_PROTOCOL.md`](./docs/SESSION_HANDOFF_PROTOCOL.md).

---

## Sikkerhet

Sårbarheter rapporteres privat — se [`SECURITY.md`](./SECURITY.md).

Credentials handles via [`secrets/`](./secrets/) og
[`docs/operations/CREDENTIALS_AND_ACCESS.md`](./docs/operations/CREDENTIALS_AND_ACCESS.md).
**Aldri** committ credentials, **aldri** lim dem inn i Cowork-chat eller Slack.

---

## Hvis noe er uklart

1. Søk i `docs/` — bruk Grep (ikke åpne hver fil)
2. Sjekk `docs/INVENTORY.md` for hvor ting bør ligge
3. Sjekk om det finnes en relevant ADR i `docs/adr/`
4. Spør Tobias

---

**Velkommen til prosjektet.**
