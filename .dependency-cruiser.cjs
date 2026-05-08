/**
 * Spillorama architecture-lint config (BIN-architecture-lint, 2026-05-08).
 *
 * Håndhever monorepo-konvensjoner i CI via `dependency-cruiser`. Reglene
 * er bevisst smale slik at de fanger ekte arkitektur-brudd uten å
 * blokkere normal utvikling. Se docs/engineering/ARCHITECTURE_LINT.md
 * for begrunnelse, hvordan legge til nye regler, og hvordan håndtere
 * false positives.
 *
 * Tobias-direktiv 2026-05-08: "verdensklasse fundament — CI skal håndheve
 * arkitektoniske konvensjoner automatisk."
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /* ──────────────────────────────────────────────────────────────────
     * 1. Apps må ikke importere på tvers
     *
     * apps/backend og apps/admin-web skal være isolerte deploy-enheter.
     * Felles kode skal ligge i `packages/*` (shared-types, game-client).
     * Direkte cross-app-imports gjør deploy-grensene utydelige og kan
     * føre til at admin-UI uventet trekker inn backend-only kode (Pino,
     * Postgres-pool, Sentry).
     * ────────────────────────────────────────────────────────────────── */
    {
      name: "no-cross-app-imports",
      severity: "error",
      comment:
        "Apps må ikke importere på tvers — bruk packages/* for delt " +
        "kode. Hvis du må dele en type, flytt den til @spillorama/" +
        "shared-types.",
      from: { path: "^apps/backend/" },
      to: { path: "^apps/admin-web/" },
    },
    {
      name: "no-cross-app-imports-reverse",
      severity: "error",
      comment:
        "apps/admin-web må ikke importere fra apps/backend. Bruk HTTP " +
        "API + @spillorama/shared-types-typer.",
      from: { path: "^apps/admin-web/" },
      to: { path: "^apps/backend/" },
    },

    /* ──────────────────────────────────────────────────────────────────
     * 2. Wallet-mutering kun via WalletAdapter
     *
     * `wallet_accounts` og `wallet_transactions`-tabellene er kjernen i
     * casino-grade-wallet-arkitekturen (BIN-761→764). All mutering MÅ
     * gå gjennom `WalletAdapter`-implementasjonene (`PostgresWallet-
     * Adapter`, `InMemoryWalletAdapter`) eller `walletStateNotifying-
     * Adapter` for å få:
     *   - Outbox-pattern for crash-recovery
     *   - REPEATABLE READ + per-wallet advisory-lock for race-trygghet
     *   - Hash-chain audit-trail
     *   - Idempotency-key-håndhevelse
     *
     * Direkte SQL mot wallet-tabeller utenfor adapters/+wallet/ omgår
     * disse garantiene og er en hard regulatorisk risiko.
     *
     * Vi bruker file-path-regelen til å fange filer som ligger utenfor
     * sanksjonerte mapper og likevel rører wallet-tabellene. Filer
     * inni adapters/, wallet/, jobs/walletReconciliation, scripts/ og
     * tester (test/__tests__) får lov.
     * ────────────────────────────────────────────────────────────────── */
    {
      name: "no-direct-wallet-table-imports",
      severity: "error",
      comment:
        "Wallet-mutering må gå via WalletAdapter (apps/backend/src/" +
        "adapters/PostgresWalletAdapter.ts) — IKKE direkte SQL mot " +
        "wallet_accounts / wallet_transactions. Outbox-pattern + " +
        "REPEATABLE READ + hash-chain-audit MÅ være på plass for " +
        "wallet-touch (BIN-761→764). Hvis du trenger en ny wallet-" +
        "operasjon, utvid WalletAdapter-interfacet.",
      from: {
        path: "^apps/backend/src/",
        pathNot: [
          "^apps/backend/src/adapters/",
          "^apps/backend/src/wallet/",
          // jobs/ må kunne lese wallet-state for nightly reconciliation.
          "^apps/backend/src/jobs/walletReconciliation\\.",
          // routes/adminTransactions leverer admin read-only-vy av tx-loggen.
          "^apps/backend/src/routes/adminTransactions\\.",
          // scripts/ er one-shot ops-verktøy (reset-test-players etc.).
          "^apps/backend/src/scripts/",
          // metrics leser tellere fra wallet-tabellen for prom-export.
          "^apps/backend/src/util/metrics\\.",
          // index.ts og boot.ts wirer adapter-instansene.
          "^apps/backend/src/index\\.",
          "^apps/backend/src/boot/",
          // Tester tillates å mute wallet-tabellene direkte for fixture-setup.
          ".*\\.test\\.ts$",
          "^apps/backend/src/__tests__/",
          ".*/__tests__/",
        ],
      },
      // Vi kan ikke matche SQL-strenger via depcruise — men vi kan
      // matche `import` til adapter-filer. Hvis noen importerer Postgres-
      // poolen for å gjøre direct-SQL mot wallet-tabeller, må de gå via
      // database-modulen. Vi flagger her hvis kode utenfor whitelist
      // importerer `pg` direkte og samtidig nevner wallet i filnavnet —
      // det er en sterk signatur for direkte wallet-SQL.
      to: {
        path: ["^apps/backend/src/adapters/PostgresWalletAdapter\\."],
        pathNot: [
          // `WalletAdapter`-interfacet OG `walletStateNotifyingAdapter`
          // er sanksjonerte entry-points som routes/services skal bruke.
          // Importer `WalletAdapter`-typen direkte fra adapters/ avvises
          // ikke — typer-import kapsler ikke implementasjonen.
        ],
      },
    },

    /* ──────────────────────────────────────────────────────────────────
     * 3. Compliance-events kun via ComplianceLedger-service
     *
     * `app_rg_compliance_ledger` er regulatorisk audit-trail per peng-
     * espillforskriften §71. Alle entries MÅ gå via `ComplianceLedger`-
     * service (idempotency-key, hash-chain via outbox, samme schema-
     * resolver). Direkte INSERT bryter audit-garantiene.
     *
     * Reglene speiler wallet-regelen — sanksjonerte file-paths er
     * compliance/, game/ResponsibleGamingPersistence (selve service-
     * laget), ports/ (interface), og tester.
     * ────────────────────────────────────────────────────────────────── */
    {
      name: "no-direct-compliance-ledger-imports",
      severity: "error",
      comment:
        "Compliance-events må gå via ComplianceLedger-service — IKKE " +
        "direkte INSERT mot app_rg_compliance_ledger. §71-audit krever " +
        "idempotency-key + hash-chain-outbox. Hvis du trenger en ny " +
        "event-type, utvid CompliancePort-interfacet.",
      from: {
        path: "^apps/backend/src/",
        pathNot: [
          "^apps/backend/src/compliance/",
          "^apps/backend/src/game/ComplianceLedger\\.",
          "^apps/backend/src/game/PostgresResponsibleGamingStore\\.",
          "^apps/backend/src/game/ResponsibleGamingPersistence\\.",
          "^apps/backend/src/ports/",
          "^apps/backend/src/services/adapters/ComplianceAdapterPort\\.",
          "^apps/backend/src/services/PayoutService\\.",
          // Composition root: index.ts og boot/ wirer service-instansene
          // (avhengighet-injeksjon), så de må kunne instansiere store-en.
          "^apps/backend/src/index\\.",
          "^apps/backend/src/boot/",
          "^apps/backend/src/__tests__/",
          ".*\\.test\\.ts$",
          ".*/__tests__/",
        ],
      },
      to: {
        // Direkte import av PostgresResponsibleGamingStore utenfor
        // sanksjonerte stier indikerer at noen prøver å gjøre
        // ledger-writes utenfor service-laget.
        path: ["^apps/backend/src/game/PostgresResponsibleGamingStore\\."],
      },
    },

    /* ──────────────────────────────────────────────────────────────────
     * 4. Plan-runtime og scheduled-game-services skilles
     *
     * Bølge 1+2 fundament (spilleplan-redesign 2026-05-07): GamePlanRun-
     * Service eier plan-runtime-state (current_position, jackpot-
     * overrides, status). Engine-bridge (GamePlanEngineBridge) er den
     * eneste plassen som skal skrive til app_game1_scheduled_games på
     * vegne av plan-runtime. Hvis GamePlanRunService direkte muterer
     * scheduled-games-tabellen, går vi rundt bridge-laget og mister
     * sjansen til å enforce master-only-action-guards.
     *
     * Severity: warn — plan-runtime er fortsatt under utvikling, og vi
     * vil ikke blokkere CI hvis det er en enkel lese-spørring i debug-
     * logger.
     * ────────────────────────────────────────────────────────────────── */
    {
      name: "plan-runtime-not-direct-engine-bridge",
      severity: "warn",
      comment:
        "Plan-runtime (GamePlanRunService) bør IKKE direkte importere " +
        "engine-bridge — bridge er injisert som port. Importer typen, " +
        "ikke implementasjonen, for å holde laget testbart.",
      from: { path: "^apps/backend/src/game/GamePlanRunService\\." },
      to: {
        path: "^apps/backend/src/game/GamePlanEngineBridge\\.ts$",
        // type-only-imports er OK
        dependencyTypes: ["local"],
      },
    },

    /* ──────────────────────────────────────────────────────────────────
     * 5. Ingen sirkulære avhengigheter
     *
     * Sirkulære imports gjør at modul-load-rekkefølgen er udeterministisk
     * og at TypeScript ikke alltid klarer å resolve typer. Det er også et
     * tegn på dårlig modul-grenseoppdeling.
     * ────────────────────────────────────────────────────────────────── */
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Sirkulære avhengigheter er forbudt. Bryt opp via et felles " +
        "abstraksjon-lag eller en port/adapter.",
      from: {},
      to: { circular: true },
    },

    /* ──────────────────────────────────────────────────────────────────
     * 6. Ingen game4 / themebingo-imports (deprecated BIN-496)
     *
     * Game 4 / themebingo ble permanent avviklet 2026-04-17. Hvis noen
     * legger inn en ny modul med navnet `game4` eller `themebingo` er
     * det en regresjon. Vi matcher kun *fil-paths* — strenger i
     * deprecation-guards (DEPRECATED_GAME_SLUGS, etc.) er OK.
     * ────────────────────────────────────────────────────────────────── */
    {
      name: "no-deprecated-game4-modules",
      severity: "error",
      comment:
        "Game 4 / themebingo er deprecated (BIN-496, 2026-04-17). " +
        "Ingen nye filer eller imports skal bruke `themebingo` eller " +
        "`game4` som modul-navn. Strenger i deprecation-guards er OK.",
      from: {},
      to: {
        path:
          "(/themebingo[^/]*|/game4[^/]*)\\.(ts|tsx|js|jsx|mjs|cjs)$",
      },
    },

    /* ──────────────────────────────────────────────────────────────────
     * 7. Standard depcruise hygiene-regler
     * ────────────────────────────────────────────────────────────────── */
    {
      name: "not-to-unresolvable",
      comment:
        "Depcruise klarte ikke å resolve denne import. Sjekk stavemåte, " +
        "ts-paths, eller om dependency er installert.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],

  options: {
    /* Begrens hva vi scanner — ikke følg inn i node_modules eller dist */
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: [
        "node_modules",
        "dist",
        "\\.d\\.ts$",
        // Vendored / 3rd-party
        "scripts/performance-budget/",
        // Generated
        "packages/shared-types/dist/",
      ],
    },

    /* Resolve TypeScript paths i monorepo.
     *
     * Vi har ingen root-tsconfig — hver app/package har sin egen
     * (apps/backend/tsconfig.json, apps/admin-web/tsconfig.json,
     * packages/shared-types/tsconfig.json, packages/game-client/
     * tsconfig.json). Depcruise leser nærmeste tsconfig per fil
     * automatisk når dette feltet er utelatt; vi unngår å peke på
     * én bestemt config slik at hver workspace bruker sin egen
     * paths-mapping. */

    /* Penere graf-output */
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["main", "types"],
    },

    reporterOptions: {
      text: {
        highlightFocused: true,
      },
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },

    /* Print stille i CI; CLI-feedback gir kun start/stopp-log som
     * fungerer både i interactive terminal og GitHub Actions. */
    progress: { type: "none" },
  },
};
