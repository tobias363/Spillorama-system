/**
 * K1 settlement machine-breakdown — 1:1 legacy-paritet med wireframes
 * (PDF 13 §13.5 + PDF 15 §15.8).
 *
 * Beløp lagres som **øre (integer)** for å unngå float-feil (NUMERIC(14,2)
 * i NOK-kolonner er bra, men JSONB-tall er dobbel-presisjons-float i PG).
 * 1 NOK = 100 øre. Max 2^53 ≈ 90 trillion NOK — trygt for vår bruk.
 *
 * Alle 15 rader speiles eksakt fra wireframe. `machine_key` brukes som
 * JSONB-nøkkel for å støtte SUM-queries per maskin-type.
 */

/** De 15 kanoniske maskin-radene fra wireframe. */
export type MachineRowKey =
  | "metronia"
  | "ok_bingo"
  | "franco"
  | "otium"                    // wireframe har legacy-stavefeil "Olsun"
  | "norsk_tipping_dag"
  | "norsk_tipping_totall"
  | "rikstoto_dag"             // wireframe: "Norsk Rikssloto Dag"
  | "rikstoto_totall"
  | "rekvisita"                // wireframe: "Rakislatta (Propa)"
  | "servering"                // wireframe: "Serving/kaffe/prenger"
  | "bilag"                    // wireframe: "Sdag (receipt)"
  | "bank"
  | "gevinst_overfoering_bank" // wireframe: "Gevind overflering bank"
  | "annet";
// Merk: 15. rad er "Total" — beregnes på klient, ikke lagret som rad.

/** Alle 14 lagrede maskin-nøkler (Total = sum av disse). */
export const MACHINE_ROW_KEYS: readonly MachineRowKey[] = [
  "metronia",
  "ok_bingo",
  "franco",
  "otium",
  "norsk_tipping_dag",
  "norsk_tipping_totall",
  "rikstoto_dag",
  "rikstoto_totall",
  "rekvisita",
  "servering",
  "bilag",
  "bank",
  "gevinst_overfoering_bank",
  "annet",
] as const;

/** Per-rad beløp. Sum beregnes på-fly (in_cents - out_cents). */
export interface MachineRow {
  in_cents: number;
  out_cents: number;
}

/**
 * Full breakdown — 14 rader pluss shift-delta-seksjon (5 felt).
 *
 * Shift-delta-seksjonen speiler wireframe 16.25 / 17.10 1:1:
 *   "Endring opptall kasse"-blokk:
 *     • Kasse start skift          (kasse_start_skift_cents)
 *     • Kasse endt skift før dropp (ending_opptall_kassie_cents)
 *     • Endring                    (= ending - start, beregnet)
 *   "Fordeling av endring opptall kasse på dropsafe og kasse"-blokk:
 *     • Innskudd dropsafe          (innskudd_drop_safe_cents)
 *     • Påfyll/ut kasse            (paafyll_ut_kasse_cents)
 *     • Totalt dropsafe/påfyll     (totalt_dropsafe_paafyll_cents,
 *                                   = innskudd_drop_safe + paafyll_ut_kasse)
 *   • Difference in shifts         (difference_in_shifts_cents)
 *
 * Formula (wireframe 16.25):
 *   difference_in_shifts =
 *     (totalt_dropsafe_paafyll - endring) + endring - totalt_sum_kasse_fil
 *   Forenkling: difference = totalt_dropsafe_paafyll - totalt_sum_kasse_fil
 *
 *   `totalt_sum_kasse_fil` = sum(rows: in - out) — bordet maskin-totaler.
 *
 * `difference_in_shifts_cents` varsles i UI hvis > 10000 (100 NOK) pr
 * wireframe-regel ("Difference must be explained if > 100 NOK").
 *
 * Backwards compat: kasse_start_skift_cents og paafyll_ut_kasse_cents og
 * totalt_dropsafe_paafyll_cents er nye felt (K1-B). Validering aksepterer
 * mangler (default 0) for å støtte legacy-rader fra K1-A.
 */
