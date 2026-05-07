/**
 * Fase 3 (2026-05-07): Jackpot-setup-popup for spilleplan-runtime.
 *
 * Vises av master-dashbordet når et katalog-spill med
 * `requiresJackpotSetup=true` skal startes/avansseres til. Master legger
 * inn:
 *   - Hvilket trekk (1..MAX) som gir jackpot
 *   - Jackpot-gevinst per bongfarge (gul/hvit/lilla — kun de som er
 *     definert i catalog-entry.ticketColors)
 *
 * Beløp legges inn i kroner i UI, men sendes som ØRE i API-kallet for å
 * matche backend-konvensjon (alle prisfelt i øre — se
 * `apps/admin-web/src/api/admin-game-catalog.ts`).
 *
 * Caller: NextGamePanel + Spill1HallStatusBox når
 * `useNewGamePlan=true` og data fra
 * `/api/agent/game-plan/current.jackpotSetupRequired === true`.
 *
 * Backend-rute:
 *   POST /api/agent/game-plan/jackpot-setup
 *   body: { position, draw, prizesCents }
 */

import { Modal } from "../../components/Modal.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { setAgentGamePlanJackpot } from "../../api/agent-game-plan.js";
import type { TicketColor } from "../../api/admin-game-catalog.js";
import type { AgentGamePlanItem } from "../../api/agent-game-plan.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

const COLOR_LABELS_NO: Record<TicketColor, string> = {
  gul: "Gul",
  hvit: "Hvit",
  lilla: "Lilla",
};

const MAX_DRAW = 90;

export interface JackpotSetupModalOptions {
  /** Plan-item som krever popup (currentItem eller nextItem). */
  item: AgentGamePlanItem;
  /**
   * Pre-fylt verdier hvis admin har satt override tidligere. UI viser
   * disse i feltene så master kan rediger uten å skrive på nytt.
   */
  initial?: {
    draw?: number;
    prizesCents?: Partial<Record<TicketColor, number>>;
  } | null;
  /**
   * Kalles ETTER vellykket POST. Mottar oppdatert run så caller kan
   * trigge `advanceToNext` umiddelbart hvis ønsket.
   */
  onSuccess?: () => void;
  /** Kalles på avbryt eller backdrop-close. */
  onCancel?: () => void;
}

interface FieldRefs {
  draw: HTMLInputElement;
  // ticket-color → input. Kun farger i item.catalogEntry.ticketColors er
  // i map-en — andre farger rendres ikke.
  prizes: Map<TicketColor, HTMLInputElement>;
}

/**
 * Rendre input-row for én bongfarge. Beløp er i kroner i UI; konverteres
 * til øre ved submit.
 */
function renderColorRow(
  color: TicketColor,
  initialKr: number | null,
): { container: HTMLDivElement; input: HTMLInputElement } {
  const wrap = document.createElement("div");
  wrap.className = "form-group";
  wrap.dataset.testid = `jackpot-color-row-${color}`;

  const labelText = `Jackpot ${COLOR_LABELS_NO[color]} bong (kr)`;
  wrap.innerHTML = `
    <label for="jackpot-prize-${color}">${escapeHtml(labelText)}</label>
    <input type="number" min="1" step="1" required
           class="form-control"
           id="jackpot-prize-${color}"
           name="prize-${color}"
           data-color="${color}"
           data-testid="jackpot-prize-input-${color}"
           ${initialKr !== null ? `value="${initialKr}"` : ""} />
  `;
  const input = wrap.querySelector<HTMLInputElement>(`#jackpot-prize-${color}`);
  if (!input) throw new Error("input-rendering feilet");
  return { container: wrap, input };
}

/**
 * Bygg form-DOM. Eksposert som `buildJackpotSetupForm` så tester kan
 * verifisere render-output uten å åpne modal-en.
 */
