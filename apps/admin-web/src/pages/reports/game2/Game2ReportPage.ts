// PR-A4a (BIN-645) — /reportGame2 (Spill 2 range-rapport).
//
// Spill 2 (rocket) er hovedspill — bruker MAIN_GAME som backend-gameType
// (se apps/backend/src/util/httpHelpers.ts og docs/architecture/SPILLKATALOG.md).

import { t } from "../../../i18n/I18n.js";
import { renderGameRangeReportPage } from "../shared/GameRangeReportPage.js";

export async function renderGame2ReportPage(container: HTMLElement): Promise<void> {
  await renderGameRangeReportPage(container, {
    gameSlug: "MAIN_GAME",
    title: t("game2"),
  });
}