export interface MachineBreakdown {
  rows: Partial<Record<MachineRowKey, MachineRow>>;
  /** Kasse-balanse ved skift-start (wireframe: "Kasse start skift"). K1-B. */
  kasse_start_skift_cents: number;
  /** Kasse-telling ved skift-slutt før dropp (wireframe: "Kasse endt skift før dropp"). */
  ending_opptall_kassie_cents: number;
  /** Innskudd til drop-safe (wireframe: "Innskudd droppaskile"). */
  innskudd_drop_safe_cents: number;
  /** Påfyll/ut av kasse — flytter penger inn/ut av kasse-skuffen. K1-B. */
  paafyll_ut_kasse_cents: number;
  /**
   * Totalt dropsafe + påfyll/ut kasse. Beregnes på klient (=innskudd + påfyll)
   * men lagres for å matche wireframe-skjema. Skal være lik Endring (= end - start)
   * i en korrekt utfylt rapport. K1-B.
   */
  totalt_dropsafe_paafyll_cents: number;
  /** Diff mellom shifts ved overlevering (wireframe: "Difference in shifts"). */
  difference_in_shifts_cents: number;
}

/**
 * Bilag (receipt) — lagret som base64 data-URL i JSONB.
 *
 * Valg av data-URL over ekstern blob-storage: MVP-pragmatisme. Vi har
 * ikke S3/Render-disk-infra enda, og index.ts tillater 15 MB body.
 * Max 10 MB håndheves i service (gir marginvbr for JSON-overhead).
 * Flyttes til ekstern storage i senere milestone (endringen er
 * bakoverkompatibel så lenge shape beholdes).
 */
export interface BilagReceipt {
  mime: "application/pdf" | "image/jpeg" | "image/png";
  filename: string;
  /** data:{mime};base64,{payload}. Max 10 MB dekodet. */
  dataUrl: string;
  sizeBytes: number;
  uploadedAt: string; // ISO-8601
  uploadedByUserId: string;
}

/** Maks størrelse på bilag (10 MB dekodet). */
export const MAX_BILAG_BYTES = 10 * 1024 * 1024;

/** Tillatt MIME-typer for bilag. */
export const ALLOWED_BILAG_MIME = new Set<BilagReceipt["mime"]>([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

/** Default tom breakdown — brukes ved første write om klient ikke sender. */
export function emptyMachineBreakdown(): MachineBreakdown {
  return {
    rows: {},
    kasse_start_skift_cents: 0,
    ending_opptall_kassie_cents: 0,
    innskudd_drop_safe_cents: 0,
    paafyll_ut_kasse_cents: 0,
    totalt_dropsafe_paafyll_cents: 0,
    difference_in_shifts_cents: 0,
  };
}

/**
 * Valider breakdown-input (runtime-sjekk på ukjent JSON fra wire).
 *
 * Kaster `Error` med fornuftig melding ved feil; kall-site wrap'er i
 * DomainError i service-laget.
 */
export function validateMachineBreakdown(input: unknown): MachineBreakdown {
  if (input === null || input === undefined) return emptyMachineBreakdown();
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("machineBreakdown må være et objekt.");
  }
  const obj = input as Record<string, unknown>;
  const rows: Partial<Record<MachineRowKey, MachineRow>> = {};
  if (obj.rows !== undefined && obj.rows !== null) {
    if (typeof obj.rows !== "object" || Array.isArray(obj.rows)) {
      throw new Error("machineBreakdown.rows må være et objekt.");
    }
    const rawRows = obj.rows as Record<string, unknown>;
    for (const [key, value] of Object.entries(rawRows)) {
      if (!MACHINE_ROW_KEYS.includes(key as MachineRowKey)) {
        throw new Error(`Ukjent maskin-nøkkel: ${key}`);
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Rad ${key}: må være { in_cents, out_cents }.`);
      }
      const row = value as Record<string, unknown>;
      const inC = row.in_cents;
      const outC = row.out_cents;
      if (!Number.isInteger(inC) || (inC as number) < 0) {
        throw new Error(`Rad ${key}: in_cents må være et ikke-negativt heltall.`);
      }
      if (!Number.isInteger(outC) || (outC as number) < 0) {
        throw new Error(`Rad ${key}: out_cents må være et ikke-negativt heltall.`);
      }
      rows[key as MachineRowKey] = {
        in_cents: inC as number,
        out_cents: outC as number,
      };
    }
  }
  const start = toNonNegativeInt(obj.kasse_start_skift_cents, "kasse_start_skift_cents");
  const ending = toNonNegativeInt(obj.ending_opptall_kassie_cents, "ending_opptall_kassie_cents");
  const drop = toNonNegativeInt(obj.innskudd_drop_safe_cents, "innskudd_drop_safe_cents");
  const paafyll = toInteger(obj.paafyll_ut_kasse_cents, "paafyll_ut_kasse_cents");
  const totaltDropsafe = toInteger(obj.totalt_dropsafe_paafyll_cents, "totalt_dropsafe_paafyll_cents");
  const diff = toInteger(obj.difference_in_shifts_cents, "difference_in_shifts_cents");
  return {
    rows,
    kasse_start_skift_cents: start,
    ending_opptall_kassie_cents: ending,
    innskudd_drop_safe_cents: drop,
    paafyll_ut_kasse_cents: paafyll,
    totalt_dropsafe_paafyll_cents: totaltDropsafe,
    difference_in_shifts_cents: diff,
  };
}

function toNonNegativeInt(value: unknown, field: string): number {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${field} må være et ikke-negativt heltall.`);
  }
  return value as number;
}

function toInteger(value: unknown, field: string): number {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value)) {
    throw new Error(`${field} må være et heltall.`);
  }
  return value as number;
}

