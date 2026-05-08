# Architecture Lint

**Verktøy:** [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) v17+
**Innført:** 2026-05-08 (Tobias-direktiv: verdensklasse fundament)
**CI-job:** `.github/workflows/architecture-lint.yml`
**Konfig:** `.dependency-cruiser.cjs`
**Baseline:** `.dependency-cruiser-known-violations.json`

## Hva regler håndhever

Architecture-lint kjører på hver PR mot `main` og hver push til `main`. Reglene fanger arkitektur-brudd som kan slippe gjennom code-review. Status per innføring: 6 forbidden-regler aktive + 1 hygiene-regel.

| # | Regel | Severity | Hva den fanger |
|---|---|---|---|
| 1 | `no-cross-app-imports` | error | `apps/backend` importerer fra `apps/admin-web` |
| 2 | `no-cross-app-imports-reverse` | error | `apps/admin-web` importerer fra `apps/backend` |
| 3 | `no-direct-wallet-table-imports` | error | Wallet-mutering utenom `WalletAdapter` (forsøk på å rette direkte SQL mot `wallet_accounts` / `wallet_transactions`) |
| 4 | `no-direct-compliance-ledger-imports` | error | `app_rg_compliance_ledger`-writes utenom `ComplianceLedger`-service |
| 5 | `plan-runtime-not-direct-engine-bridge` | warn | `GamePlanRunService` direkte-importerer `GamePlanEngineBridge` (skal være port-injected) |
| 6 | `no-circular` | error | Sirkulære avhengigheter (9 kjente baselinet, nye fanges) |
| 7 | `no-deprecated-game4-modules` | error | Filer/imports med navn `themebingo*` eller `game4*` (BIN-496) |
| — | `not-to-unresolvable` | error | Imports som ikke kan resolves (typo, manglende dep) |

### Hvorfor disse reglene?

**Cross-app-isolation (1, 2):** `apps/backend` og `apps/admin-web` skal være isolerte deploy-enheter. Felles kode hører i `packages/*`. Direkte cross-app-imports gjør deploy-grensene utydelige og kan trekke backend-only kode (Pino, Postgres-pool) inn i admin-bundlen.

**Wallet-isolation (3):** Casino-grade-wallet-arkitekturen (BIN-761→764) bygger på outbox-pattern + REPEATABLE READ + per-wallet advisory-lock + hash-chain-audit. Direkte SQL mot wallet-tabeller omgår alle disse garantiene og er en hard regulatorisk risiko.

**Compliance-isolation (4):** `app_rg_compliance_ledger` er regulatorisk audit-trail per pengespillforskriften §71. Idempotency-key + hash-chain-outbox er ikke valgfritt.

**Plan-runtime-port (5):** Bølge 1+2-fundament (spilleplan-redesign 2026-05-07). Engine-bridge er den eneste plassen som skal skrive til `app_game1_scheduled_games` på vegne av plan-runtime. Severity: warn fordi laget fortsatt er under aktiv utvikling.

**No-circular (6):** Sirkulære imports gjør modul-load-rekkefølgen udeterministisk og er et tegn på dårlig modul-grenseoppdeling. 9 eksisterende sirkler er baselinet som tech-debt — nye sirkler fanges som CI-feil.

**Deprecated game4 (7):** Game 4 / themebingo ble permanent avviklet per BIN-496 (2026-04-17). Nye filer skal ikke ha disse navnene. Strenger i deprecation-guards (`DEPRECATED_GAME_SLUGS`-arrays) er OK — kun fil-paths matches.

## Lokal bruk

```bash
# Kjør lint mot baseline (samme som CI)
npm run lint:arch

# Generér ny baseline (etter at en kjent violation er fikset)
npm run lint:arch:baseline

# Eksportér dependency-graf som mermaid-diagram
npm run lint:arch:graph > graph.mmd

# Vis alle violations inkl. baseline (ignorer ikke kjente)
npx depcruise --config .dependency-cruiser.cjs apps/backend/src apps/admin-web/src packages
```

`npm run lint:arch` krever at `packages/shared-types/dist/` er bygget — ellers fanger `not-to-unresolvable`-regelen ~12 falske positives på subpath-imports (`@spillorama/shared-types/socket-events` etc.). CI bygger shared-types automatisk.

## Hvordan legge til nye regler

1. Åpne `.dependency-cruiser.cjs`.
2. Legg til en ny entry i `forbidden`-arrayet med:
   - `name` — kebab-case, beskrivende
   - `severity` — `error` | `warn` | `info`
   - `comment` — forklaring som vises ved violation. Skriv hvorfor regelen finnes og hvordan utvikleren kan løse det.
   - `from` — file-path-regex som matcher filer regelen gjelder for
   - `to` — file-path-regex eller `dependencyTypes` for hva som er forbudt
3. Kjør `npm run lint:arch` lokalt — sjekk at antall violations er forventet.
4. Hvis regelen treffer mange eksisterende filer, bestem:
   - Whitelist sanksjonerte stier i `from.pathNot` (foretrukket)
   - Eller baseline dem med `npm run lint:arch:baseline` (bør være sjelden — gjør det kun når regelen håndterer eksisterende tech-debt vi ikke kan fikse i samme PR)
5. Commit både `.dependency-cruiser.cjs` og evt. ny baseline.

### Ekspempel: Ny regel som forbyr direkte Postgres-pool-bruk utenfor adapters/

