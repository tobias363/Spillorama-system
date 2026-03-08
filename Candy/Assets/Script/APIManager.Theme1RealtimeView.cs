using System;
using System.Collections.Generic;
using SimpleJSON;
using TMPro;
using UnityEngine;

public partial class APIManager
{
    private bool ShouldUseDedicatedTheme1RealtimeView()
    {
        return useRealtimeBackend && theme1RealtimeViewMode != Theme1RealtimeViewMode.LegacyOnly;
    }

    private bool TryResolveDedicatedTheme1GameplayView(out Theme1GameplayViewRoot viewRoot)
    {
        if (!TryResolveTheme1GameplayViewContract(out viewRoot))
        {
            ReportRealtimeRenderMismatch("Theme1GameplayViewRoot mangler eller er ugyldig. Faller tilbake til legacy-render.", asError: true);
            return false;
        }

        return true;
    }

    private void HandleRealtimeRoomUpdateDedicated(JSONNode snapshot, Theme1GameplayViewRoot viewRoot)
    {
        if (snapshot == null || snapshot.IsNull)
        {
            return;
        }

        string snapshotRoomCode = snapshot["code"];
        if (!string.IsNullOrWhiteSpace(snapshotRoomCode))
        {
            activeRoomCode = snapshotRoomCode.Trim().ToUpperInvariant();
            roomCode = activeRoomCode;
        }

        string snapshotHallId = snapshot["hallId"];
        if (!string.IsNullOrWhiteSpace(snapshotHallId))
        {
            hallId = snapshotHallId.Trim();
        }

        string snapshotHostPlayerId = snapshot["hostPlayerId"];
        if (!string.IsNullOrWhiteSpace(snapshotHostPlayerId))
        {
            activeHostPlayerId = snapshotHostPlayerId.Trim();
        }

        ResolveRealtimePlayerIdFromSnapshot(snapshot, syncField: true);
        ApplySchedulerMetadata(snapshot);

        JSONNode currentGame = snapshot["currentGame"];
        if (currentGame == null || currentGame.IsNull)
        {
            realtimeScheduler.SetCurrentGameStatus("NONE");
            string previousGameId = activeGameId;
            activeGameId = string.Empty;
            realtimePlayerParticipatingInCurrentRound = false;
            processedDrawCount = 0;
            currentTicketPage = 0;
            delayedOverlayResetGameId = string.Empty;
            overlaysClearedForEndedGameId = string.IsNullOrWhiteSpace(previousGameId)
                ? overlaysClearedForEndedGameId
                : previousGameId;

            bool hasVisibleTickets = TryApplyPreRoundTicketSetsFromSnapshotDedicated(snapshot) ||
                                     TryApplyCachedStableTicketsDedicated();
            if (!hasVisibleTickets)
            {
                activeTicketSets.Clear();
                realtimeTicketFallbackLogKey = string.Empty;
            }

            ResetRealtimeBonusState(closeBonusPanel: true, previousGameId: previousGameId);
            RefreshRealtimeCountdownLabel(forceRefresh: true);
            StopRealtimeMatchedPatternVisuals();
            StopRealtimeNearWinBlinking();

            Theme1DisplayState preservedState = GetPreservedTheme1RoundDisplayState();
            if (preservedState != null)
            {
                theme1DisplayPresenter.Render(viewRoot, preservedState);
                RegisterDedicatedTheme1RenderMetrics(viewRoot, preservedState);
            }
            else
            {
                RenderDedicatedTheme1State(viewRoot, currentGame: null);
            }
            return;
        }

        realtimeScheduler.SetCurrentGameStatus(currentGame["status"]);

        string gameId = currentGame["id"];
        if (string.IsNullOrWhiteSpace(gameId))
        {
            RefreshRealtimeCountdownLabel(forceRefresh: true);
            RenderDedicatedTheme1State(viewRoot, currentGame: null);
            return;
        }

        if (!string.Equals(activeGameId, gameId, StringComparison.Ordinal))
        {
            string previousGameId = activeGameId;
            activeGameId = gameId;
            ClearPreservedTheme1RoundDisplayState();
            processedDrawCount = 0;
            currentTicketPage = 0;
            activeTicketSets.Clear();
            realtimeTicketFallbackLogKey = string.Empty;
            delayedOverlayResetGameId = string.Empty;
            overlaysClearedForEndedGameId = string.Empty;
            ResetRealtimeBonusState(closeBonusPanel: true, previousGameId: previousGameId);
        }

        bool isActiveRoundParticipant = ApplyVisibleTicketSetsForCurrentSnapshotDedicated(currentGame, snapshot);
        realtimePlayerParticipatingInCurrentRound = isActiveRoundParticipant;
        ProcessRealtimeDrawUpdatesDedicated(currentGame, isActiveRoundParticipant);
        RefreshRealtimeCountdownLabel(forceRefresh: true);

        if (!isActiveRoundParticipant)
        {
            ResetRealtimeBonusState(closeBonusPanel: true);
        }

        RenderDedicatedTheme1State(viewRoot, currentGame);
    }

