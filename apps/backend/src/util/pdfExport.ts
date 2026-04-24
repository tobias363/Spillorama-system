/**
 * BIN-588: shared PDF helpers + generic admin/report exports.
 *
 * Complements the existing spillevett-specific generator in
 * `spillevett/reportExport.ts` (BIN-272) with three broader exports
 * needed for feature-parity with legacy:
 *
 *   - generateTransactionReceiptPdf  (per-user wallet transaction print)
 *   - generatePlayerHistoryPdf       (summary of a player's play across halls)
 *   - generateDailyCashSettlementPdf (operator daily settlement —
 *                                    input shape matches what the
 *                                    BIN-583 agent domain will expose)
 *
 * Each export returns a `Buffer`. The low-level helpers (`ensureSpace`,
 * `writeSectionTitle`, `writeMonospaceRow`, `formatCurrency`,
 * `formatDateTime`) are exported so future ports can reuse them without
 * duplicating the style once more.
 */

import PDFDocument from "pdfkit";

// ── Low-level formatting helpers ───────────────────────────────────────────

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "0,00";
  return new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("nb-NO", { dateStyle: "short" });
}

export function fit(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function ensureSpace(doc: PDFKit.PDFDocument, required = 36): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + required <= bottom) return;
  doc.addPage();
}

export function writeSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 28);
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#123a36").text(title);
  doc.moveDown(0.25);
}

export function writeMonospaceRow(doc: PDFKit.PDFDocument, row: string): void {
  ensureSpace(doc, 16);
  doc.font("Courier").fontSize(9).fillColor("#213c3a").text(row, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  });
}

/** Collect `doc.on("data")` chunks into a single Buffer when the doc ends. */
export async function finalizeDocument(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.end();
  return finished;
}

// ── Transaction receipt per user ───────────────────────────────────────────

export interface TransactionRow {
  id: string;
  createdAt: string | Date;
  type: string; // DEPOSIT | WITHDRAW | STAKE | PAYOUT | ADJUSTMENT | ...
  amount: number;
  reason: string;
  relatedAccountId?: string | null;
}

export interface TransactionReceiptInput {
  playerId: string;
  playerName: string;
  playerEmail: string | null;
  rangeLabel: string; // e.g. "April 2026", "2026-04-01 – 2026-04-18"
  generatedAt: string | Date;
  openingBalance: number;
  closingBalance: number;
  transactions: readonly TransactionRow[];
}

/**
 * Per-user wallet-transaction print. Legacy: individual "print
 * transactions" button on the player detail page. Used for support
 * tickets and compliance requests.
 */
export async function generateTransactionReceiptPdf(input: TransactionReceiptInput): Promise<Buffer> {
  const doc = new PDFDocument({
    margin: 48,
    size: "A4",
    info: {
      Title: "Kontoutskrift",
      Author: "Spillorama",
      Subject: `Kontoutskrift for ${input.playerName}`,
    },
  });

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#133631").text("Kontoutskrift");
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10).fillColor("#31514d");
  doc.text(`Spiller: ${input.playerName}${input.playerEmail ? ` (${input.playerEmail})` : ""}`);
  doc.text(`Spiller-ID: ${input.playerId}`);
  doc.text(`Periode: ${input.rangeLabel}`);
  doc.text(`Generert: ${formatDateTime(input.generatedAt)}`);

  writeSectionTitle(doc, "Saldo");
  doc.font("Helvetica").fontSize(10).fillColor("#213c3a");
  doc.text(`Inngående saldo: ${formatCurrency(input.openingBalance)} kr`);
  doc.text(`Utgående saldo: ${formatCurrency(input.closingBalance)} kr`);
  const net = input.closingBalance - input.openingBalance;
  doc.text(`Endring: ${net >= 0 ? "+" : ""}${formatCurrency(net)} kr`);

  writeSectionTitle(doc, "Transaksjoner");
  writeMonospaceRow(
    doc,
    "Tidspunkt".padEnd(17) +
      "Type".padEnd(12) +
      "Beløp".padStart(12) +
      "  " +
      "Beskrivelse",
  );
  writeMonospaceRow(doc, "-".repeat(80));
  if (!input.transactions.length) {
    doc.font("Helvetica").fontSize(10).text("Ingen transaksjoner i valgt periode.");
  } else {
    for (const tx of input.transactions) {
      writeMonospaceRow(
        doc,
        fit(formatDateTime(tx.createdAt), 17).padEnd(17) +
          fit(tx.type, 12).padEnd(12) +
          formatCurrency(tx.amount).padStart(12) +
          "  " +
          fit(tx.reason ?? "", 46),
      );
    }
  }

  return finalizeDocument(doc);
}

// ── Player history summary ─────────────────────────────────────────────────

