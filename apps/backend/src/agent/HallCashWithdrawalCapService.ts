/**
 * HV2-A / BIR-036: Daglig kontant-utbetaling-cap per hall (50 000 kr/dag).
 *
 * Eier-avklaring (Tobias 2026-04-30):
 *   * Bank-overføring (`Withdraw in Bank` → XML-pipeline): INGEN grense
 *   * Kontant      (`Withdraw in Hall`, destination_type='hall'): 50 000 kr/dag/hall
 *
 * Regulatorisk:
 *   Pengespillforskriften krever kontant-håndteringskontroll per hall.
 *   En hard cap på 50 000 kr/dag per hall forhindrer både uautorisert
 *   kontant-utbetaling (intern svindel) og overskridelse av forsvarlig
 *   håndteringsbeløp i fysiske haller.
 *
 * Datalager:
 *   `app_hall_cash_withdrawals_daily (hall_id, business_date)` med PK på
 *   (hall_id, business_date). Atomisk increment via
 *   `INSERT ... ON CONFLICT ... DO UPDATE` med embedded cap-sjekk i WHERE.
 *
 * Tidssone:
 *   `business_date` er Norge-dato (Europe/Oslo) — samme convention som
 *   `Game1JackpotStateService` etter LOW-2-fix 2026-04-26. DST-safe.
 *
 * Bruksmønster (caller = `paymentRequests`-routeren):
 *   1. Før wallet.debit: `await capService.assertWithinCap(hallId, amountCents, nowMs)`
 *      → kaster `DomainError("CASH_WITHDRAW_CAP_EXCEEDED", ...)` hvis over.
 *   2. Wallet.debit kjøres.
 *   3. Etter wallet.debit: `await capService.recordWithdrawal(hallId, amountCents, nowMs)`
 *      → atomisk increment med embedded cap-re-sjekk for race-trygghet.
 *
 *   `recordWithdrawal` kaster `DomainError("CASH_WITHDRAW_CAP_EXCEEDED", ...)`
 *   hvis en annen samtidig request fylte opp bucketen mellom assert og record
 *   — caller må da reverse wallet.debit (eller la transaksjonen rulle tilbake).
 *
 * Bank-flyt:
 *   Bank-uttak (`destination_type='bank'`) skal IKKE kalle dette servicet.
 *   Det er caller's ansvar å sjekke `destinationType === "hall"` før kall.
 */

import type { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import { formatOsloDateKey } from "../util/osloTimezone.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "hall-cash-withdrawal-cap" });

/**
 * Cap-grense i NOK per hall per dag for kontant-utbetaling.
 *
 * Spec: Tobias 2026-04-30. Endringer her krever PM-godkjenning og bør
 * dokumenteres i `docs/architecture/HV2_BIR036_SPEC_2026-04-30.md`.
 */
export const CASH_WITHDRAW_CAP_PER_HALL_DAILY_NOK = 50_000;

/**
 * Samme cap som over, uttrykt i øre (cents). Multiplikatoren er bevisst
 * inline (ikke import) for å unngå import-syklus.
 */
export const CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS =
  CASH_WITHDRAW_CAP_PER_HALL_DAILY_NOK * 100;

export interface HallCashWithdrawalCapServiceOptions {
  pool: Pool;
  schema?: string;
}

interface DailyTotalRow {
  total_amount_cents: string | number;
  count: string | number;
}

/**
 * Validér og normaliser et schema-navn slik at det er trygt å bruke
 * i identifier-posisjon i SQL. (Defense-in-depth — alle call-sites
 * setter dette fra config, men vi sanity-sjekker likevel.)
 */
function assertSchemaName(schema: string): string {
  const trimmed = schema.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new DomainError(
      "INVALID_CONFIG",
      "APP_PG_SCHEMA er ugyldig. Bruk kun bokstaver, tall og underscore."
    );
  }
  return trimmed;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function assertHallId(hallId: string): string {
  if (typeof hallId !== "string") {
    throw new DomainError("INVALID_INPUT", "hallId må være en streng.");
  }
  const trimmed = hallId.trim();
  if (!trimmed) {
    throw new DomainError("INVALID_INPUT", "hallId mangler.");
  }
  return trimmed;
}

function assertPositiveAmountCents(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "amountCents må være et positivt heltall."
    );
  }
  return value;
}

