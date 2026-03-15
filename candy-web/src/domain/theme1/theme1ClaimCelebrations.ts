import type { ClaimRecord, RealtimeRoomSnapshot } from "@/domain/realtime/contracts";
import { getTheme1PatternCatalogEntry } from "@/domain/theme1/patternCatalog";
import { getTheme1PatternDefinition } from "@/domain/theme1/patternDefinitions";
import type { Theme1CelebrationState } from "@/domain/theme1/renderModel";

interface ExtractNewTheme1CelebrationsInput {
  playerId: string;
  knownClaimIds: readonly string[];
  previousGameId: string;
}

interface ExtractNewTheme1CelebrationsResult {
  nextGameId: string;
  nextKnownClaimIds: string[];
  celebrations: Theme1CelebrationState[];
}

export function extractNewTheme1Celebrations(
  snapshot: RealtimeRoomSnapshot,
  input: ExtractNewTheme1CelebrationsInput,
): ExtractNewTheme1CelebrationsResult {
  const nextGameId = snapshot.currentGame?.id ?? "";
  const retainedClaimIds =
    nextGameId !== input.previousGameId ? [] : [...input.knownClaimIds];
  const seenClaimIds = new Set(retainedClaimIds);
  const relevantClaims = (snapshot.currentGame?.claims ?? [])
    .filter((claim) => isCelebrationClaim(claim, input.playerId))
    .sort(compareClaimsByCreatedAt);
  const freshClaims: ClaimRecord[] = [];

  for (const claim of relevantClaims) {
    if (!seenClaimIds.has(claim.id)) {
      freshClaims.push(claim);
    }

    seenClaimIds.add(claim.id);
  }

  const celebrations = mapClaimsToCelebrations(freshClaims);

  return {
    nextGameId,
    nextKnownClaimIds: [...seenClaimIds],
    celebrations,
  };
}

function isCelebrationClaim(claim: ClaimRecord, playerId: string) {
  return (
    claim.valid &&
    claim.type === "PATTERN" &&
    claim.playerId === playerId &&
    normalizeAmount(claim.payoutAmount ?? 0) > 0
  );
}

function mapClaimsToCelebrations(claims: readonly ClaimRecord[]): Theme1CelebrationState[] {
  const grouped = new Map<string, ClaimRecord[]>();

  for (const claim of claims) {
    const ticketIndex =
      typeof claim.ticketIndex === "number" && claim.ticketIndex >= 0
        ? Math.trunc(claim.ticketIndex)
        : -1;
    const groupKey = ticketIndex >= 0 ? `ticket:${ticketIndex}` : `claim:${claim.id}`;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.push(claim);
    } else {
      grouped.set(groupKey, [claim]);
    }
  }

  return [...grouped.values()]
    .sort((left, right) => compareClaimsByCreatedAt(left[0]!, right[0]!))
    .map((group) =>
      group.length === 1 ? mapSingleClaimToCelebration(group[0]!) : mapGroupedClaimsToCelebration(group),
    );
}

function mapSingleClaimToCelebration(claim: ClaimRecord): Theme1CelebrationState {
  const catalogEntry =
    typeof claim.winningPatternIndex === "number"
      ? getTheme1PatternCatalogEntry(claim.winningPatternIndex)
      : null;
  const definition =
    typeof claim.winningPatternIndex === "number"
      ? getTheme1PatternDefinition(claim.winningPatternIndex)
      : undefined;
  const displayPatternNumber =
    typeof claim.displayPatternNumber === "number" && claim.displayPatternNumber > 0
      ? claim.displayPatternNumber
      : catalogEntry?.displayPatternNumber ?? null;
  const ticketIndex =
    typeof claim.ticketIndex === "number" && claim.ticketIndex >= 0
      ? Math.trunc(claim.ticketIndex)
      : null;

  return {
    claimId: claim.id,
    kind: "win",
    title:
      displayPatternNumber !== null
        ? `Mønster ${displayPatternNumber}`
        : catalogEntry?.title ?? "Nytt mønster",
    subtitle: ticketIndex !== null ? `Bong nr ${ticketIndex + 1}` : "Ny gevinst",
    amount: `${new Intl.NumberFormat("nb-NO").format(normalizeAmount(claim.payoutAmount ?? 0))} kr`,
    topperId:
      typeof claim.topperSlotIndex === "number" && claim.topperSlotIndex >= 0
        ? Math.trunc(claim.topperSlotIndex) + 1
        : definition
          ? definition.topperSlotIndex + 1
          : null,
    boardId: ticketIndex !== null ? `board-${ticketIndex + 1}` : null,
  };
}

