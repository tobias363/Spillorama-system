import { THEME1_DRAW_PRESENTATION_MS } from "@/domain/theme1/theme1MachineAnimation";
import type { Theme1CelebrationState } from "@/domain/theme1/renderModel";

const THEME1_POST_DRAW_NEAR_DELAY_MS = 120;
const THEME1_POST_DRAW_WIN_DELAY_MS = 260;

export function resolveTheme1CelebrationLeadDelay(
  pendingDrawNumber: number | null,
  celebrations: readonly Theme1CelebrationState[],
): number {
  if (pendingDrawNumber === null || celebrations.length === 0) {
    return 0;
  }

  const hasPrimaryCelebration = celebrations.some((celebration) => celebration.kind !== "near");
  const tailDelay = hasPrimaryCelebration ? THEME1_POST_DRAW_WIN_DELAY_MS : THEME1_POST_DRAW_NEAR_DELAY_MS;
  return THEME1_DRAW_PRESENTATION_MS + tailDelay;
}