    private bool ApplyVisibleTicketSetsForCurrentSnapshotDedicated(JSONNode currentGame, JSONNode snapshot)
    {
        if (TryApplyCurrentRoundTicketsDedicated(currentGame, snapshot))
        {
            return true;
        }

        if (TryApplyPreRoundTicketSetsFromSnapshotDedicated(snapshot))
        {
            return false;
        }

        if (TryApplyCachedStableTicketsDedicated())
        {
            return false;
        }

        activeTicketSets.Clear();
        cachedStableTicketSets.Clear();
        realtimeTicketFallbackLogKey = string.Empty;
        return false;
    }

    private bool TryApplyCurrentRoundTicketsDedicated(JSONNode currentGame, JSONNode snapshot)
    {
        return TryApplyTicketSetsFromNodeDedicated(currentGame?["tickets"], snapshot, allowFallbackTicketSource: true);
    }

    private bool TryApplyPreRoundTicketSetsFromSnapshotDedicated(JSONNode snapshot)
    {
        if (snapshot == null || snapshot.IsNull)
        {
            return false;
        }

        return TryApplyTicketSetsFromNodeDedicated(snapshot["preRoundTickets"], snapshot, allowFallbackTicketSource: true);
    }

    private bool TryApplyTicketSetsFromNodeDedicated(JSONNode tickets, JSONNode snapshot, bool allowFallbackTicketSource)
    {
        if (tickets == null || tickets.IsNull)
        {
            return false;
        }

        string ticketSourcePlayerId = ResolveRealtimePlayerIdFromSnapshot(snapshot, syncField: true);
        JSONNode myTicketsNode = null;
        if (!string.IsNullOrWhiteSpace(activePlayerId))
        {
            myTicketsNode = tickets[activePlayerId];
        }

        if ((myTicketsNode == null || myTicketsNode.IsNull) &&
            !string.IsNullOrWhiteSpace(ticketSourcePlayerId) &&
            !string.Equals(ticketSourcePlayerId, activePlayerId, StringComparison.Ordinal))
        {
            myTicketsNode = tickets[ticketSourcePlayerId];
        }

        bool usedFallbackTicketSource = false;
        if (allowFallbackTicketSource &&
            (myTicketsNode == null || myTicketsNode.IsNull) &&
            string.IsNullOrWhiteSpace(ticketSourcePlayerId))
        {
            usedFallbackTicketSource = TryResolveFallbackTicketSource(
                tickets,
                out myTicketsNode,
                out ticketSourcePlayerId);
        }

        if (myTicketsNode == null || myTicketsNode.IsNull)
        {
            return false;
        }

        List<List<int>> ticketSets = RealtimeTicketSetUtils.ExtractTicketSets(myTicketsNode);
        if (ticketSets.Count == 0)
        {
            return false;
        }

        if (usedFallbackTicketSource)
        {
            LogTicketSourceFallbackOnce(ticketSourcePlayerId, ticketSets.Count);
        }

        activeTicketSets = RealtimeTicketSetUtils.CloneTicketSets(ticketSets);
        cachedStableTicketSets = RealtimeTicketSetUtils.CloneTicketSets(ticketSets);
        return true;
    }

    private bool TryApplyCachedStableTicketsDedicated()
    {
        if (!preserveTicketNumbersOnTransientSnapshotGaps ||
            cachedStableTicketSets == null ||
            cachedStableTicketSets.Count == 0)
        {
            TryRequestRealtimeTicketStateResync();
            return false;
        }

        activeTicketSets = RealtimeTicketSetUtils.CloneTicketSets(cachedStableTicketSets);
        PublishRuntimeStatus(
            "Bruker siste gyldige preround-bonger fordi snapshotet midlertidig manglet preRoundTickets.",
            asError: false);
        TryRequestRealtimeTicketStateResync();
        return true;
    }

    private void ProcessRealtimeDrawUpdatesDedicated(JSONNode currentGame, bool shouldAutoMarkCards)
    {
        JSONNode drawnNumbersNode = currentGame?["drawnNumbers"];
        if (drawnNumbersNode == null || drawnNumbersNode.IsNull || !drawnNumbersNode.IsArray)
        {
            processedDrawCount = 0;
            return;
        }

        bool shouldTrace = ShouldLogRealtimeDrawTrace();
        int previousProcessedDrawCount = Mathf.Max(0, processedDrawCount);
        for (int drawIndex = 0; drawIndex < drawnNumbersNode.Count; drawIndex++)
        {
            int drawnNumber = drawnNumbersNode[drawIndex].AsInt;
            if (drawIndex < previousProcessedDrawCount)
            {
                continue;
            }

            if (!GameManager.IsValidTheme1BallNumber(drawnNumber))
            {
                PublishRuntimeStatus(
                    $"Ignorerer ugyldig Theme1 draw-nummer {drawnNumber}. Theme1 tillater kun 1-{GameManager.Theme1MaxBallNumber}.",
                    asError: true);
                continue;
            }

            RegisterRealtimeDrawObserved(drawnNumbersNode.Count, drawnNumber);

            if (shouldTrace)
            {
                int markedCells = CountMarkedCellsForDedicatedDrawState(drawnNumbersNode, drawIndex + 1);
                Debug.Log(
                    $"[candy-draw] game={activeGameId} drawIndex={drawIndex + 1} number={drawnNumber} " +
                    $"drawnCount={drawnNumbersNode.Count} markedCells={markedCells} canMark={shouldAutoMarkCards}");
                Debug.Log(
                    $"[draw] draw_rendered game={activeGameId} idx={drawIndex + 1} " +
                    $"number={drawnNumber} markedCells={markedCells} canMark={shouldAutoMarkCards}");
            }

            if (autoMarkDrawnNumbers &&
                shouldAutoMarkCards &&
                RealtimeTicketSetUtils.TicketContainsInAnyTicketSet(activeTicketSets, drawnNumber) &&
                !string.IsNullOrWhiteSpace(activeRoomCode) &&
                !string.IsNullOrWhiteSpace(activePlayerId) &&
                realtimeClient != null &&
                realtimeClient.IsReady)
            {
                realtimeClient.MarkNumber(activeRoomCode, activePlayerId, drawnNumber, null);
            }
        }

        processedDrawCount = drawnNumbersNode.Count;
    }

