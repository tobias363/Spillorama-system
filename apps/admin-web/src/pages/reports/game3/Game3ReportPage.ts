// PR-A4a (BIN-645) — /reportGame3 (Game 3 range-rapport).
//

import { t } from "../../../i18n/I18n.js";
import { renderGameRangeReportPage } from "../shared/GameRangeReportPage.js";

export async function renderGame3ReportPage(container: HTMLElement): Promise<void> {
  await renderGameRangeReportPage(container, {
    gameSlug: "mystery",
    title: t("game3"),
  });
}
