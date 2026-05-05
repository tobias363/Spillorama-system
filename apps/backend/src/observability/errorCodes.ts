/**
 * Strukturerte error-codes for Spillorama (Fase 2A — Tobias-direktiv 2026-05-05).
 *
 * Bakgrunn:
 *   Pilot-skala = 24 haller × 1500 spillere = 36 000 samtidige WebSocket-
 *   tilkoblinger. Når noe feiler i prod (host-disconnect, race-condition,
 *   unhandled-error) trenger vi:
 *     1. Stable maskinlesbar identifier per feilkategori → finne kode-stien.
 *     2. Severity + kategori → prioritere alerting og dashboards.
 *     3. Runbook-referanse → on-call kan løse uten å ringe utvikler.
 *     4. Retryable-flag → klient/system kan retry-e automatisk.
 *
 * Format: `<DOMAIN>-<MODULE>-<NUMBER>`
 *   - DOMAIN: alltid `BIN` (bingo / pengespill-domenet).
 *   - MODULE: 3-letters subdomain (RKT/MON/BIN/WLT/CMP/SCK/DRW/RUM/PAY/AUTH).
 *   - NUMBER: 3-siffer økende (001, 002, ...).
 *
 * Module-mapping:
 *   RKT  Spill 2 (rocket / tallspill / game_2)
 *   MON  Spill 3 (monsterbingo)
 *   BIN  Spill 1 (bingo / norsk-bingo)
 *   WLT  Wallet
 *   CMP  Compliance / pengespillforskriften
 *   SCK  Socket.IO
 *   DRW  Draw-engine (kuletrekk)
 *   RUM  Room management / lifecycle
 *   PAY  Payout / payment
 *   AUTH Auth / session
 *
 * Workflow:
 *   1. Når en ny error-throw legges til, legg den til denne registry-en med
 *      full metadata.
 *   2. Throw via `new DomainError(code, msg, errorCode)` der `errorCode` er
 *      en key herfra.
 *   3. Logg via `logError({ errorCode, ... })` fra `structuredLogger.ts`.
 *   4. Lag en runbook-stub i `docs/runbooks/<errorCode>.md` med kjente fix.
 *
 * NB: ikke fjern eller renumrer eksisterende codes. Dashboards og alert-
 * regler refererer til dem som stable identifiers. Deprecate i stedet ved
 * å markere `deprecated: true` og lage en ny code.
 */

// ── Severity, category og alert-rule typer ──────────────────────────────────

/**
 * Severity-nivå styrer hvor høyt en error havner i alerts og dashboards.
 *
 *   CRITICAL  Spillerne kan ikke spille. Pilot-blokker. PagerDuty.
 *   HIGH      Kjernefunksjon nede for noen brukere. Slack-alert + ticket.
 *   MEDIUM    Forventet edge-case som vi vil måle (rate). Dashboard-only.
 *   LOW       Diagnostisk informasjon. Ingen alert, kun strukturert log.
 */
export type ErrorSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/**
 * Kategori grupperer errors etter rot-årsak — brukes til dashboards så ops
 * kan se "race-conditions øker"-trender på tvers av moduler.
 *
 *   race-condition   Concurrent ops kappkjørte (host-fallback, throttle race)
 *   data-integrity   State er korrupt (host ikke i players[], snapshot mismatch)
 *   external-error   Eksternt API/tjeneste feilet (Postgres, Redis, Sentry)
 *   client-input     Klient sendte ugyldig input (forventet — for telemetri)
 *   infra            Infra/network/IO-feil (timeout, ENOSPC, OOM)
 *   scaling          Capacity/throughput-relatert (queue-overflow, rate-limit)
 *   game-logic       Forventet game-flow-event (DRAW_TOO_SOON race, NO_MORE_NUMBERS)
 *   recovery         Recovery / fallback-aktivering (host-fallback applied, stale-room recovery)
 */
export type ErrorCategory =
  | "race-condition"
  | "data-integrity"
  | "external-error"
  | "client-input"
  | "infra"
  | "scaling"
  | "game-logic"
  | "recovery";

/**
 * Alert-rule styrer hvordan ops blir varslet.
 *
 *   immediate         Hver enkelt forekomst genererer alert (CRITICAL/HIGH).
 *   rate-threshold    Alert når rate per minutt overstiger terskel (>10/min).
 *   none              Kun structured log + dashboard, ingen alert.
 */
export type ErrorAlertRule = "immediate" | "rate-threshold" | "none";

/**
 * Metadata-blokken som beskriver én error-code. Holdes flat (ingen nested
 * objects) for at JSON-eksport til dashboard-builder skal være triviell.
 */
