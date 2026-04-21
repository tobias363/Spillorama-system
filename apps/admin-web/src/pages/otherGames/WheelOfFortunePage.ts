// BIN-679 — /wheelOfFortune.
// Wheel config: `{ segments: WheelSegment[] }` eller legacy `prizeList:
// number[]`. Strukturert editor viser 24 prize-felter; JSON-editor gir
// full tilgang til segments (label/weight/color) for avanserte oppsett.

import { t } from "../../i18n/I18n.js";
import { escapeHtml } from "../adminUsers/shared.js";
import {
  activeAndJsonRow,
  collectPrizes,
  loadMiniGameConfig,
  renderOtherGamesShell,
  renderPrizeGrid,
  saveMiniGameFromForm,
  submitRow,
} from "./shared.js";

const WHEEL_SEGMENTS = 24;

export function renderWheelOfFortunePage(container: HTMLElement): void {
  const host = renderOtherGamesShell(
    container,
    "wheel_of_fortune",
    "wheel_of_fortune",
    "wheel-form-host",
    "wheel"
  );
  void mount(host);
}

async function mount(host: HTMLElement): Promise<void> {
  const cfg = await loadMiniGameConfig(host, "wheel");
  if (!cfg) return;

  const prizeList = extractPrizeList(cfg.config, WHEEL_SEGMENTS);

  host.innerHTML = `
    <form id="wheel-form" class="form-horizontal" data-testid="wheel-form">
      <div class="form-group">
        <label class="col-sm-12">${escapeHtml(t("wheel_of_fortune_prize"))}</label>
        <div class="col-sm-12" data-testid="wheel-prizes">
          ${renderPrizeGrid(prizeList, WHEEL_SEGMENTS, "price", "col-lg-1")}
        </div>
      </div>
      ${activeAndJsonRow(cfg.active, cfg.config)}
      ${submitRow()}
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#wheel-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      const prizes = collectPrizes(form, "price", WHEEL_SEGMENTS);
      // Strukturert: konverter prize-liste til segments med simple labels.
      const structured = {
        ...cfg.config,
        segments: prizes.map((prizeAmount, i) => ({
          label: String(i + 1),
          prizeAmount,
        })),
        // Legacy-kompat: behold prizeList hvis eksisterende config hadde den.
        prizeList: prizes,
      };
      await saveMiniGameFromForm("wheel", form, structured);
    })();
  });
}

/**
 * Ekstraherer flat prize-list av lengde `count` fra config. Støtter både
 * legacy `prizeList: number[]` og ny `segments: [{prizeAmount}]`-shape.
 */
function extractPrizeList(config: Record<string, unknown>, count: number): number[] {
  const out: number[] = new Array(count).fill(0);
  const legacy = config.prizeList;
  if (Array.isArray(legacy)) {
    for (let i = 0; i < count; i++) {
      const v = legacy[i];
      if (typeof v === "number" && Number.isFinite(v)) out[i] = v;
    }
    return out;
  }
  const segments = config.segments;
  if (Array.isArray(segments)) {
    for (let i = 0; i < count; i++) {
      const seg = segments[i];
      if (seg && typeof seg === "object" && "prizeAmount" in seg) {
        const v = (seg as { prizeAmount: unknown }).prizeAmount;
        if (typeof v === "number" && Number.isFinite(v)) out[i] = v;
      }
    }
  }
  return out;
}