    private int CountMarkedCellsForDedicatedDrawState(JSONNode drawnNumbersNode, int drawCount)
    {
        if (drawnNumbersNode == null || drawnNumbersNode.IsNull || !drawnNumbersNode.IsArray || drawCount <= 0)
        {
            return 0;
        }

        HashSet<int> drawnNumbers = new HashSet<int>();
        int count = Mathf.Min(drawCount, drawnNumbersNode.Count);
        for (int i = 0; i < count; i++)
        {
            int normalized = GameManager.NormalizeTheme1BallNumber(drawnNumbersNode[i].AsInt);
            if (normalized > 0)
            {
                drawnNumbers.Add(normalized);
            }
        }

        if (activeTicketSets == null || activeTicketSets.Count == 0)
        {
            return 0;
        }

        int markedCells = 0;
        for (int ticketIndex = 0; ticketIndex < activeTicketSets.Count; ticketIndex++)
        {
            List<int> ticket = activeTicketSets[ticketIndex];
            if (ticket == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < ticket.Count; cellIndex++)
            {
                int cellNumber = ticket[cellIndex];
                if (cellNumber > 0 && drawnNumbers.Contains(cellNumber))
                {
                    markedCells += 1;
                }
            }
        }

        return markedCells;
    }

    private void RenderDedicatedTheme1State(Theme1GameplayViewRoot viewRoot, JSONNode currentGame)
    {
        Theme1DisplayState renderState = BuildDedicatedTheme1DisplayState(currentGame, viewRoot);
        if (currentGame == null || currentGame.IsNull)
        {
            theme1DisplayPresenter.Render(viewRoot, renderState);
            RegisterDedicatedTheme1RenderMetrics(viewRoot, renderState);
            SyncLegacyTheme1MatchedPaylines(null);
            StopRealtimeMatchedPatternVisuals();
            StopRealtimeNearWinBlinking();
            NumberGenerator.isPrizeMissedByOneCard = false;
            return;
        }

        RealtimeClaimInfo latestClaim = GetLatestValidClaimForCurrentPlayer(currentGame);
        byte[][] patternMasks = CollectPatternMasks();
        Dictionary<int, HashSet<int>> winningPatternsByCard =
            ResolveDedicatedWinningPatternsByCard(renderState, currentGame, latestClaim, patternMasks);
        ApplyWinningPatternsToDedicatedState(renderState, winningPatternsByCard, patternMasks);

        theme1DisplayPresenter.Render(viewRoot, renderState);
        RegisterDedicatedTheme1RenderMetrics(viewRoot, renderState);
        PreserveTheme1RoundDisplayState(renderState);

        Dictionary<int, RealtimeNearWinState> activeNearWinStates = BuildNearWinStates(renderState);
        SyncLegacyTheme1MatchedPaylines(winningPatternsByCard);
        SyncRealtimeMatchedPatternVisuals(winningPatternsByCard);
        SyncRealtimeNearWinBlinking(activeNearWinStates);
        NumberGenerator.isPrizeMissedByOneCard = activeNearWinStates.Count > 0;
        RefreshRealtimeBonusFlow(currentGame, latestClaim, winningPatternsByCard);
    }

