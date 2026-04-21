// BIN-679 — /colorDraft.
// ColorDraft config: `{ colors: ColordraftColor[] }` eller legacy
// `{ redPrizes, yellowPrizes, greenPrizes }`. 3 farger × 4 prize-tiers.

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

const COLOR_TIER_COUNT = 4;
const COLOR_KEYS = ["red", "yellow", "green"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

export function renderColorDraftPage(container: HTMLElement): void {
  const host = renderOtherGamesShell(
    container,
    "color_draft",
    "color_draft",
    "colordraft-form-host",
    "colordraft"
  );
  void mount(host);
}

async function mount(host: HTMLElement): Promise<void> {
  const cfg = await loadMiniGameConfig(host, "colordraft");
  if (!cfg) return;

  const perColor = extractPerColorPrizes(cfg.config);

  host.innerHTML = `
    <form id="colordraft-form" class="form-horizontal" data-testid="colordraft-form">
      <div class="form-group">
        <label class="col-sm-4 control-label">${escapeHtml(t("red_color_prize"))}</label>
        <div class="col-sm-8" data-testid="colordraft-red">
          ${renderPrizeGrid(perColor.red, COLOR_TIER_COUNT, "redColorPrize", "col-lg-2")}
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label">${escapeHtml(t("yellow_color_prize"))}</label>
        <div class="col-sm-8" data-testid="colordraft-yellow">
          ${renderPrizeGrid(perColor.yellow, COLOR_TIER_COUNT, "yellowColorPrize", "col-lg-2")}
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label">${escapeHtml(t("green_color_prize"))}</label>
        <div class="col-sm-8" data-testid="colordraft-green">
          ${renderPrizeGrid(perColor.green, COLOR_TIER_COUNT, "greenColorPrize", "col-lg-2")}
        </div>
      </div>
      ${activeAndJsonRow(cfg.active, cfg.config)}
      ${submitRow()}
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#colordraft-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      const redPrizes = collectPrizes(form, "redColorPrize", COLOR_TIER_COUNT);
      const yellowPrizes = collectPrizes(form, "yellowColorPrize", COLOR_TIER_COUNT);
      const greenPrizes = collectPrizes(form, "greenColorPrize", COLOR_TIER_COUNT);

      const structured = {
        ...cfg.config,
        // Ny shape: colors-array.
        colors: [
          { color: "red", prizeAmounts: redPrizes },
          { color: "yellow", prizeAmounts: yellowPrizes },
          { color: "green", prizeAmounts: greenPrizes },
        ],
        // Legacy-kompat.
        redPrizes,
        yellowPrizes,
        greenPrizes,
      };
      await saveMiniGameFromForm("colordraft", form, structured);
    })();
  });
}

function extractPerColorPrizes(
  config: Record<string, unknown>
): Record<ColorKey, number[]> {
  const result: Record<ColorKey, number[]> = {
    red: new Array(COLOR_TIER_COUNT).fill(0),
    yellow: new Array(COLOR_TIER_COUNT).fill(0),
    green: new Array(COLOR_TIER_COUNT).fill(0),
  };

  // Legacy-felter.
  for (const color of COLOR_KEYS) {
    const legacyKey = `${color}Prizes`;
    const arr = config[legacyKey];
    if (Array.isArray(arr)) {
      for (let i = 0; i < COLOR_TIER_COUNT; i++) {
        const v = arr[i];
        if (typeof v === "number" && Number.isFinite(v)) result[color][i] = v;
      }
    }
  }

  // Ny shape: colors-array.
  const colors = config.colors;
  if (Array.isArray(colors)) {
    for (const entry of colors) {
      if (!entry || typeof entry !== "object") continue;
      const c = (entry as { color?: unknown }).color;
      const pa = (entry as { prizeAmounts?: unknown }).prizeAmounts;
      if (typeof c !== "string" || !COLOR_KEYS.includes(c as ColorKey)) continue;
      if (!Array.isArray(pa)) continue;
      const key = c as ColorKey;
      for (let i = 0; i < COLOR_TIER_COUNT; i++) {
        const v = pa[i];
        if (typeof v === "number" && Number.isFinite(v)) result[key][i] = v;
      }
    }
  }

  return result;
}