function businessDateFromMs(nowMs: number): string {
  if (!Number.isFinite(nowMs)) {
    throw new DomainError("INVALID_INPUT", "nowMs må være et tall.");
  }
  return formatOsloDateKey(new Date(nowMs));
}

/**
 * Service for daglig kontant-utbetaling-cap per hall.
 *
 * Tre publike metoder:
 *   - `getRemainingCapCents(hallId, nowMs)` — read-only, returnerer
 *     gjenstående budget i øre. Lekker ingen state.
 *   - `assertWithinCap(hallId, amountCents, nowMs)` — kaster hvis det
 *     forespurte beløpet ville overskride cap. Pre-flight check.
 *   - `recordWithdrawal(hallId, amountCents, nowMs)` — atomisk increment
 *     med embedded cap-re-sjekk. Kalles ETTER vellykket wallet-debit.
 *     Race-trygg: hvis en annen samtidig request fylte opp bucketen
 *     mellom assert og record, kastes `CASH_WITHDRAW_CAP_EXCEEDED`.
 */
export class HallCashWithdrawalCapService {
  private readonly pool: Pool;

  private readonly tableQualified: string;

  constructor(options: HallCashWithdrawalCapServiceOptions) {
    if (!options.pool) {
      throw new DomainError(
        "INVALID_CONFIG",
        "HallCashWithdrawalCapService krever en pg.Pool."
      );
    }
    this.pool = options.pool;
    const schema = assertSchemaName(options.schema ?? "public");
    this.tableQualified = `"${schema}"."app_hall_cash_withdrawals_daily"`;
  }