    private Theme1DisplayState BuildDedicatedTheme1DisplayState(JSONNode currentGame, Theme1GameplayViewRoot viewRoot)
    {
        Theme1StateBuildInput input = new Theme1StateBuildInput
        {
            GameId = currentGame?["id"] ?? activeGameId,
            CardSlotCount = viewRoot.Cards != null ? viewRoot.Cards.Length : Mathf.Max(1, GetCardSlotsCount()),
            VisibleCardCount = GetRealtimeVisibleCardCount(),
            CurrentTicketPage = currentTicketPage,
            DuplicateSingleTicketAcrossCards = duplicateTicketAcrossAllCards,
            BallSlotCount = viewRoot.BallRack != null && viewRoot.BallRack.Slots != null ? viewRoot.BallRack.Slots.Length : 30,
            DrawnNumbers = ExtractDrawnNumbers(currentGame),
            TicketSets = CloneTicketSetsForBuilder(activeTicketSets),
            ActivePatternIndexes = CollectActivePatternIndexes(),
            PatternMasks = CollectPatternMasks(),
            CardHeaderLabels = CollectCardHeaderLabels(viewRoot),
            CardBetLabels = CollectCardBetLabels(viewRoot),
            CardWinLabels = CollectCardWinLabels(viewRoot),
            TopperPrizeLabels = CollectTopperPrizeLabels(viewRoot),
            TopperPayoutAmounts = CollectTopperPayoutAmounts(viewRoot),
            CountdownLabel = ReadText(viewRoot.HudBar?.CountdownText),
            PlayerCountLabel = ReadText(viewRoot.HudBar?.RoomPlayerCountText),
            CreditLabel = ResolveDedicatedHudValue(
                GameManager.instance != null ? GameManager.instance.CreditBalance.ToString() : string.Empty,
                viewRoot.HudBar?.CreditText),
            WinningsLabel = ResolveDedicatedHudValue(
                GameManager.instance != null ? GameManager.instance.RoundWinnings.ToString() : string.Empty,
                viewRoot.HudBar?.WinningsText),
            BetLabel = ResolveDedicatedHudValue(
                GameManager.instance != null ? GameManager.instance.currentBet.ToString() : string.Empty,
                viewRoot.HudBar?.BetText)
        };

        return theme1RealtimeStateAdapter.Build(input);
    }

    private static string ResolveDedicatedHudValue(string authoritativeValue, TMP_Text target)
    {
        if (!string.IsNullOrWhiteSpace(authoritativeValue))
        {
            return authoritativeValue;
        }

        string value = ReadText(target);
        if (!string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        return "0";
    }

    private int[] CollectActivePatternIndexes()
    {
        NumberGenerator generator = ResolveNumberGenerator();
        List<int> activePatternIndexes = GetActivePatternIndexes(generator);
        return activePatternIndexes.ToArray();
    }

    private byte[][] CollectPatternMasks()
    {
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator == null || generator.patternList == null)
        {
            return Array.Empty<byte[]>();
        }

        byte[][] masks = new byte[generator.patternList.Count][];
        for (int i = 0; i < masks.Length; i++)
        {
            List<byte> pattern = generator.patternList[i] != null ? generator.patternList[i].pattern : null;
            masks[i] = pattern != null ? pattern.ToArray() : Array.Empty<byte>();
        }

        return masks;
    }

    private static int[][] CloneTicketSetsForBuilder(List<List<int>> ticketSets)
    {
        if (ticketSets == null || ticketSets.Count == 0)
        {
            return Array.Empty<int[]>();
        }

        int[][] clone = new int[ticketSets.Count][];
        for (int i = 0; i < ticketSets.Count; i++)
        {
            clone[i] = RealtimeTicketSetUtils.NormalizeTicketNumbers(ticketSets[i]).ToArray();
        }

        return clone;
    }

    private int[] ExtractDrawnNumbers(JSONNode currentGame)
    {
        JSONNode drawnNumbersNode = currentGame?["drawnNumbers"];
        if (drawnNumbersNode == null || drawnNumbersNode.IsNull || !drawnNumbersNode.IsArray)
        {
            return Array.Empty<int>();
        }

        int[] values = new int[drawnNumbersNode.Count];
        for (int i = 0; i < drawnNumbersNode.Count; i++)
        {
            values[i] = GameManager.NormalizeTheme1BallNumber(drawnNumbersNode[i].AsInt);
        }

        return FilterValidTheme1Numbers(values);
    }

    private string[] CollectCardHeaderLabels(Theme1GameplayViewRoot viewRoot)
    {
        int cardCount = viewRoot.Cards != null ? viewRoot.Cards.Length : 0;
        string[] labels = new string[cardCount];
        GameManager gameManager = GameManager.instance;
        for (int i = 0; i < cardCount; i++)
        {
            labels[i] = gameManager != null
                ? gameManager.GetCardIndexLabel(i)
                : GameManager.FormatTheme1CardHeaderLabel(i);
        }

        return labels;
    }

    private string[] CollectCardBetLabels(Theme1GameplayViewRoot viewRoot)
    {
        int cardCount = viewRoot.Cards != null ? viewRoot.Cards.Length : 0;
        string[] labels = new string[cardCount];
        GameManager gameManager = GameManager.instance;
        for (int i = 0; i < cardCount; i++)
        {
            labels[i] = gameManager != null
                ? gameManager.GetCardStakeLabel()
                : GameManager.FormatTheme1CardStakeLabel(0);
        }

        return labels;
    }

    private string[] CollectCardWinLabels(Theme1GameplayViewRoot viewRoot)
    {
        int cardCount = viewRoot.Cards != null ? viewRoot.Cards.Length : 0;
        string[] labels = new string[cardCount];
        GameManager gameManager = GameManager.instance;
        for (int i = 0; i < cardCount; i++)
        {
            int winAmount = gameManager != null ? gameManager.GetCardWinAmount(i) : 0;
            labels[i] = winAmount > 0
                ? (gameManager != null
                    ? gameManager.FormatCardWinLabel(winAmount)
                    : GameManager.FormatTheme1CardWinLabel(winAmount))
                : string.Empty;
        }

        return labels;
    }

