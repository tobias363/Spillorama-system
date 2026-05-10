/**
 * Jackpot-modal: master-flow-2026-05-10 (Tobias-direktiv).
 *
 * Daglig-akkumulert jackpot-confirm-popup. Vises når master klikker
 * "Start neste spill" og backend rapporterer at den daglige jackpot-potten
 * må bekreftes (DomainError "JACKPOT_CONFIRM_REQUIRED").
 *
 * Forskjell fra `JackpotSetupModal`:
 *   - JackpotSetupModal:   master setter draw + prizes per bongfarge for
 *                          en spesifikk plan-posisjon (catalog-entry har
 *                          `requiresJackpotSetup=true`).
 *   - JackpotConfirmModal: master bekrefter den daglig-akkumulerte potten
 *                          (Spill 1-jackpott som +4000/dag, max 30000).
 *                          Master endrer ingen verdier — beløpet er auto-
 *                          akkumulert av cron + game-end-rewards.
 *
 * Caller-mønster:
 *   try {
 *     await startMaster(hallId);
 *   } catch (err) {
 *     if (err instanceof ApiError && err.code === "JACKPOT_CONFIRM_REQUIRED") {
 *       const jackpot = extractJackpotFromError(err);
 *       const confirmed = await openJackpotConfirmModal(jackpot);
 *       if (confirmed) await startMaster(hallId, true); // jackpotConfirmed=true
 *     }
 *   }
 *
 * Speiler `Game1MasterConsole.openJackpotConfirmPopup` slik at master-
 * agent får samme visning fra cash-inout-dashboardet og master-konsollet.
 */

import { Modal } from "../../components/Modal.js";
import type { ApiError } from "../../api/client.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

/**
 * Snapshot av jackpot-state hentet fra backend-error-detail. Speiler
 * `Game1JackpotState`-shape i `apps/backend/src/game/Game1JackpotStateService.ts`
 * uten last-accumulation-date (som ikke er nødvendig for confirm-popup).
 */
export interface JackpotConfirmData {
  /** Nåværende jackpot-pott i øre. */
  currentAmountCents: number;
  /** Maks-grense (default 30 000 kr = 3_000_000 øre). */
  maxCapCents: number;
  /** Daglig økning (default 4000 kr = 400_000 øre). */
  dailyIncrementCents: number;
  /** Trekk-thresholds hvor jackpot kan vinnes (default [50, 55, 56, 57]). */
  drawThresholds: number[];
}

/**
 * Hent jackpot-data fra `JACKPOT_CONFIRM_REQUIRED`-error.
 * Backend-detail (Game1MasterControlService.ts:455-461):
 *   {
 *     jackpotAmountCents: number,
 *     maxCapCents: number,
 *     dailyIncrementCents: number,
 *     drawThresholds: number[],
 *     hallGroupId: string,
 *   }
 *
 * Defensiv parsing — hvis backend ikke inkluderer alle felter (legacy-
 * respons), returnerer null og caller kan bruke fallback eller annullere.
 */
export function extractJackpotConfirmData(
  err: ApiError,
): JackpotConfirmData | null {
  const d = err.details;
  if (!d) return null;
  const amount = Number(d.jackpotAmountCents);
  if (!Number.isFinite(amount)) return null;
  const cap = Number(d.maxCapCents);
  const incr = Number(d.dailyIncrementCents);
  const thresholdsRaw = Array.isArray(d.drawThresholds) ? d.drawThresholds : [];
  const thresholds: number[] = [];
  for (const v of thresholdsRaw) {
    // Skip null/undefined/boolean så `Number(null) → 0`-edge-case ikke
    // forurenser threshold-listen med 0 hvis backend sender null per
    // mistakelse. Akseptér kun number eller numerisk string.
    if (v === null || v === undefined || typeof v === "boolean") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) thresholds.push(n);
  }
  return {
    currentAmountCents: amount,
    maxCapCents: Number.isFinite(cap) ? cap : 3_000_000,
    dailyIncrementCents: Number.isFinite(incr) ? incr : 400_000,
    drawThresholds: thresholds.length > 0 ? thresholds : [50, 55, 56, 57],
  };
}

/** Format øre → "24 560 kr" med norsk tusen-separator. */
function formatCentsAsNok(cents: number): string {
  const nok = Math.round(cents / 100);
  return `${nok.toLocaleString("nb-NO")} kr`;
}

/**
 * Vis confirm-popup for daglig-akkumulert jackpot. Returnerer Promise som
 * resolverer med `true` hvis master klikker "Start med jackpot", `false`
 * hvis master avbryter (knapp, ESC, eller backdrop-klikk).
 *
 * Modal er `backdrop: "static"` slik at klikk utenfor IKKE lukker — master
 * må eksplisitt velge bekreft eller avbryt. Forhindrer utilsiktet start
 * når master prøver å vurdere beløpet.
 */
export function openJackpotConfirmModal(
  data: JackpotConfirmData | null,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const settle = (value: boolean): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const body = document.createElement("div");
    body.setAttribute("data-marker", "spill1-jackpot-confirm-body");
    body.setAttribute("data-testid", "jackpot-confirm-modal-body");
    body.innerHTML = renderJackpotConfirmContent(data);

    Modal.open({
      title: "Bekreft jackpot-start",
      content: body,
      size: "sm",
      backdrop: "static",
      keyboard: true,
      className: "modal-jackpot-confirm",
      buttons: [
        {
          label: "Avbryt",
          variant: "default",
          action: "cancel",
          onClick: () => settle(false),
        },
        {
          label: "Start med jackpot",
          variant: "success",
          action: "confirm",
          onClick: () => settle(true),
        },
      ],
      onClose: () => settle(false),
    });
  });
}

/**
 * Bygg modal-body HTML. Eksponert separat slik at tester kan verifisere
 * render-output uten å åpne modal-en.
 */
export function renderJackpotConfirmContent(
  data: JackpotConfirmData | null,
): string {
  if (!data) {
    return `
      <p data-testid="jackpot-confirm-no-state">
        Jackpot-state kunne ikke lastes. Start likevel?
      </p>
    `;
  }
  const amountKr = formatCentsAsNok(data.currentAmountCents);
  const capKr = formatCentsAsNok(data.maxCapCents);
  const incrKr = formatCentsAsNok(data.dailyIncrementCents);
  const thresholds = data.drawThresholds.join(", ");
  return `
    <div data-testid="jackpot-confirm-state">
      <div style="text-align:center;padding:16px 0;background:#fff3cd;border:1px solid #f0ad4e;border-radius:4px;margin-bottom:16px;">
        <div style="font-size:12px;color:#8a6d3b;">Jackpott</div>
        <div data-testid="jackpot-confirm-amount" style="font-size:28px;font-weight:bold;color:#8a6d3b;">
          ${escapeHtml(amountKr)}
        </div>
      </div>
      <table class="table table-condensed" style="margin-bottom:12px;">
        <tbody>
          <tr>
            <td style="width:50%;">Maks-grense</td>
            <td><strong>${escapeHtml(capKr)}</strong></td>
          </tr>
          <tr>
            <td>Daglig økning</td>
            <td>${escapeHtml(incrKr)}</td>
          </tr>
          <tr>
            <td>Trekk-thresholds</td>
            <td data-testid="jackpot-confirm-thresholds"><code>${escapeHtml(thresholds)}</code></td>
          </tr>
        </tbody>
      </table>
      <p class="text-muted" style="font-size:13px;">
        Når du starter spillet gjelder nåværende jackpot-pott for dagens runder.
        Bekreft at beløpet er korrekt før du fortsetter.
      </p>
    </div>
  `;
}
