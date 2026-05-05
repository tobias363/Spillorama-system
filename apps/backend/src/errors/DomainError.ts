/**
 * `DomainError` — domene-feil med stabil maskinlesbar feil-kode.
 *
 * Brukes som "kontrakt-feil" mellom service-laget og API/Socket-laget. Server-
 * feil skal kaste `DomainError("CODE", "Norsk melding", details?)` der `code`
 * er en stabil identifier som klient-koden matcher mot.
 *
 * `details` brukes når API/Socket-laget propagerer strukturert kontekst til
 * klient via `toPublicError(err).details`. Eksempler:
 *   - `HALLS_NOT_READY` → `{ unreadyHalls: [...] }` (Task 1.5 — agents-not-ready
 *     popup).
 *   - `JACKPOT_CONFIRM_REQUIRED` → nåværende pot-saldo, slik at klient ikke må
 *     gjøre et ekstra API-kall (MASTER_PLAN §2.3).
 *
 * Ekstrahert fra `BingoEngine.ts` (Stage 1 quick-win — Backend Pain-Points
 * Audit 2026-04-29). Tidligere lå klassen i en 4329-LOC `BingoEngine.ts` som
 * 211 produksjons-filer transitivt dro inn bare for å throw'e en domene-feil.
 * `BingoEngine.ts` re-eksporterer fortsatt klassen for back-compat.
 *
 * **Fase 2A (2026-05-05):** Optional `errorCode` for å koble feilen til
 * `apps/backend/src/observability/errorCodes.ts`-registry. Server-feil-handlere
 * og structured-loggeren (`logError`) bruker den til å hente severity, category,
 * og runbook-referanse uten å kreve manuell merge per call-site.
 *
 * Backwards-kompatibel: `errorCode` er optional — alle eksisterende
 * `new DomainError("CODE", "msg")`-call sites fortsetter uendret.
 */
export class DomainError extends Error {
  public readonly code: string;
  /**
   * Valgfri strukturert kontekst som API-laget propagerer til klient via
   * `toPublicError(err).details`. Brukes f.eks. av `HALLS_NOT_READY` for å
   * returnere `{ unreadyHalls: [...] }` (Task 1.5 — agents-not-ready popup),
   * og av `JACKPOT_CONFIRM_REQUIRED` for å returnere nåværende pot-saldo
   * uten at klient må gjøre et ekstra API-kall (MASTER_PLAN §2.3).
   */
  public readonly details?: Record<string, unknown>;

  /**
   * **Fase 2A:** valgfri stable error-code-key fra
   * `observability/errorCodes.ts`. Når satt har structured-loggeren tilgang
   * til severity/category/runbook uten ekstra parameter. Klient-feil-meldinger
   * bruker fortsatt `code` (og `details`) — `errorCode` er server-side
   * observability-only.
   *
   * Type er `string` (ikke union av registry-keys) for at refactor av
   * registry ikke skal kreve type-cast hver call-site. Faktisk validering at
   * koden eksisterer skjer i `lookupErrorCode` på consumer-side.
   */
  public readonly errorCode?: string;

  constructor(
    code: string,
    message: string,
    detailsOrErrorCode?: Record<string, unknown> | string,
    errorCode?: string,
  ) {
    super(message);
    this.code = code;

    // Backwards-kompat-overload: tidligere signatur var
    // `new DomainError(code, message, details)`. Ny signatur er
    // `new DomainError(code, message, details?, errorCode?)`.
    //
    // Vi støtter også `new DomainError(code, message, errorCode)` der tredje
    // argument er en string — for at vanlig migrering skal være lite verbose.
    if (typeof detailsOrErrorCode === "string") {
      // Tredje arg er errorCode-shorthand.
      this.errorCode = detailsOrErrorCode;
    } else {
      if (detailsOrErrorCode !== undefined) {
        this.details = detailsOrErrorCode;
      }
      if (errorCode !== undefined) {
        this.errorCode = errorCode;
      }
    }
  }
}
