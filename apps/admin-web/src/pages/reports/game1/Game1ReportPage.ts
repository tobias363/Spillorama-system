// PR-A4a (BIN-645) — /reportGame1 (Game 1 range-rapport).
//
// New implementation delegates to GameRangeReportPage with gameSlug="bingo".

import { t } from "../../../i18n/I18n.js";
import { renderGameRangeReportPage } from "../shared/GameRangeReportPage.js";

export async function renderGame1ReportPage(container: HTMLElement): Promise<void> {
  await renderGameRangeReportPage(container, {
    gameSlug: "bingo",
    title: t("game1"),
    drillLinkTemplate: "/reportGame1/subgames/:id",
  });
}