export interface PlayerHistoryHallSummary {
  hallId: string;
  hallName: string;
  sessions: number;
  stakeTotal: number;
  prizeTotal: number;
  netResult: number;
  lastPlayAt: string | Date | null;
}

export interface PlayerHistoryInput {
  playerId: string;
  playerName: string;
  playerEmail: string | null;
  rangeLabel: string;
  generatedAt: string | Date;
  totals: {
    stakeTotal: number;
    prizeTotal: number;
    netResult: number;
    sessions: number;
  };
  halls: readonly PlayerHistoryHallSummary[];
}

/**
 * Broad player-history summary used by admin/support when a player
 * requests a historical overview that isn't tied to the spillvett
 * regulation (which has its own detailed export in
 * `spillevett/reportExport.ts`).
 */
export async function generatePlayerHistoryPdf(input: PlayerHistoryInput): Promise<Buffer> {
  const doc = new PDFDocument({
    margin: 48,
    size: "A4",
    info: {
      Title: "Spillerhistorikk",
      Author: "Spillorama",
      Subject: `Historikk for ${input.playerName}`,
    },
  });

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#133631").text("Spillerhistorikk");
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10).fillColor("#31514d");
  doc.text(`Spiller: ${input.playerName}${input.playerEmail ? ` (${input.playerEmail})` : ""}`);
  doc.text(`Spiller-ID: ${input.playerId}`);
  doc.text(`Periode: ${input.rangeLabel}`);
  doc.text(`Generert: ${formatDateTime(input.generatedAt)}`);

  writeSectionTitle(doc, "Totalt");
  doc.font("Helvetica").fontSize(10).fillColor("#213c3a");
  doc.text(`Innsats: ${formatCurrency(input.totals.stakeTotal)} kr`);
  doc.text(`Premier: ${formatCurrency(input.totals.prizeTotal)} kr`);
  doc.text(`Netto: ${formatCurrency(input.totals.netResult)} kr`);
  doc.text(`Antall økter: ${input.totals.sessions}`);

  writeSectionTitle(doc, "Fordeling per hall");
  writeMonospaceRow(
    doc,
    "Hall".padEnd(26) +
      "Økter".padStart(7) +
      "Innsats".padStart(12) +
      "Premier".padStart(12) +
      "Netto".padStart(12) +
      "  " +
      "Siste spill",
  );
  writeMonospaceRow(doc, "-".repeat(90));
  if (!input.halls.length) {
    doc.font("Helvetica").fontSize(10).text("Ingen spill registrert i valgt periode.");
  } else {
    for (const hall of input.halls) {
      writeMonospaceRow(
        doc,
        fit(hall.hallName, 26).padEnd(26) +
          String(hall.sessions).padStart(7) +
          formatCurrency(hall.stakeTotal).padStart(12) +
          formatCurrency(hall.prizeTotal).padStart(12) +
          formatCurrency(hall.netResult).padStart(12) +
          "  " +
          fit(formatDate(hall.lastPlayAt), 12),
      );
    }
  }

  return finalizeDocument(doc);
}

// ── Daily cash settlement ──────────────────────────────────────────────────

export interface SettlementLineItem {
  label: string;
  amount: number;
}

export interface SettlementHallSection {
  hallId: string;
  hallName: string;
  cashIn: number;
  cashOut: number;
  net: number;
  lineItems: readonly SettlementLineItem[];
}

/** Wireframe Gap #2: 15-rad maskin/kategori-breakdown til PDF. */
export interface SettlementBreakdownRow {
  label: string;
  inAmount: number;
  outAmount: number;
}

/** Wireframe Gap #2: bilag-metadata i PDF (faktisk binær hentes separat). */
export interface SettlementBilagMeta {
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface DailyCashSettlementInput {
  /** Operating day (end-of-day snapshot). */
  businessDate: string | Date;
  generatedAt: string | Date;
  generatedBy: string;
  /**
   * Per-hall detail. Populated by the agent domain (BIN-583); for
   * today's PR a caller can pass a stub list and the generator will
   * still emit a valid PDF.
   */
  halls: readonly SettlementHallSection[];
  totals: {
    cashIn: number;
    cashOut: number;
    net: number;
  };
  /** Optional signature slot for the operator. */
  signatoryName?: string | null;
  /** Wireframe Gap #2: 15-rad maskin/kategori-breakdown (IN/OUT/Sum). */
  breakdownRows?: readonly SettlementBreakdownRow[];
  /** Wireframe Gap #2: bilag-metadata (filnavn, mime, størrelse). */
  bilagMeta?: SettlementBilagMeta | null;
  /** Wireframe Gap #2: admin-edit audit-info (editedBy/editedAt/reason). */
  editAudit?: {
    editedByName: string;
    editedAt: string;
    reason: string;
  } | null;
}

/**
 * Daily cash settlement — the A4 sheet the hall operator prints,
 * signs, and files at end of day. Legacy printed this as a client-side
 * pdfmake page; we render it server-side so the same document can be
 * e-mailed + archived consistently.
 */
export async function generateDailyCashSettlementPdf(input: DailyCashSettlementInput): Promise<Buffer> {
  const doc = new PDFDocument({
    margin: 48,
    size: "A4",
    info: {
      Title: "Dagsoppgjør",
      Author: "Spillorama",
      Subject: `Dagsoppgjør ${formatDate(input.businessDate)}`,
    },
  });

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#133631").text("Dagsoppgjør");
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10).fillColor("#31514d");
  doc.text(`Dato: ${formatDate(input.businessDate)}`);
  doc.text(`Generert: ${formatDateTime(input.generatedAt)} av ${input.generatedBy}`);

