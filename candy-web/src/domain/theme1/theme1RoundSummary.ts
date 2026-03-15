import type { ClaimRecord, RealtimeRoomSnapshot } from "@/domain/realtime/contracts";
import type { Theme1CelebrationState, Theme1RoundRenderModel } from "@/domain/theme1/renderModel";

interface ExtractTheme1RoundSummaryInput {
  playerId: string;
  previousModel: Theme1RoundRenderModel;
}

export function extractTheme1RoundSummary(
  snapshot: RealtimeRoomSnapshot,
  input: ExtractTheme1RoundSummaryInput,
): Theme1CelebrationState | null {
  const nextGame = snapshot.currentGame;
  if (!nextGame || nextGame.status !== "ENDED" || input.previousModel.meta.gameStatus === "ENDED") {
    return null;
  }

  const normalizedPlayerId = input.playerId.trim();
  if (normalizedPlayerId.length === 0) {
    return null;
  }

  const playerTickets = nextGame.tickets[normalizedPlayerId] ?? [];
  if (playerTickets.length === 0) {
    return null;
  }

  const winningClaims = nextGame.claims
    .filter((claim) => isSummaryClaim(claim, normalizedPlayerId))
    .sort(compareClaimsByCreatedAt);

  if (winningClaims.length === 0) {
    return null;
  }

  const totalPayout = winningClaims.reduce(
    (sum, claim) => sum + normalizeAmount(claim.payoutAmount ?? 0),
    0,
  );
  if (totalPayout <= 0) {
    return null;
  }

  const boardGroups = new Map<number, string[]>();
  for (const claim of winningClaims) {
    const ticketIndex =
      typeof claim.ticketIndex === "number" && claim.ticketIndex >= 0
        ? Math.trunc(claim.ticketIndex)
        : -1;
    if (ticketIndex < 0) {
      continue;
    }

    const patterns = boardGroups.get(ticketIndex) ?? [];
    const displayPatternNumber =
      typeof claim.displayPatternNumber === "number" && claim.displayPatternNumber > 0
        ? Math.trunc(claim.displayPatternNumber)
        : null;
    patterns.push(displayPatternNumber !== null ? `Mønster ${displayPatternNumber}` : "Mønster");
    boardGroups.set(ticketIndex, patterns);
  }

  const detailLines = [...boardGroups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([ticketIndex, patterns]) => `Bong nr ${ticketIndex + 1}: ${patterns.join(", ")}`);

  const winningBoardCount = boardGroups.size;
  const subtitle =
    winningBoardCount === 1
      ? "1 vinnende bong"
      : `${winningBoardCount} vinnende bonger`;

  return {
    claimId: `summary-${nextGame.id}`,
    kind: "summary",
    title: "Runde ferdig",
    subtitle,
    amount: `${new Intl.NumberFormat("nb-NO").format(totalPayout)} kr totalt`,
    details: detailLines,
    topperId: null,
  };
}

function isSummaryClaim(claim: ClaimRecord, playerId: string) {
  return (
    claim.valid &&
    claim.type === "PATTERN" &&
    claim.playerId === playerId &&
    normalizeAmount(claim.payoutAmount ?? 0) > 0
  );
}

function normalizeAmount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function compareClaimsByCreatedAt(left: ClaimRecord, right: ClaimRecord) {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.id.localeCompare(right.id);
}
