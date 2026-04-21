// BIN-679 — /treasureChest.
// Chest config: `{ prizes: ChestPrize[], chestCount?: number }` eller legacy
// `prizeList: number[]`. Strukturert editor viser 10 prize-felter; JSON-
// editor gir full tilgang til labels/weights.

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

const CHEST_COUNT = 10;

export function renderTreasureChestPage(container: HTMLElement): void {
  const host = renderOtherGamesShell(
    container,
    "treasure_chest",
    "treasure_chest",
    "chest-form-host",
    "chest"
  );
  void mount(host);
}

async function mount(host: HTMLElement): Promise<void> {
  const cfg = await loadMiniGameConfig(host, "chest");
  if (!cfg) return;

  const prizeList = extractPrizeList(cfg.config, CHEST_COUNT);

  host.innerHTML = `
    <form id="chest-form" class="form-horizontal" data-testid="chest-form">
      <div class="form-group">
        <label class="col-sm-12">${escapeHtml(t("treasure_chest_prize"))}</label>
        <div class="col-sm-12" data-testid="chest-prizes">
          ${renderPrizeGrid(prizeList, CHEST_COUNT, "price", "col-lg-2")}
        </div>
      </div>
      ${activeAndJsonRow(cfg.active, cfg.config)}
      ${submitRow()}
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#chest-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      const prizes = collectPrizes(form, "price", CHEST_COUNT);
      const structured = {
        ...cfg.config,
        prizes: prizes.map((prizeAmount, i) => ({
          label: String(i + 1),
          prizeAmount,
        })),
        prizeList: prizes,
      };
      await saveMiniGameFromForm("chest", form, structured);
    })();
  });
}

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
  const prizes = config.prizes;
  if (Array.isArray(prizes)) {
    for (let i = 0; i < count; i++) {
      const p = prizes[i];
      if (p && typeof p === "object" && "prizeAmount" in p) {
        const v = (p as { prizeAmount: unknown }).prizeAmount;
        if (typeof v === "number" && Number.isFinite(v)) out[i] = v;
      }
    }
  }
  return out;
}