export interface ErrorCodeMetadata {
  /** Kort tittel — vises i error-rate-tabeller og alert-bodies. */
  readonly title: string;
  /** Severity-nivå. Se `ErrorSeverity` for semantikk. */
  readonly severity: ErrorSeverity;
  /** Rot-årsak-kategori. Se `ErrorCategory`. */
  readonly category: ErrorCategory;
  /** Kan en retry løse problemet uten manuelt inngrep? */
  readonly retryable: boolean;
  /** Hvordan ops blir varslet. */
  readonly alertRule: ErrorAlertRule;
  /** Repo-relativ sti til runbook. Tom streng hvis stub mangler. */
  readonly runbook: string;
  /** Hvilken PR / Linear-issue introduserte denne — for arkeologi. */
  readonly introduced: string;
  /** Optional: deprecated codes beholdes for historikk men markeres her. */
  readonly deprecated?: boolean;
}

// ── Error-code registry ─────────────────────────────────────────────────────

/**
 * Registry. Nye codes legges til her; eksisterende codes endres ALDRI
 * (modulo `deprecated: true`) — dashbords + alert-regler binder mot disse.
 *
 * Ordningen er per-modul, alfabetisk på modul-prefix. Innenfor modul:
 * stigende nummer. Hopp ikke over numre — det signaliserer at en code
 * ble fjernet, og fjerning skal aldri skje (jf. semantisk versjonering).
 */