  /**
   * Returnér gjenstående cap-budget i øre for `hallId` på dagen avgjort
   * av `nowMs` (Oslo-tz).
   *
   * Hvis ingen rad finnes for dagen → returnerer hele cap (50 000 kr).
   * Aldri negativ — clampes til 0 hvis bucketen allerede er over (skal
   * ikke kunne skje, men defensiv).
   */
  async getRemainingCapCents(hallId: string, nowMs: number): Promise<number> {
    const id = assertHallId(hallId);
    const businessDate = businessDateFromMs(nowMs);

    const { rows } = await this.pool.query<DailyTotalRow>(
      `SELECT total_amount_cents, count
       FROM ${this.tableQualified}
       WHERE hall_id = $1 AND business_date = $2::date`,
      [id, businessDate]
    );
    const used = rows[0] ? toNumber(rows[0].total_amount_cents) : 0;
    const remaining = CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS - used;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Kaster `DomainError("CASH_WITHDRAW_CAP_EXCEEDED", ...)` hvis den
   * forespurte `amountCents` ikke får plass innenfor dagens cap for
   * `hallId`.
   *
   * NB: Dette er en pre-flight check. Selve cap-reservasjonen skjer i
   * `recordWithdrawal`, som er race-trygg. Kombinasjonen `assert` →
   * `wallet.debit` → `record` lar wallet-debit kjøre kun når det er
   * trygt, og record reverserer ikke wallet hvis cap-en blir spist
   * av en konkurrent — caller må da rulle tilbake transaksjonen
   * eller credit'e tilbake.
   *
   * `details` på errorer inkluderer:
   *   - requestedAmountCents
   *   - remainingCapCents
   *   - capCents (50 000 kr * 100)
   *   - businessDate (YYYY-MM-DD i Oslo-tz)
   *   - hallId
   */
  async assertWithinCap(
    hallId: string,
    amountCents: number,
    nowMs: number
  ): Promise<void> {
    const id = assertHallId(hallId);
    const amt = assertPositiveAmountCents(amountCents);
    const businessDate = businessDateFromMs(nowMs);

    const remaining = await this.getRemainingCapCents(id, nowMs);
    if (amt > remaining) {
      throw new DomainError(
        "CASH_WITHDRAW_CAP_EXCEEDED",
        `Daglig kontant-utbetaling-grense for hall ${id} er nådd. Forespurt ${amt / 100} kr, gjenstår ${remaining / 100} kr.`,
        {
          hallId: id,
          businessDate,
          requestedAmountCents: amt,
          remainingCapCents: remaining,
          capCents: CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS,
        }
      );
    }
  }

  /**
   * Atomisk: øk daglig totalsum + count for `hallId` på `nowMs`-dato,
   * forutsatt at cap ikke overskrides. Returnerer ny gjenstående cap
   * etter increment.
   *
   * Race-trygt: bruker `INSERT ... ON CONFLICT ... DO UPDATE` med
   * cap-sjekk i WHERE-klausulen. Ved race der to concurrent inserts
   * begge ville få plass før, men kun én etter, vil exact-once update
   * lykkes — den tapende ser ingen endrede rader og får
   * `CASH_WITHDRAW_CAP_EXCEEDED`.
   *
   * Idempotens: caller MÅ ikke kalle denne to ganger for samme uttak
   * (det vil dobbel-telle). Dette ansvaret ligger i caller — typisk
   * via en idempotency-key i payment-request-flyten.
   */
  async recordWithdrawal(
    hallId: string,
    amountCents: number,
    nowMs: number
  ): Promise<void> {
    const id = assertHallId(hallId);
    const amt = assertPositiveAmountCents(amountCents);
    const businessDate = businessDateFromMs(nowMs);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Atomisk insert-or-update med cap-sjekk i WHERE. Dette er én
      // SQL-statement — Postgres tar en row-level lock automatisk på
      // en eksisterende rad, og to konkurrerende calls vil serialiseres.
      // Den tapende calleren (hvis cap-en akkurat ble fylt) får
      // 0 affected rows og kastes.
      const cap = CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS;
      const result = await client.query<DailyTotalRow>(
        `INSERT INTO ${this.tableQualified}
           (hall_id, business_date, total_amount_cents, count, updated_at)
         VALUES ($1, $2::date, $3, 1, now())
         ON CONFLICT (hall_id, business_date) DO UPDATE
            SET total_amount_cents =
                  ${this.tableQualified}.total_amount_cents + EXCLUDED.total_amount_cents,
                count = ${this.tableQualified}.count + 1,
                updated_at = now()
            WHERE ${this.tableQualified}.total_amount_cents + EXCLUDED.total_amount_cents <= $4
         RETURNING total_amount_cents, count`,
        [id, businessDate, amt, cap]
      );

      // To scenarier kan gi 0 rows:
      //   1. INSERT lyktes, men `RETURNING` på fersk rad er fortsatt 1 row.
      //   2. ON CONFLICT WHERE-claus mislyktes (cap nådd) → 0 rows.
      // Fersk rad bør alltid passere fordi `amt` ble validert i assertWithinCap.
      // Men: ekstrem-edge-case der `amt > cap` på en helt fersk rad ville
      // også gi 0 rows hvis vi hadde WHERE på INSERT-grenen. Vi har det
      // bare på UPDATE-grenen, så fersk-rad-tilfellet validerer mot at
      // amt ikke overskrider cap alene. Defensiv check:
      if (amt > cap) {
        await client.query("ROLLBACK");
        throw new DomainError(
          "CASH_WITHDRAW_CAP_EXCEEDED",
          `Forespurt beløp ${amt / 100} kr overskrider daglig cap-grense ${cap / 100} kr.`,
          {
            hallId: id,
            businessDate,
            requestedAmountCents: amt,
            capCents: cap,
          }
        );
      }

      if (result.rowCount === 0) {
        // ON CONFLICT WHERE filtered ut → cap er fylt opp av konkurrent.
        await client.query("ROLLBACK");
        // Hent nåværende state så vi kan returnere riktig remainingCapCents.
        const { rows } = await this.pool.query<DailyTotalRow>(
          `SELECT total_amount_cents, count
           FROM ${this.tableQualified}
           WHERE hall_id = $1 AND business_date = $2::date`,
          [id, businessDate]
        );
        const used = rows[0] ? toNumber(rows[0].total_amount_cents) : 0;
        const remaining = cap - used;
        throw new DomainError(
          "CASH_WITHDRAW_CAP_EXCEEDED",
          `Daglig kontant-utbetaling-grense for hall ${id} ble fylt opp før denne forespørselen ble registrert. Forespurt ${amt / 100} kr, gjenstår ${(remaining > 0 ? remaining : 0) / 100} kr.`,
          {
            hallId: id,
            businessDate,
            requestedAmountCents: amt,
            remainingCapCents: remaining > 0 ? remaining : 0,
            capCents: cap,
          }
        );
      }

      await client.query("COMMIT");
      const row = result.rows[0];
      log.info(
        {
          hallId: id,
          businessDate,
          amountCents: amt,
          newTotalCents: row ? toNumber(row.total_amount_cents) : amt,
          newCount: row ? toNumber(row.count) : 1,
        },
        "[BIR-036] kontant-utbetaling-cap akkumulert"
      );
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore — already rolled back or in failed state
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