    private string[] CollectTopperPrizeLabels(Theme1GameplayViewRoot viewRoot)
    {
        int slotCount = viewRoot.TopperStrip != null && viewRoot.TopperStrip.Slots != null ? viewRoot.TopperStrip.Slots.Length : 0;
        string[] labels = new string[slotCount];
        GameManager gameManager = GameManager.instance;
        for (int i = 0; i < slotCount; i++)
        {
            if (gameManager != null && gameManager.TryGetFormattedPayoutLabel(i, out string runtimeLabel))
            {
                labels[i] = runtimeLabel;
            }
            else
            {
                labels[i] = ReadText(viewRoot.TopperStrip.Slots[i]?.PrizeLabel);
            }
        }

        return labels;
    }

    private int[] CollectTopperPayoutAmounts(Theme1GameplayViewRoot viewRoot)
    {
        int slotCount = viewRoot.TopperStrip != null && viewRoot.TopperStrip.Slots != null ? viewRoot.TopperStrip.Slots.Length : 0;
        int[] payoutAmounts = new int[slotCount];
        GameManager gameManager = GameManager.instance;
        for (int i = 0; i < slotCount; i++)
        {
            payoutAmounts[i] = gameManager != null ? gameManager.GetPayoutForPatternSlot(i) : 0;
        }

        return payoutAmounts;
    }

    private static int[] FilterValidTheme1Numbers(IReadOnlyList<int> values)
    {
        if (values == null || values.Count == 0)
        {
            return Array.Empty<int>();
        }

        List<int> filtered = new List<int>(values.Count);
        for (int i = 0; i < values.Count; i++)
        {
            int normalized = GameManager.NormalizeTheme1BallNumber(values[i]);
            if (normalized > 0)
            {
                filtered.Add(normalized);
            }
        }

        return filtered.ToArray();
    }

    private void RegisterDedicatedTheme1RenderMetrics(Theme1GameplayViewRoot viewRoot, Theme1DisplayState renderState)
    {
        int renderedCardCellCount = 0;
        for (int cardIndex = 0; viewRoot.Cards != null && cardIndex < viewRoot.Cards.Length; cardIndex++)
        {
            Theme1CardGridView card = viewRoot.Cards[cardIndex];
            for (int cellIndex = 0; card?.Cells != null && cellIndex < card.Cells.Length; cellIndex++)
            {
                TextMeshProUGUI label = card.Cells[cellIndex]?.NumberLabel;
                if (label == null)
                {
                    continue;
                }

                renderedCardCellCount += 1;
                if (renderedCardCellCount == 1)
                {
                    RegisterRealtimeCardTarget(label);
                }
            }
        }

        RegisterRealtimeTicketRender(activeTicketSets != null ? activeTicketSets.Count : 0, renderedCardCellCount);

        Theme1BallRackView ballRackView = viewRoot.BallRack;
        if (renderState?.BallRack == null || ballRackView == null)
        {
            return;
        }

        int lastVisibleSlot = -1;
        for (int slotIndex = 0; renderState.BallRack.Slots != null && slotIndex < renderState.BallRack.Slots.Length; slotIndex++)
        {
            if (renderState.BallRack.Slots[slotIndex].IsVisible)
            {
                lastVisibleSlot = slotIndex;
            }
        }

        if (lastVisibleSlot < 0 || renderState.BallRack.Slots == null || lastVisibleSlot >= renderState.BallRack.Slots.Length)
        {
            return;
        }

        int renderedTextTargetCount = ballRackView.Slots != null ? ballRackView.Slots.Length : 0;
        Theme1BallSlotView slotView = ballRackView.Slots != null && lastVisibleSlot < ballRackView.Slots.Length
            ? ballRackView.Slots[lastVisibleSlot]
            : null;
        int drawnNumber = int.TryParse(renderState.BallRack.Slots[lastVisibleSlot].NumberLabel, out int parsedDrawnNumber)
            ? parsedDrawnNumber
            : 0;
        RegisterRealtimeBallRendered(
            drawnNumber,
            lastVisibleSlot,
            renderedTextTargetCount,
            slotView?.NumberLabel,
            ballRackView.BigBallText);
    }

    private static Dictionary<int, HashSet<int>> BuildWinningPatternsByCard(Theme1DisplayState renderState)
    {
        Dictionary<int, HashSet<int>> winningPatterns = new Dictionary<int, HashSet<int>>();
        if (renderState?.Cards == null)
        {
            return winningPatterns;
        }

        for (int cardIndex = 0; cardIndex < renderState.Cards.Length; cardIndex++)
        {
            Theme1CardRenderState card = renderState.Cards[cardIndex];
            HashSet<int> matched = new HashSet<int>();
            if (card?.MatchedPatternIndexes != null && card.MatchedPatternIndexes.Length > 0)
            {
                for (int i = 0; i < card.MatchedPatternIndexes.Length; i++)
                {
                    if (card.MatchedPatternIndexes[i] >= 0)
                    {
                        matched.Add(card.MatchedPatternIndexes[i]);
                    }
                }
            }
            else if (card?.PaylinesActive != null)
            {
                for (int paylineIndex = 0; paylineIndex < card.PaylinesActive.Length; paylineIndex++)
                {
                    if (card.PaylinesActive[paylineIndex])
                    {
                        matched.Add(paylineIndex);
                    }
                }
            }

            winningPatterns[cardIndex] = matched;
        }

        return winningPatterns;
    }

