// PR-A4a (BIN-645) — /reportGame5 (SpinnGo / Spill 4 range-rapport).
//
// SpinnGo (game5 / spillorama) er databingo (§11 30% til organisasjoner) —
// bruker DATABINGO som backend-gameType (se
// apps/backend/src/util/httpHelpers.ts og docs/architecture/SPILLKATALOG.md).

import { t } from "../../../i18n/I18n.js";
import { renderGameRangeReportPage } from "../shared/GameRangeReportPage.js";

export async function renderGame5ReportPage(container: HTMLElement): Promise<void> {
  await renderGameRangeReportPage(container, {
    gameSlug: "DATABINGO",
    title: t("game5"),
  });
}
