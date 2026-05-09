# Agent onboarding-script

**Status:** Aktiv (2026-05-08)
**Eier:** Tobias Haugen
**Formål:** Hver ny agent-sesjon skal starte ferdig-orientert om current state.

---

## Hva scriptet gir

`scripts/agent-onboarding.sh` genererer en 1-2 sider markdown-rapport som
samler current state av prosjektet i én fil. Output dekker:

- **Pågående refaktor-bølger** (K1-K4 fra `BACKLOG.md`)
- **Sist 10 commits til `origin/main`** (med SHA + tittel)
- **Åpne pilot-blokkere** flagget i `BACKLOG.md`
- **Åpne PR-er** (top 10, via `gh` hvis tilgjengelig)
- **Aktive worktrees** — andre agenter som potensielt jobber parallelt
- **Domain-skills** under `.claude/skills/`
- **Skills sist oppdatert** (top 10 med relativ tid)
- **Lese-først-liste** med pekere til relevante doc-er

## Slik bruker agenten det

Ved oppstart av en sesjon:

```bash
./scripts/agent-onboarding.sh > /tmp/onboarding.md
```

Les `/tmp/onboarding.md` som første action — gir current state før første
kode-endring eller tool-call. Filen er kort nok (1-2 sider) til at den kan
holdes som aktiv kontekst gjennom hele sesjonen.

For å se output direkte i terminalen:

```bash
./scripts/agent-onboarding.sh
```

Scriptet er **idempotent** — kan kjøres når som helst, leser kun fra repo,
git og `gh` (CLI). Krasjer aldri på manglende verktøy; degraderer graceful
til "(ikke tilgjengelig)" i den aktuelle seksjonen.

## Når scriptet skal oppdateres

Legg til/endre seksjoner når:

- En ny strategisk doc skal pekes til i "Lese-først"
- BACKLOG.md får nye K-seksjoner som skal flagges
- Nye signal-kilder dukker opp (f.eks. ny ops-doc eller dashbord)

Alle endringer i scriptet bør:

1. Beholde idempotens — ikke skrive til filsystemet
2. Beholde graceful-degradation — sjekke om verktøy/filer finnes før de leses
3. Holde output kort — under ~150 linjer, så det er praktisk som kontekst-fil

## Avhengigheter

- `bash` 4+ (Mac default fra macOS 10.15+)
- `git` (alltid tilgjengelig i repoet)
- `awk`, `sed`, `find` (POSIX standard)
- `gh` CLI — valgfri; uten det vises "(ikke tilgjengelig)" for PR-seksjonen

## Pre-flight for første dev-sesjon (F1, F2 fra E2E-verification 2026-Q3)

Hvis du nettopp har klonet repoet eller dit `node_modules/` er rensket, må
du gjøre disse to stegene FØR `npm run dev` for å unngå feilmeldinger:

```bash
# F1: backend-deps installeres ikke automatisk av root `npm install`
npm --prefix apps/backend install

# F2: shared-types må bygges før backend kan importere det
npm run build:types
```

Symptomer hvis du glemmer:

- F1: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'nodemailer'`
  (eller annet backend-deps som ikke ligger i root `node_modules/`).
- F2: `Cannot find module '@spillorama/shared-types/dist/socket-events.js'`.

Disse stegene er idempotente — du kan kjøre dem på nytt uten skade.

## Plassering

- Script: `scripts/agent-onboarding.sh`
- Doc: `docs/engineering/AGENT_ONBOARDING.md` (denne filen)
- Kobling fra `CLAUDE.md` rot under "Agent onboarding"

## Output-format

Markdown med:

- H1 + metadata-blokk på toppen (genererings-tid, repo-path, branch)
- H2-seksjoner per emne
- Bullet-lister for hurtig skanning
- Italic-tekst (`_(ingen)_`) for tomme seksjoner

## Eksempel-output

Se `scripts/agent-onboarding.sh` for inline-dokumentasjon, eller kjør
scriptet selv for et live-eksempel.