export const ERROR_CODES = {
  // ── BIN-RKT: Spill 2 (rocket) ──────────────────────────────────────────
  "BIN-RKT-001": {
    title: "Spill 2 auto-draw — host disconnected, fallback applied",
    severity: "MEDIUM",
    category: "recovery",
    retryable: false,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-RKT-001.md",
    introduced: "Fase 2A 2026-05-05 (host-fallback fix 2026-05-04)",
  },
  "BIN-RKT-002": {
    title: "Spill 2 auto-draw — engine.drawNextNumber unexpected error",
    severity: "HIGH",
    category: "external-error",
    retryable: true,
    alertRule: "immediate",
    runbook: "docs/runbooks/BIN-RKT-002.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-RKT-003": {
    title: "Spill 2 auto-draw — getRoomSnapshot threw (room destroyed mid-tick)",
    severity: "MEDIUM",
    category: "race-condition",
    retryable: true,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-RKT-003.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-RKT-004": {
    title: "Spill 2 auto-draw — stuck room auto-recovered (drawn=21, status=RUNNING)",
    severity: "HIGH",
    category: "recovery",
    retryable: false,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-RKT-004.md",
    introduced: "Fase 2A 2026-05-05 (root-cause fix 2026-05-04)",
  },
  "BIN-RKT-005": {
    title: "Spill 2 auto-draw — broadcaster.onDrawCompleted threw (UI may be stale)",
    severity: "HIGH",
    category: "external-error",
    retryable: false,
    alertRule: "immediate",
    runbook: "docs/runbooks/BIN-RKT-005.md",
    introduced: "Fase 2A 2026-05-05 (broadcaster bug-fix 2026-05-04)",
  },
  "BIN-RKT-006": {
    title: "Spill 2 perpetual restart — emitRoomUpdate failed (best-effort)",
    severity: "MEDIUM",
    category: "external-error",
    retryable: false,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-RKT-006.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-RKT-007": {
    title: "Spill 2 perpetual restart — engine.startGame failed (best-effort)",
    severity: "HIGH",
    category: "race-condition",
    retryable: false,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-RKT-007.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-RKT-008": {
    title: "Spill 2 perpetual — onStaleRoomEnded callback failed",
    severity: "MEDIUM",
    category: "external-error",
    retryable: false,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-RKT-008.md",
    introduced: "Fase 2A 2026-05-05",
  },

  // ── BIN-MON: Spill 3 (monsterbingo) ───────────────────────────────────
  "BIN-MON-001": {
    title: "Spill 3 auto-draw — host disconnected, fallback applied",
    severity: "MEDIUM",
    category: "recovery",
    retryable: false,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-MON-001.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-MON-002": {
    title: "Spill 3 auto-draw — engine.drawNextNumber unexpected error",
    severity: "HIGH",
    category: "external-error",
    retryable: true,
    alertRule: "immediate",
    runbook: "docs/runbooks/BIN-MON-002.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-MON-003": {
    title: "Spill 3 auto-draw — getRoomSnapshot threw (room destroyed mid-tick)",
    severity: "MEDIUM",
    category: "race-condition",
    retryable: true,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-MON-003.md",
    introduced: "Fase 2A 2026-05-05",
  },

  // ── BIN-DRW: Draw-engine ──────────────────────────────────────────────
  "BIN-DRW-001": {
    title: "Draw race — DRAW_TOO_SOON (forventet ved cron + admin-trigger overlap)",
    severity: "LOW",
    category: "game-logic",
    retryable: true,
    alertRule: "none",
    runbook: "docs/runbooks/BIN-DRW-001.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-DRW-002": {
    title: "Draw bag empty — NO_MORE_NUMBERS (forventet ved siste-ball)",
    severity: "LOW",
    category: "game-logic",
    retryable: false,
    alertRule: "none",
    runbook: "docs/runbooks/BIN-DRW-002.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-DRW-003": {
    title: "Draw forsøkt på ikke-RUNNING runde (GAME_NOT_RUNNING / GAME_PAUSED)",
    severity: "LOW",
    category: "game-logic",
    retryable: false,
    alertRule: "none",
    runbook: "docs/runbooks/BIN-DRW-003.md",
    introduced: "Fase 2A 2026-05-05",
  },

  // ── BIN-RUM: Room management ──────────────────────────────────────────
  "BIN-RUM-001": {
    title: "NOT_HOST — actor er ikke hostPlayerId for rommet",
    severity: "MEDIUM",
    category: "client-input",
    retryable: false,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-RUM-001.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-RUM-002": {
    title: "Host ikke i players[] men hostPlayerId satt — data-integrity-brudd",
    severity: "CRITICAL",
    category: "data-integrity",
    retryable: false,
    alertRule: "immediate",
    runbook: "docs/runbooks/BIN-RUM-002.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-RUM-003": {
    title: "Perpetual restart skipped — empty room (no players)",
    severity: "LOW",
    category: "game-logic",
    retryable: false,
    alertRule: "none",
    runbook: "docs/runbooks/BIN-RUM-003.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-RUM-004": {
    title: "Room destroyed mellom snapshot og operasjon (race med room:leave)",
    severity: "MEDIUM",
    category: "race-condition",
    retryable: true,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-RUM-004.md",
    introduced: "Fase 2A 2026-05-05",
  },

  // ── BIN-WLT: Wallet ──────────────────────────────────────────────────
  "BIN-WLT-001": {
    title: "Wallet debit failed — INSUFFICIENT_FUNDS",
    severity: "MEDIUM",
    category: "client-input",
    retryable: false,
    alertRule: "rate-threshold",
    runbook: "docs/runbooks/BIN-WLT-001.md",
    introduced: "Fase 2A 2026-05-05",
  },
  "BIN-WLT-002": {
    title: "Wallet debit/credit — idempotency-key collision",
    severity: "HIGH",
    category: "data-integrity",
    retryable: false,
    alertRule: "immediate",
    runbook: "docs/runbooks/BIN-WLT-002.md",
    introduced: "Fase 2A 2026-05-05",
  },

  // ── BIN-SCK: Socket.IO ───────────────────────────────────────────────
  "BIN-SCK-001": {
    title: "Socket emit failed — recipient disconnected mid-send",
    severity: "LOW",
    category: "race-condition",
    retryable: false,
    alertRule: "none",
    runbook: "docs/runbooks/BIN-SCK-001.md",
    introduced: "Fase 2A 2026-05-05",
  },

  // ── BIN-CMP: Compliance ──────────────────────────────────────────────
  "BIN-CMP-001": {
    title: "Compliance fail-closed — service utilgjengelig, spill blokkert",
    severity: "CRITICAL",
    category: "external-error",
    retryable: true,
    alertRule: "immediate",
    runbook: "docs/runbooks/BIN-CMP-001.md",
    introduced: "Fase 2A 2026-05-05",
  },
} as const satisfies Record<string, ErrorCodeMetadata>;

// ── Public type-aliases ──────────────────────────────────────────────────────

/**
 * Union-type av alle gyldige error-codes. Brukes som parameter-type i
 * `DomainError`, `logError`, `incrementErrorCounter` så TS fanger feilstaving
 * compile-time.
 */
export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Slå opp metadata for en error-code. Returnerer `undefined` hvis koden ikke
 * eksisterer — kalleren bør håndtere det (typisk fall back til "uncategorized").
 *
 * Aksepterer `string` (ikke bare `ErrorCode`) fordi runtime-input fra ekstern
 * source (database, log-file, HTTP-payload) kan inneholde ukjente koder.
 */
export function lookupErrorCode(code: string): ErrorCodeMetadata | undefined {
  return (ERROR_CODES as Record<string, ErrorCodeMetadata>)[code];
}

/**
 * Type-guard som narrower `string → ErrorCode`. Brukes i routes som tar
 * error-code fra path-param eller query-string og må validere før bruk.
 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_CODES;
}

/**
 * Hent alle error-codes som array. Brukes av admin-endpoint som lister
 * full registry, og av tests som verifiserer at registry er well-formed.
 */
export function listErrorCodes(): ReadonlyArray<{ code: ErrorCode; meta: ErrorCodeMetadata }> {
  return (Object.entries(ERROR_CODES) as Array<[ErrorCode, ErrorCodeMetadata]>).map(
    ([code, meta]) => ({ code, meta }),
  );
}
