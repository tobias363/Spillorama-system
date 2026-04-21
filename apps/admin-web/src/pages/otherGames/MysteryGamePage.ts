// BIN-679 — /mystery.
// Mystery config: `{ rewards: MysteryReward[] }` eller legacy `prizeList:
// number[]`. 6 belønninger.

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

const MYSTERY_COUNT = 6;

export function renderMysteryGamePage(container: HTMLElement): void {
  const host = renderOtherGamesShell(
    container,
    "mystery_game",
    "mystery_game",
    "mystery-form-host",
    "mystery"
  );
  void mount(host);
}

async function mount(host: HTMLElement): Promise<void> {
  const cfg = await loadMiniGameConfig(host, "mystery");
  if (!cfg) return;

  const prizeList = extractPrizeList(cfg.config, MYSTERY_COUNT);

  host.innerHTML = `
    <form id="mystery-form" class="form-horizontal" data-testid="mystery-form">
      <div class="form-group">
        <label class="col-sm-12">${escapeHtml(t("mystery_game_prize"))}</label>
        <div class="col-sm-12" data-testid="mystery-prizes">
          ${renderPrizeGrid(prizeList, MYSTERY_COUNT, "price", "col-lg-2")}
        </div>
      </div>
      ${activeAndJsonRow(cfg.active, cfg.config)}
      ${submitRow()}
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#mystery-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      const prizes = collectPrizes(form, "price", MYSTERY_COUNT);
      const structured = {
        ...cfg.config,
        rewards: prizes.map((prizeAmount, i) => ({
          label: String(i + 1),
          prizeAmount,
        })),
        prizeList: prizes,
      };
      await saveMiniGameFromForm("mystery", form, structured);
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
  const rewards = config.rewards;
  if (Array.isArray(rewards)) {
    for (let i = 0; i < count; i++) {
      const r = rewards[i];
      if (r && typeof r === "object" && "prizeAmount" in r) {
        const v = (r as { prizeAmount: unknown }).prizeAmount;
        if (typeof v === "number" && Number.isFinite(v)) out[i] = v;
      }
    }
  }
  return out;
}
