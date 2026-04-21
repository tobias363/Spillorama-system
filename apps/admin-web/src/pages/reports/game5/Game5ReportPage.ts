// PR-A4a (BIN-645) — /reportGame5 (Color Draft range-rapport).
//

import { t } from "../../../i18n/I18n.js";
import { renderGameRangeReportPage } from "../shared/GameRangeReportPage.js";

export async function renderGame5ReportPage(container: HTMLElement): Promise<void> {
  await renderGameRangeReportPage(container, {
    gameSlug: "color-draft",
    title: t("game5"),
  });
}