    private Dictionary<int, HashSet<int>> ResolveDedicatedWinningPatternsByCard(
        Theme1DisplayState renderState,
        JSONNode currentGame,
        RealtimeClaimInfo latestClaim,
        byte[][] patternMasks)
    {
        Dictionary<int, HashSet<int>> winningPatterns = BuildWinningPatternsByCard(renderState);
        if (renderState?.Cards == null || currentGame == null || currentGame.IsNull)
        {
            return winningPatterns;
        }

        HashSet<int> drawnNumbers = ExtractPositiveIntSet(currentGame["drawnNumbers"]);
        JSONNode visibleTicketNodes = ResolveCurrentPlayerVisibleTicketNodes(currentGame, renderState.Cards.Length);
        if (visibleTicketNodes == null || visibleTicketNodes.IsNull || !visibleTicketNodes.IsArray)
        {
            return winningPatterns;
        }

        HashSet<int> claimPatternIndexes = ExtractWinningPatternIndexes(
            latestClaim.ClaimNode,
            Math.Max(32, (patternMasks?.Length ?? 0) + 16));
        if (claimPatternIndexes.Count == 0)
        {
            return winningPatterns;
        }

        for (int cardIndex = 0; cardIndex < renderState.Cards.Length; cardIndex++)
        {
            JSONNode ticketNode = ResolveVisibleTicketNodeForCard(visibleTicketNodes, cardIndex, renderState.Cards.Length);
            if (ticketNode == null || ticketNode.IsNull)
            {
                continue;
            }

            Theme1CardRenderState cardState = renderState.Cards[cardIndex];
            if (cardState == null)
            {
                continue;
            }

            if (!winningPatterns.TryGetValue(cardIndex, out HashSet<int> matchedPatterns) || matchedPatterns == null)
            {
                matchedPatterns = new HashSet<int>();
                winningPatterns[cardIndex] = matchedPatterns;
            }

            foreach (int claimPatternIndex in claimPatternIndexes)
            {
                List<int> claimNumbers = ExtractBackendClaimPatternNumbers(ticketNode["grid"], claimPatternIndex);
                if (claimNumbers.Count == 0)
                {
                    continue;
                }

                int localPatternIndex = FindBestLocalPatternIndexForClaim(cardState, claimNumbers, patternMasks, drawnNumbers);
                if (localPatternIndex >= 0)
                {
                    matchedPatterns.Add(localPatternIndex);
                }
            }
        }

        return winningPatterns;
    }

    private JSONNode ResolveCurrentPlayerVisibleTicketNodes(JSONNode currentGame, int visibleCardCount)
    {
        if (currentGame == null || currentGame.IsNull || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return null;
        }

        JSONNode playerTickets = currentGame["tickets"]?[activePlayerId];
        if (playerTickets == null || playerTickets.IsNull || !playerTickets.IsArray)
        {
            return null;
        }

        return playerTickets;
    }

    private JSONNode ResolveVisibleTicketNodeForCard(JSONNode playerTicketsNode, int cardIndex, int cardSlots)
    {
        if (playerTicketsNode == null || playerTicketsNode.IsNull || !playerTicketsNode.IsArray || cardIndex < 0)
        {
            return null;
        }

        int resolvedCardSlots = Mathf.Max(1, cardSlots);
        int pageStartIndex = Mathf.Max(0, currentTicketPage) * resolvedCardSlots;
        int ticketIndex = pageStartIndex + cardIndex;
        if (ticketIndex < playerTicketsNode.Count)
        {
            return playerTicketsNode[ticketIndex];
        }

        if (duplicateTicketAcrossAllCards && playerTicketsNode.Count == 1)
        {
            return playerTicketsNode[0];
        }

        return null;
    }

    private static int FindBestLocalPatternIndexForClaim(
        Theme1CardRenderState cardState,
        IReadOnlyList<int> claimNumbers,
        IReadOnlyList<byte[]> patternMasks,
        HashSet<int> drawnNumbers)
    {
        if (cardState?.Cells == null || claimNumbers == null || claimNumbers.Count == 0 || patternMasks == null)
        {
            return -1;
        }

        int[] cardNumbers = ExtractPositiveCardNumbers(cardState);
        HashSet<int> claimNumberSet = new HashSet<int>(claimNumbers);
        int bestPatternIndex = -1;
        int bestScore = int.MinValue;

        for (int patternIndex = 0; patternIndex < patternMasks.Count; patternIndex++)
        {
            List<int> localPatternNumbers = ExtractPatternNumbers(cardNumbers, patternMasks[patternIndex]);
            if (localPatternNumbers.Count == 0)
            {
                continue;
            }

            int overlap = 0;
            bool allDrawn = true;
            HashSet<int> localPatternSet = new HashSet<int>();
            for (int i = 0; i < localPatternNumbers.Count; i++)
            {
                int number = localPatternNumbers[i];
                localPatternSet.Add(number);
                if (claimNumberSet.Contains(number))
                {
                    overlap += 1;
                }

                if (number <= 0 || drawnNumbers == null || !drawnNumbers.Contains(number))
                {
                    allDrawn = false;
                }
            }

            if (overlap <= 0)
            {
                continue;
            }

            bool exact = localPatternSet.SetEquals(claimNumberSet);
            int sizeDelta = Math.Abs(localPatternSet.Count - claimNumberSet.Count);
            int score = 0;
            if (exact)
            {
                score += 10000;
            }

            if (allDrawn)
            {
                score += 1000;
            }

            score += overlap * 100;
            score -= sizeDelta * 10;
            score -= patternIndex;

            if (score > bestScore)
            {
                bestScore = score;
                bestPatternIndex = patternIndex;
            }
        }

        return bestPatternIndex;
    }