  writeSectionTitle(doc, "Sum alle haller");
  doc.font("Helvetica").fontSize(10).fillColor("#213c3a");
  doc.text(`Kontanter inn: ${formatCurrency(input.totals.cashIn)} kr`);
  doc.text(`Kontanter ut:  ${formatCurrency(input.totals.cashOut)} kr`);
  doc.text(`Netto:         ${input.totals.net >= 0 ? "+" : ""}${formatCurrency(input.totals.net)} kr`);

  for (const hall of input.halls) {
    writeSectionTitle(doc, `Hall: ${hall.hallName}`);
    doc.font("Helvetica").fontSize(10).fillColor("#213c3a");
    doc.text(`Kontanter inn: ${formatCurrency(hall.cashIn)} kr`);
    doc.text(`Kontanter ut:  ${formatCurrency(hall.cashOut)} kr`);
    doc.text(`Netto:         ${hall.net >= 0 ? "+" : ""}${formatCurrency(hall.net)} kr`);
    if (hall.lineItems.length) {
      doc.moveDown(0.3);
      writeMonospaceRow(doc, "Post".padEnd(40) + "Beløp".padStart(14));
      writeMonospaceRow(doc, "-".repeat(55));
      for (const item of hall.lineItems) {
        writeMonospaceRow(
          doc,
          fit(item.label, 40).padEnd(40) + formatCurrency(item.amount).padStart(14),
        );
      }
    }
  }

  // Wireframe Gap #2: 15-rad maskin-breakdown (hvis tilgjengelig)
  if (input.breakdownRows && input.breakdownRows.length > 0) {
    writeSectionTitle(doc, "Maskin-breakdown (15 rader)");
    doc.font("Helvetica").fontSize(10).fillColor("#213c3a");
    writeMonospaceRow(
      doc,
      "Maskin".padEnd(26) +
        "IN".padStart(12) +
        "OUT".padStart(12) +
        "Sum".padStart(12),
    );
    writeMonospaceRow(doc, "-".repeat(62));
    let sumIn = 0;
    let sumOut = 0;
    for (const row of input.breakdownRows) {
      sumIn += row.inAmount;
      sumOut += row.outAmount;
      writeMonospaceRow(
        doc,
        fit(row.label, 26).padEnd(26) +
          formatCurrency(row.inAmount).padStart(12) +
          formatCurrency(row.outAmount).padStart(12) +
          formatCurrency(row.inAmount - row.outAmount).padStart(12),
      );
    }
    writeMonospaceRow(doc, "-".repeat(62));
    writeMonospaceRow(
      doc,
      "Total".padEnd(26) +
        formatCurrency(sumIn).padStart(12) +
        formatCurrency(sumOut).padStart(12) +
        formatCurrency(sumIn - sumOut).padStart(12),
    );
  }

  // Wireframe Gap #2: bilag-metadata
  if (input.bilagMeta) {
    writeSectionTitle(doc, "Bilag (opplastet kvittering)");
    doc.font("Helvetica").fontSize(10).fillColor("#213c3a");
    doc.text(`Filnavn: ${input.bilagMeta.filename}`);
    doc.text(`Filtype: ${input.bilagMeta.mime}`);
    doc.text(`Størrelse: ${Math.round(input.bilagMeta.sizeBytes / 1024)} KB`);
    doc.text(`Lastet opp: ${formatDateTime(input.bilagMeta.uploadedAt)}`);
  }

  // Wireframe Gap #2: admin-edit audit-info
  if (input.editAudit) {
    writeSectionTitle(doc, "Admin-redigering");
    doc.font("Helvetica").fontSize(10).fillColor("#b8550e");
    doc.text(`Redigert av: ${input.editAudit.editedByName}`);
    doc.text(`Tidspunkt: ${formatDateTime(input.editAudit.editedAt)}`);
    doc.text(`Grunn: ${input.editAudit.reason}`);
  }

  if (input.signatoryName) {
    doc.moveDown(2);
    writeMonospaceRow(doc, "Signatur: ____________________________");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).text(`${input.signatoryName}`);
  }

  return finalizeDocument(doc);
}
