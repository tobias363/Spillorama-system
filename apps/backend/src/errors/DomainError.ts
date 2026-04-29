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

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