    private static int[] ExtractPositiveCardNumbers(Theme1CardRenderState cardState)
    {
        int[] values = new int[cardState?.Cells != null ? cardState.Cells.Length : 0];
        if (cardState?.Cells == null)
        {
            return values;
        }

        for (int cellIndex = 0; cellIndex < cardState.Cells.Length; cellIndex++)
        {
            values[cellIndex] = TryParsePositiveInt(cardState.Cells[cellIndex].NumberLabel);
        }

        return values;
    }

    private static List<int> ExtractPatternNumbers(int[] cardNumbers, byte[] mask)
    {
        List<int> numbers = new List<int>();
        if (cardNumbers == null || mask == null)
        {
            return numbers;
        }

        int cellCount = Mathf.Min(cardNumbers.Length, mask.Length);
        for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
        {
            if (mask[cellIndex] != 1)
            {
                continue;
            }

            int number = cardNumbers[cellIndex];
            if (number > 0)
            {
                numbers.Add(number);
            }
        }

        return numbers;
    }

    private static void ApplyWinningPatternsToDedicatedState(
        Theme1DisplayState renderState,
        Dictionary<int, HashSet<int>> winningPatternsByCard,
        IReadOnlyList<byte[]> patternMasks)
    {
        if (renderState?.Cards == null || winningPatternsByCard == null)
        {
            return;
        }

        for (int cardIndex = 0; cardIndex < renderState.Cards.Length; cardIndex++)
        {
            Theme1CardRenderState cardState = renderState.Cards[cardIndex];
            if (cardState == null ||
                !winningPatternsByCard.TryGetValue(cardIndex, out HashSet<int> matchedPatterns) ||
                matchedPatterns == null ||
                matchedPatterns.Count == 0)
            {
                continue;
            }

            int paylineCount = Mathf.Max(cardState.PaylinesActive != null ? cardState.PaylinesActive.Length : 0, patternMasks != null ? patternMasks.Count : 0);
            bool[] paylines = new bool[paylineCount];
            if (cardState.PaylinesActive != null && cardState.PaylinesActive.Length > 0)
            {
                Array.Copy(cardState.PaylinesActive, paylines, Mathf.Min(cardState.PaylinesActive.Length, paylines.Length));
            }

            foreach (int patternIndex in matchedPatterns)
            {
                if (patternIndex >= 0 && patternIndex < paylines.Length)
                {
                    paylines[patternIndex] = true;
                }
            }

            cardState.PaylinesActive = paylines;
            cardState.MatchedPatternIndexes = new int[matchedPatterns.Count];
            matchedPatterns.CopyTo(cardState.MatchedPatternIndexes);
            Array.Sort(cardState.MatchedPatternIndexes);

            if (cardState.Cells == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < cardState.Cells.Length; cellIndex++)
            {
                Theme1CardCellRenderState cell = cardState.Cells[cellIndex];
                bool isMatched = cell.IsMatched || IsCellMatchedByPatternMasks(cellIndex, matchedPatterns, patternMasks);
                if (isMatched == cell.IsMatched)
                {
                    continue;
                }

                cardState.Cells[cellIndex] = new Theme1CardCellRenderState(
                    cell.NumberLabel,
                    cell.IsSelected,
                    cell.IsMissing,
                    isMatched,
                    cell.NearWinPatternIndex,
                    cell.MissingNumber,
                    cell.NearWinPatternIndexes);
            }
        }

        if (renderState.Topper?.Slots == null)
        {
            return;
        }

        for (int slotIndex = 0; slotIndex < renderState.Topper.Slots.Length; slotIndex++)
        {
            Theme1TopperSlotRenderState slotState = renderState.Topper.Slots[slotIndex];
            if (slotState == null)
            {
                continue;
            }

            bool isMatched = false;
            foreach (KeyValuePair<int, HashSet<int>> entry in winningPatternsByCard)
            {
                if (entry.Value == null)
                {
                    continue;
                }

                foreach (int patternIndex in entry.Value)
                {
                    if (GameManager.ResolvePayoutSlotIndex(patternIndex, renderState.Topper.Slots.Length) == slotIndex)
                    {
                        isMatched = true;
                        break;
                    }
                }

                if (isMatched)
                {
                    break;
                }
            }

            if (!isMatched)
            {
                continue;
            }

            slotState.ShowMatchedPattern = true;
            slotState.MissingCellsVisible = Array.Empty<bool>();
            slotState.PrizeVisualState = Theme1PrizeVisualState.Matched;
            if (winningPatternsByCard != null)
            {
                HashSet<int> activeCardIndexes = new HashSet<int>();
                HashSet<int> activePatternIndexes = new HashSet<int>();
                foreach (KeyValuePair<int, HashSet<int>> entry in winningPatternsByCard)
                {
                    if (entry.Value == null)
                    {
                        continue;
                    }

                    foreach (int patternIndex in entry.Value)
                    {
                        if (GameManager.ResolvePayoutSlotIndex(patternIndex, renderState.Topper.Slots.Length) == slotIndex)
                        {
                            activeCardIndexes.Add(entry.Key);
                            activePatternIndexes.Add(patternIndex);
                        }
                    }
                }

                slotState.ActiveCardIndexes = ToSortedArray(activeCardIndexes);
                slotState.ActivePatternIndexes = ToSortedArray(activePatternIndexes);
            }
        }
    }

