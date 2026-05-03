// PR-A4a (BIN-645) — /reportGame1 (Spill 1 range-rapport).
//
// Spill 1 (bingo) er hovedspill (§11 15% til organisasjoner). Backend krever
// gameType-parameter "MAIN_GAME" eller "DATABINGO" (se
// apps/backend/src/util/httpHelpers.ts:parseOptionalLedgerGameType og
// docs/architecture/SPILLKATALOG.md).

import { t } from "../../../i18n/I18n.js";
import { renderGameRangeReportPage } from "../shared/GameRangeReportPage.js";

export async function renderGame1ReportPage(container: HTMLElement): Promise<void> {
  await renderGameRangeReportPage(container, {
    gameSlug: "MAIN_GAME",
    title: t("game1"),
    drillLinkTemplate: "/reportGame1/subgames/:id",
  });
}
