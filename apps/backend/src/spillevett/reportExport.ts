import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import { DomainError } from "../game/BingoEngine.js";
import type { PlayerReport } from "./playerReport.js";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("nb-NO", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function formatGameType(gameType: string): string {
  return gameType === "MAIN_GAME" ? "Hovedspill" : "Databingo";
}

function formatChannel(channel: string): string {
  return channel === "HALL" ? "Hall" : "Internett";
}

function fit(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function ensureSpace(doc: PDFKit.PDFDocument, required = 36): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + required <= bottom) {
    return;
  }
  doc.addPage();
}

function writeSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 28);
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#123a36").text(title);
  doc.moveDown(0.25);
}

function writeMonospaceRow(doc: PDFKit.PDFDocument, row: string): void {
  ensureSpace(doc, 16);
  doc.font("Courier").fontSize(9).fillColor("#213c3a").text(row, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right
  });
}

export async function generatePlayerReportPdf(input: {
  report: PlayerReport;
  playerName: string;
  playerEmail: string;
}): Promise<Buffer> {
  const doc = new PDFDocument({
    margin: 48,
    size: "A4",
    info: {
      Title: "Spillregnskap",
      Author: "Spillorama",
      Subject: "Spillregnskap for spiller"
    }
  });

  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#133631").text("Spillregnskap");
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10).fillColor("#31514d").text(
    `Spiller: ${input.playerName} (${input.playerEmail})`
  );
  doc.text(`Periode: ${input.report.range.label}`);
  doc.text(`Generert: ${formatDateTime(input.report.generatedAt)}`);
  doc.text(`Hallfilter: ${input.report.hallName || "Alle haller"}`);

  writeSectionTitle(doc, "Oppsummering");
  doc.font("Helvetica").fontSize(10).fillColor("#213c3a");
  doc.text(`Innsats: ${formatCurrency(input.report.summary.stakeTotal)} kr`);
  doc.text(`Premier: ${formatCurrency(input.report.summary.prizeTotal)} kr`);
  doc.text(`Netto resultat: ${formatCurrency(input.report.summary.netResult)} kr`);
  doc.text(`Antall spill: ${input.report.summary.totalPlays}`);
  doc.text(`Antall bokførte hendelser: ${input.report.summary.totalEvents}`);

  writeSectionTitle(doc, "Oversikt per hall og spill");
  writeMonospaceRow(
    doc,
    "Hall".padEnd(22) +
      "Spill".padEnd(14) +
      "Kanal".padEnd(12) +
      "Innsats".padStart(12) +
      "Premier".padStart(12) +
      "Netto".padStart(12)
  );
  writeMonospaceRow(doc, "-".repeat(84));
  if (!input.report.breakdown.length) {
    doc.font("Helvetica").fontSize(10).text("Ingen spill registrert i valgt periode.");
  } else {
    for (const row of input.report.breakdown) {
      writeMonospaceRow(
        doc,
        fit(row.hallName, 22).padEnd(22) +
          fit(formatGameType(row.gameType), 14).padEnd(14) +
          fit(formatChannel(row.channel), 12).padEnd(12) +
          formatCurrency(row.stakeTotal).padStart(12) +
          formatCurrency(row.prizeTotal).padStart(12) +
          formatCurrency(row.netResult).padStart(12)
      );
    }
  }

  writeSectionTitle(doc, "Detaljerte spill");
  if (!input.report.plays.length) {
    doc.font("Helvetica").fontSize(10).text("Ingen spill å vise.");
  } else {
    for (const play of input.report.plays) {
      ensureSpace(doc, 54);
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#173c37")
        .text(`${play.hallName} • ${formatGameType(play.gameType)} • ${formatChannel(play.channel)}`);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#31514d")
        .text(
          `Spill-ID: ${play.roomCode || play.gameId || play.playId} | Start: ${formatDateTime(play.startedAt)} | Siste aktivitet: ${formatDateTime(play.lastActivityAt)}`
        );
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#213c3a")
        .text(
          `Innsats ${formatCurrency(play.stakeTotal)} kr   Premier ${formatCurrency(play.prizeTotal)} kr   Netto ${formatCurrency(play.netResult)} kr`
        );
    }
  }

  writeSectionTitle(doc, "Siste bokførte hendelser");
  writeMonospaceRow(
    doc,
    "Tidspunkt".padEnd(19) +
      "Hall".padEnd(18) +
      "Spill".padEnd(12) +
      "Hendelse".padEnd(14) +
      "Beløp".padStart(12)
  );
  writeMonospaceRow(doc, "-".repeat(75));
  if (!input.report.events.length) {
    doc.font("Helvetica").fontSize(10).text("Ingen bokførte hendelser å vise.");
  } else {
    for (const event of input.report.events) {
      writeMonospaceRow(
        doc,
        fit(formatDateTime(event.createdAt), 19).padEnd(19) +
          fit(event.hallName, 18).padEnd(18) +
          fit(formatGameType(event.gameType), 12).padEnd(12) +
          fit(event.eventType, 14).padEnd(14) +
          formatCurrency(event.amount).padStart(12)
      );
    }
  }

  doc.end();
  return finished;
}

