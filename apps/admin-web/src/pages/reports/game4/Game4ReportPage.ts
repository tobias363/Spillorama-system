// PR-A4a (BIN-645) — /reportGame4 (Wheel of Fortune range-rapport).
//

import { t } from "../../../i18n/I18n.js";
import { renderGameRangeReportPage } from "../shared/GameRangeReportPage.js";

export async function renderGame4ReportPage(container: HTMLElement): Promise<void> {
  await renderGameRangeReportPage(container, {
    gameSlug: "wheel",
    title: t("game4"),
  });
}