export function buildJackpotSetupForm(
  item: AgentGamePlanItem,
  initial?: JackpotSetupModalOptions["initial"],
): { form: HTMLFormElement; refs: FieldRefs } {
  const form = document.createElement("form");
  form.className = "jackpot-setup-form";
  form.dataset.testid = "jackpot-setup-form";
  form.dataset.position = String(item.position);

  const initialDraw = initial?.draw ?? "";
  const drawSection = document.createElement("div");
  drawSection.className = "form-group";
  drawSection.innerHTML = `
    <label for="jackpot-draw">Hvilket trekk gir jackpot? (1-${MAX_DRAW})</label>
    <input type="number" min="1" max="${MAX_DRAW}" step="1" required
           class="form-control"
           id="jackpot-draw"
           name="draw"
           data-testid="jackpot-draw-input"
           ${initialDraw !== "" ? `value="${initialDraw}"` : ""} />
    <small class="form-text text-muted">
      Trekket må være mellom 1 og ${MAX_DRAW}.
    </small>
  `;
  form.appendChild(drawSection);

  const intro = document.createElement("p");
  intro.className = "jackpot-setup-intro";
  intro.textContent = `Spill: ${item.catalogEntry.displayName} (posisjon ${item.position})`;
  form.insertBefore(intro, drawSection);

  const prizes = new Map<TicketColor, HTMLInputElement>();
  // Behold rekkefølgen fra catalog-entry slik admin har konfigurert.
  for (const color of item.catalogEntry.ticketColors) {
    const initialCents = initial?.prizesCents?.[color];
    const initialKr =
      typeof initialCents === "number" && Number.isFinite(initialCents)
        ? Math.round(initialCents / 100)
        : null;
    const { container, input } = renderColorRow(color, initialKr);
    form.appendChild(container);
    prizes.set(color, input);
  }

  const drawInput = form.querySelector<HTMLInputElement>("#jackpot-draw");
  if (!drawInput) throw new Error("draw-input mangler");

  return { form, refs: { draw: drawInput, prizes } };
}

/**
 * Validér + samle inn payload fra form. Returnerer null hvis validering
 * feiler (Toast.error vises i kaller).
 */
function collectPayload(
  refs: FieldRefs,
  item: AgentGamePlanItem,
): { draw: number; prizesCents: Partial<Record<TicketColor, number>> } | null {
  const drawRaw = refs.draw.value.trim();
  const draw = Number(drawRaw);
  if (!Number.isFinite(draw) || !Number.isInteger(draw) || draw < 1 || draw > MAX_DRAW) {
    Toast.error(`Trekk må være et heltall mellom 1 og ${MAX_DRAW}.`);
    refs.draw.focus();
    return null;
  }
  const prizesCents: Partial<Record<TicketColor, number>> = {};
  for (const [color, input] of refs.prizes.entries()) {
    const krRaw = input.value.trim();
    const kr = Number(krRaw);
    if (!Number.isFinite(kr) || !Number.isInteger(kr) || kr <= 0) {
      Toast.error(
        `Jackpot for ${COLOR_LABELS_NO[color]} må være et positivt heltall (kr).`,
      );
      input.focus();
      return null;
    }
    prizesCents[color] = kr * 100; // kr → øre
  }
  if (Object.keys(prizesCents).length === 0) {
    // Skal ikke skje — catalog-entry hadde tom ticketColors-liste.
    Toast.error("Ingen bongfarger konfigurert for dette spillet.");
    return null;
  }
  // Sanity-sjekk: alle farger som er i catalog-entry må være med.
  for (const color of item.catalogEntry.ticketColors) {
    if (prizesCents[color] === undefined) {
      Toast.error(`Mangler jackpot-beløp for ${COLOR_LABELS_NO[color]}.`);
      return null;
    }
  }
  return { draw, prizesCents };
}

export function openJackpotSetupModal(opts: JackpotSetupModalOptions): void {
  const { item, initial, onSuccess, onCancel } = opts;
  const { form, refs } = buildJackpotSetupForm(item, initial);

  let cancelledByUser = true;

  Modal.open({
    title: `Jackpot-setup for ${item.catalogEntry.displayName}`,
    content: form,
    backdrop: "static",
    keyboard: true,
    onClose: (reason) => {
      if (cancelledByUser && reason !== "programmatic") {
        onCancel?.();
      }
    },
    buttons: [
      {
        label: "Avbryt",
        variant: "default",
        action: "cancel",
        onClick: () => {
          cancelledByUser = true;
        },
      },
      {
        label: "Bekreft",
        variant: "primary",
        action: "confirm",
        dismiss: false,
        onClick: async (instance) => {
          const payload = collectPayload(refs, item);
          if (!payload) return;
          try {
            await setAgentGamePlanJackpot({
              position: item.position,
              draw: payload.draw,
              prizesCents: payload.prizesCents,
            });
            Toast.success("Jackpot-oppsett lagret.");
            cancelledByUser = false;
            instance.close("button");
            onSuccess?.();
          } catch (err) {
            const msg =
              err instanceof ApiError
                ? err.message
                : "Klarte ikke å lagre jackpot-oppsett.";
            Toast.error(msg);
          }
        },
      },
    ],
  });
}