function mapGroupedClaimsToCelebration(claims: readonly ClaimRecord[]): Theme1CelebrationState {
  const sortedClaims = [...claims].sort(compareClaimsByCreatedAt);
  const primaryClaim = resolvePrimaryCelebrationClaim(sortedClaims);
  const ticketIndex =
    typeof primaryClaim.ticketIndex === "number" && primaryClaim.ticketIndex >= 0
      ? Math.trunc(primaryClaim.ticketIndex)
      : null;
  const totalAmount = sortedClaims.reduce(
    (sum, claim) => sum + normalizeAmount(claim.payoutAmount ?? 0),
    0,
  );
  const details = sortedClaims
    .map((claim) => {
      const catalogEntry =
        typeof claim.winningPatternIndex === "number"
          ? getTheme1PatternCatalogEntry(claim.winningPatternIndex)
          : null;
      const displayPatternNumber =
        typeof claim.displayPatternNumber === "number" && claim.displayPatternNumber > 0
          ? claim.displayPatternNumber
          : catalogEntry?.displayPatternNumber ?? null;
      return displayPatternNumber !== null
        ? `Mønster ${displayPatternNumber}`
        : catalogEntry?.title ?? "Nytt mønster";
    })
    .filter((value, index, values) => values.indexOf(value) === index);
  const primaryDefinition =
    typeof primaryClaim.winningPatternIndex === "number"
      ? getTheme1PatternDefinition(primaryClaim.winningPatternIndex)
      : undefined;

  return {
    claimId: sortedClaims.map((claim) => claim.id).join("+"),
    kind: "win",
    title: `${sortedClaims.length} mønstre!`,
    subtitle: ticketIndex !== null ? `Bong nr ${ticketIndex + 1}` : "Ny gevinst",
    amount: `${new Intl.NumberFormat("nb-NO").format(totalAmount)} kr`,
    topperId:
      typeof primaryClaim.topperSlotIndex === "number" && primaryClaim.topperSlotIndex >= 0
        ? Math.trunc(primaryClaim.topperSlotIndex) + 1
        : primaryDefinition
          ? primaryDefinition.topperSlotIndex + 1
          : null,
    boardId: ticketIndex !== null ? `board-${ticketIndex + 1}` : null,
    details,
  };
}

function resolvePrimaryCelebrationClaim(claims: readonly ClaimRecord[]) {
  return [...claims].sort((left, right) => {
    const leftAmount = normalizeAmount(left.payoutAmount ?? 0);
    const rightAmount = normalizeAmount(right.payoutAmount ?? 0);
    if (leftAmount !== rightAmount) {
      return rightAmount - leftAmount;
    }

    const leftDefinition =
      typeof left.winningPatternIndex === "number"
        ? getTheme1PatternDefinition(left.winningPatternIndex)
        : undefined;
    const rightDefinition =
      typeof right.winningPatternIndex === "number"
        ? getTheme1PatternDefinition(right.winningPatternIndex)
        : undefined;
    if ((leftDefinition?.topperSlotIndex ?? Number.MAX_SAFE_INTEGER) !== (rightDefinition?.topperSlotIndex ?? Number.MAX_SAFE_INTEGER)) {
      return (leftDefinition?.topperSlotIndex ?? Number.MAX_SAFE_INTEGER) - (rightDefinition?.topperSlotIndex ?? Number.MAX_SAFE_INTEGER);
    }

    return compareClaimsByCreatedAt(left, right);
  })[0]!;
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