/** Valider bilag-receipt. Kaster Error ved ugyldig input. */
export function validateBilagReceipt(input: unknown): BilagReceipt {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("bilagReceipt må være et objekt.");
  }
  const obj = input as Record<string, unknown>;
  const mime = obj.mime;
  if (typeof mime !== "string" || !ALLOWED_BILAG_MIME.has(mime as BilagReceipt["mime"])) {
    throw new Error("bilagReceipt.mime må være application/pdf, image/jpeg eller image/png.");
  }
  const filename = obj.filename;
  if (typeof filename !== "string" || !filename.trim()) {
    throw new Error("bilagReceipt.filename må være en ikke-tom streng.");
  }
  const dataUrl = obj.dataUrl;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(`data:${mime};base64,`)) {
    throw new Error("bilagReceipt.dataUrl må være en gyldig data:-URL som matcher mime.");
  }
  const sizeBytes = obj.sizeBytes;
  if (!Number.isInteger(sizeBytes) || (sizeBytes as number) <= 0) {
    throw new Error("bilagReceipt.sizeBytes må være et positivt heltall.");
  }
  if ((sizeBytes as number) > MAX_BILAG_BYTES) {
    throw new Error(`bilagReceipt.sizeBytes overskrider max (${MAX_BILAG_BYTES} bytes).`);
  }
  const uploadedAt = obj.uploadedAt;
  if (typeof uploadedAt !== "string") {
    throw new Error("bilagReceipt.uploadedAt må være ISO-8601-streng.");
  }
  const uploadedByUserId = obj.uploadedByUserId;
  if (typeof uploadedByUserId !== "string" || !uploadedByUserId.trim()) {
    throw new Error("bilagReceipt.uploadedByUserId påkrevd.");
  }
  return {
    mime: mime as BilagReceipt["mime"],
    filename: filename.trim().slice(0, 200),
    dataUrl,
    sizeBytes: sizeBytes as number,
    uploadedAt,
    uploadedByUserId,
  };
}

/** Beregn total IN/OUT/Sum (øre) av alle rader. */
export function computeBreakdownTotals(breakdown: MachineBreakdown): {
  totalInCents: number;
  totalOutCents: number;
  totalSumCents: number;
} {
  let totalIn = 0;
  let totalOut = 0;
  for (const key of MACHINE_ROW_KEYS) {
    const r = breakdown.rows[key];
    if (!r) continue;
    totalIn += r.in_cents;
    totalOut += r.out_cents;
  }
  return {
    totalInCents: totalIn,
    totalOutCents: totalOut,
    totalSumCents: totalIn - totalOut,
  };
}