    private void SyncLegacyTheme1MatchedPaylines(Dictionary<int, HashSet<int>> winningPatternsByCard)
    {
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator?.cardClasses == null)
        {
            return;
        }

        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null || card.paylineObj == null)
            {
                continue;
            }

            RealtimePaylineUtils.EnsurePaylineIndexCapacity(card, card.paylineObj.Count);
            bool[] activeFlags = new bool[card.paylineObj.Count];
            if (winningPatternsByCard != null && winningPatternsByCard.TryGetValue(cardIndex, out HashSet<int> matchedPatterns) && matchedPatterns != null)
            {
                foreach (int patternIndex in matchedPatterns)
                {
                    if (patternIndex >= 0 && patternIndex < activeFlags.Length)
                    {
                        activeFlags[patternIndex] = true;
                    }
                }
            }

            for (int patternIndex = 0; patternIndex < card.paylineObj.Count; patternIndex++)
            {
                bool active = activeFlags[patternIndex];
                card.paylineindex[patternIndex] = active;
                SetActiveIfChanged(card.paylineObj[patternIndex], active);
            }
        }
    }

    private static bool IsCellMatchedByPatternMasks(
        int cellIndex,
        HashSet<int> matchedPatterns,
        IReadOnlyList<byte[]> patternMasks)
    {
        if (cellIndex < 0 || matchedPatterns == null || matchedPatterns.Count == 0 || patternMasks == null)
        {
            return false;
        }

        foreach (int patternIndex in matchedPatterns)
        {
            if (patternIndex < 0 || patternIndex >= patternMasks.Count)
            {
                continue;
            }

            byte[] mask = patternMasks[patternIndex];
            if (mask != null && cellIndex < mask.Length && mask[cellIndex] == 1)
            {
                return true;
            }
        }

        return false;
    }

    private Dictionary<int, RealtimeNearWinState> BuildNearWinStates(Theme1DisplayState renderState)
    {
        Dictionary<int, RealtimeNearWinState> activeNearWinStates = new Dictionary<int, RealtimeNearWinState>();
        if (renderState?.Cards == null)
        {
            return activeNearWinStates;
        }

        for (int cardIndex = 0; cardIndex < renderState.Cards.Length; cardIndex++)
        {
            Theme1CardRenderState card = renderState.Cards[cardIndex];
            if (card?.Cells == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < card.Cells.Length; cellIndex++)
            {
                Theme1CardCellRenderState cell = card.Cells[cellIndex];
                if (!cell.IsMissing || cell.NearWinPatternIndexes == null || cell.NearWinPatternIndexes.Length == 0)
                {
                    continue;
                }

                int missingNumber = cell.MissingNumber > 0
                    ? cell.MissingNumber
                    : TryParsePositiveInt(cell.NumberLabel);
                for (int nearWinIndex = 0; nearWinIndex < cell.NearWinPatternIndexes.Length; nearWinIndex++)
                {
                    int rawPatternIndex = cell.NearWinPatternIndexes[nearWinIndex];
                    if (rawPatternIndex < 0)
                    {
                        continue;
                    }

                    int key = BuildNearWinKey(cardIndex, rawPatternIndex, cellIndex);
                    activeNearWinStates[key] =
                        new RealtimeNearWinState(rawPatternIndex, cardIndex, cellIndex, missingNumber);
                }
            }
        }

        return activeNearWinStates;
    }

    private static int[] ToSortedArray(HashSet<int> values)
    {
        if (values == null || values.Count == 0)
        {
            return Array.Empty<int>();
        }

        int[] result = new int[values.Count];
        values.CopyTo(result);
        Array.Sort(result);
        return result;
    }

    private static int TryParsePositiveInt(string value)
    {
        return int.TryParse(value, out int parsed) && parsed > 0 ? parsed : 0;
    }

    private static string ReadText(TMP_Text label)
    {
        return label != null ? (label.text ?? string.Empty) : string.Empty;
    }
}
