// PR-A4a (BIN-645) — /reportGame2 (Game 2 range-rapport).
//

import { t } from "../../../i18n/I18n.js";
import { renderGameRangeReportPage } from "../shared/GameRangeReportPage.js";

export async function renderGame2ReportPage(container: HTMLElement): Promise<void> {
  await renderGameRangeReportPage(container, {
    gameSlug: "rocket",
    title: t("game2"),
  });
}