```javascript
{
  name: "no-direct-pg-pool-outside-adapters",
  severity: "error",
  comment:
    "Postgres-pool må injectes som adapter — ikke importer pg/Pool " +
    "direkte i routes/services. Bruk PostgresAdapter-fabrikken.",
  from: {
    path: "^apps/backend/src/",
    pathNot: [
      "^apps/backend/src/adapters/",
      "^apps/backend/src/util/postgresPool\\.",
      ".*\\.test\\.ts$",
    ],
  },
  to: {
    path: "^node_modules/pg/",
    dependencyTypes: ["npm"],
  },
},
```

## Hvordan håndtere false positives

**Steg 1:** Sjekk om regelen er for bred. Smal heller down regelens `from.path` enn å overstyre `pathNot`.

**Steg 2:** Hvis filen i question er en legitimt sanksjonert sti (f.eks. composition-root i `index.ts` eller `boot/`), legg den til i regelens `pathNot`. Dokumentér hvorfor i kommentar.

**Steg 3:** Hvis violation er en eksisterende tech-debt vi ikke kan fikse i samme PR, regenerér baseline:

```bash
npm run lint:arch:baseline
git add .dependency-cruiser-known-violations.json
git commit -m "chore(arch): baseline X new known violations under <reason>"
```

**Steg 4:** ALDRI bruk `// eslint-disable`-stil hack for å forhindre at regelen kjører — depcruise er stille om dette og det er sterk anti-pattern. Bruk baseline eller utvid `pathNot` med kommentar.

### Eksempel-violation: hvordan ser det ut?

```
✘ apps/backend/src/sockets/walletStatePusher.ts → 
    apps/backend/src/adapters/PostgresWalletAdapter.ts (no-direct-wallet-table-imports)
    Wallet-mutering må gå via WalletAdapter (apps/backend/src/adapters/
    PostgresWalletAdapter.ts) — IKKE direkte SQL mot wallet_accounts /
    wallet_transactions.
```

Vises både lokalt og i CI-loggen. Lenker direkte til regelen + filen som bryter regelen.

## Dependency-graf

```bash
# Mermaid-diagram (rendres i GitHub-PR-comments med ```mermaid```-block)
npm run lint:arch:graph > arch-graph.mmd

# DOT-graf (åpne med Graphviz / online-visualiserer)
npx depcruise --config .dependency-cruiser.cjs --output-type dot apps/backend/src \
  | dot -Tsvg > arch-graph.svg

# Kun arkitektur-nivå (collapsed til mappenivå)
npx depcruise --config .dependency-cruiser.cjs --output-type archi apps/backend/src \
  | dot -Tsvg > arch-overview.svg

# Fokus på én modul + dens nærmeste naboer
npx depcruise --config .dependency-cruiser.cjs --focus "PostgresWalletAdapter" \
  --output-type dot apps/backend/src | dot -Tsvg > wallet-deps.svg
```

## Kjente baselined violations (per 2026-05-08)

| Type | Antall | Hvorfor baseline |
|---|---|---|
| `no-circular` (BingoEngine ↔ utils) | 5 | `BingoEngine.ts` kobles til `roomLogVerbose.ts` via flere paths som er sirkulære. Krever større refactor — flytt til egen ticket. |
| `no-circular` (game-client controllers ↔ registry) | 4 | `Game1-5Controller.ts` ↔ `registry.ts` — sirkulær registry-pattern. Kan løses med late-binding eller registry-i-egen-package. |

Til sammen: **9 kjente sirkulære avhengigheter** baselinet. Alle nye sirkler vil feile CI.

## Hva gjør vi når en kjent violation er fikset?

```bash
# 1. Fjern den sirkulære avhengigheten i koden
# 2. Regenerér baseline (vil fjerne den nå-fiksete violations)
npm run lint:arch:baseline

# 3. Diff baseline-filen — du skal se at kun den fiksede violation er fjernet
git diff .dependency-cruiser-known-violations.json

# 4. Commit både fixen og oppdatert baseline
git add <fixed-files> .dependency-cruiser-known-violations.json
git commit -m "refactor(scope): break circular dep <X>

Removes circular import between FooService and BarUtil.
Baseline updated to drop the now-fixed cycle."
```

## Hvorfor `dependency-cruiser` og ikke ESLint?

ESLint kjører per-fil med begrenset cross-file-context. `dependency-cruiser` bygger en full module-graph og kan resonnere om transitive avhengigheter, sykler, og file-path-mønstre på tvers av hele kodebasen. ESLint har plugins (`eslint-plugin-import`, `eslint-plugin-boundaries`) for noe av dette, men de er svakere på:

- Sirkulære avhengigheter (depcruise har full graph, eslint-plugin-import sliter med dype sykler)
- Transitive imports (depcruise følger hele kjeden)
- File-path-baserte regler med mange unntaks-stier
- Mermaid/DOT-graf-eksport for review

Vi kjører begge — depcruise håndterer arkitektur, ESLint/Stylelint håndterer kodestil/sikkerhet.

## Referanser

- [dependency-cruiser docs](https://github.com/sverweij/dependency-cruiser)
- [Rule reference](https://github.com/sverweij/dependency-cruiser/blob/develop/doc/rules-reference.md)
- BIN-761→764: Casino-grade wallet (kontekst for wallet-isolasjon)
- BIN-496: Game 4 / themebingo deprecation (2026-04-17)
- `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`: Tobias-direktiv om Evolution-grade fundament