function createMailTransport() {
  const smtpUrl = (process.env.REPORT_EXPORT_SMTP_URL ?? "").trim();
  if (smtpUrl) {
    return nodemailer.createTransport(smtpUrl);
  }

  const host = (process.env.REPORT_EXPORT_SMTP_HOST ?? "").trim();
  const portRaw = (process.env.REPORT_EXPORT_SMTP_PORT ?? "").trim();
  if (!host || !portRaw) {
    throw new DomainError(
      "EMAIL_NOT_CONFIGURED",
      "SMTP er ikke konfigurert. Sett REPORT_EXPORT_SMTP_URL eller REPORT_EXPORT_SMTP_HOST/PORT."
    );
  }

  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new DomainError("EMAIL_NOT_CONFIGURED", "REPORT_EXPORT_SMTP_PORT må være et gyldig tall.");
  }

  const secure = ["1", "true", "yes", "on"].includes((process.env.REPORT_EXPORT_SMTP_SECURE ?? "").trim().toLowerCase());
  const user = (process.env.REPORT_EXPORT_SMTP_USER ?? "").trim();
  const pass = (process.env.REPORT_EXPORT_SMTP_PASS ?? "").trim();

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined
  });
}

export async function emailPlayerReport(input: {
  report: PlayerReport;
  playerName: string;
  playerEmail: string;
  recipientEmail: string;
  pdf: Buffer;
}): Promise<{ recipientEmail: string }> {
  const from = (process.env.REPORT_EXPORT_EMAIL_FROM ?? "").trim();
  if (!from) {
    throw new DomainError("EMAIL_NOT_CONFIGURED", "REPORT_EXPORT_EMAIL_FROM må settes for å sende e-post.");
  }

  const transporter = createMailTransport();
  const subject = `Spillregnskap (${input.report.range.label})`;
  const body = [
    `Hei ${input.playerName},`,
    "",
    "Vedlagt finner du detaljert spillregnskap fra Spillorama.",
    `Periode: ${input.report.range.label}`,
    `Hallfilter: ${input.report.hallName || "Alle haller"}`,
    "",
    `Innsats: ${formatCurrency(input.report.summary.stakeTotal)} kr`,
    `Premier: ${formatCurrency(input.report.summary.prizeTotal)} kr`,
    `Netto resultat: ${formatCurrency(input.report.summary.netResult)} kr`,
    "",
    "Denne e-posten ble generert automatisk."
  ].join("\n");

  await transporter.sendMail({
    from,
    to: input.recipientEmail,
    subject,
    text: body,
    attachments: [
      {
        filename: "spillregnskap.pdf",
        content: input.pdf,
        contentType: "application/pdf"
      }
    ]
  });

  return { recipientEmail: input.recipientEmail };
}
