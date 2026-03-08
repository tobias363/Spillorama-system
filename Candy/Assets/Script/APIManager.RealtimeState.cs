using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using SimpleJSON;
using TMPro;
using UnityEngine;

public partial class APIManager
{
    private struct RealtimeClaimInfo
    {
        public string ClaimId;
        public string ClaimType;
        public JSONNode ClaimNode;
    }

    private readonly struct RealtimeNearWinState
    {
        public readonly int PatternIndex;
        public readonly int CardNo;
        public readonly int CellIndex;
        public readonly int MissingNumber;

        public RealtimeNearWinState(int patternIndex, int cardNo, int cellIndex, int missingNumber)
        {
            PatternIndex = patternIndex;
            CardNo = cardNo;
            CellIndex = cellIndex;
            MissingNumber = missingNumber;
        }
    }

    private string realtimeTicketFallbackLogKey = string.Empty;

    private void HandleRealtimeRoomUpdate(JSONNode snapshot)
    {
        if (ShouldUseDedicatedTheme1RealtimeView() &&
            TryResolveDedicatedTheme1GameplayView(out Theme1GameplayViewRoot dedicatedTheme1ViewRoot))
        {
            HandleRealtimeRoomUpdateDedicated(snapshot, dedicatedTheme1ViewRoot);
            return;
        }

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
            string previousGameId = activeGameId;
            bool shouldPreserveEndedRoundOverlay =
                !string.IsNullOrWhiteSpace(previousGameId) &&
                string.Equals(delayedOverlayResetGameId, previousGameId, StringComparison.Ordinal) &&
                !string.Equals(overlaysClearedForEndedGameId, previousGameId, StringComparison.Ordinal) &&
                TryShowEndedRoundResultsFromHistory(snapshot, previousGameId);

            realtimeScheduler.SetCurrentGameStatus("NONE");
            if (shouldPreserveEndedRoundOverlay)
            {
                overlaysClearedForEndedGameId = previousGameId;
                activeGameId = string.Empty;
                realtimePlayerParticipatingInCurrentRound = false;
                processedDrawCount = 0;
                currentTicketPage = 0;
                RefreshRealtimeCountdownLabel(forceRefresh: true);
                return;
            }

            if (!string.IsNullOrWhiteSpace(delayedOverlayResetGameId))
            {
                ResetRealtimeRoundVisuals();
                NumberGenerator endedRoundGenerator = ResolveNumberGenerator();
                if (endedRoundGenerator != null)
                {
                    endedRoundGenerator.ClearPaylineVisuals();
                }

                StopRealtimeMatchedPatternVisuals();
                StopRealtimeNearWinBlinking();
                ResetRealtimeBonusState(closeBonusPanel: true, previousGameId: delayedOverlayResetGameId);
                delayedOverlayResetGameId = string.Empty;
            }

            activeGameId = string.Empty;
            realtimePlayerParticipatingInCurrentRound = false;
            processedDrawCount = 0;
            currentTicketPage = 0;
            bool appliedPreRoundTickets = TryApplyPreRoundTicketsFromSnapshot(snapshot);
            if (appliedPreRoundTickets)
            {
                overlaysClearedForEndedGameId = string.IsNullOrWhiteSpace(previousGameId)
                    ? overlaysClearedForEndedGameId
                    : previousGameId;
            }
            else if (TryApplyCachedStableTickets())
            {
                overlaysClearedForEndedGameId = string.IsNullOrWhiteSpace(previousGameId)
                    ? overlaysClearedForEndedGameId
                    : previousGameId;
            }
            else if (preserveTicketNumbersOnTransientSnapshotGaps && activeTicketSets != null && activeTicketSets.Count > 0)
            {
                ApplyTicketSetsToCards(activeTicketSets);
                overlaysClearedForEndedGameId = string.IsNullOrWhiteSpace(previousGameId)
                    ? overlaysClearedForEndedGameId
                    : previousGameId;
            }
            else if (!string.IsNullOrWhiteSpace(previousGameId))
            {
                ClearRealtimeTicketCards();
                activeTicketSets.Clear();
                cachedStableTicketSets.Clear();
                realtimeTicketFallbackLogKey = string.Empty;
                overlaysClearedForEndedGameId = previousGameId;
            }
            else
            {
                if (TryApplyCachedStableTickets())
                {
                    // Behold siste gyldige preround-bonger hvis snapshotet mangler dem midlertidig.
                }
                else if (preserveTicketNumbersOnTransientSnapshotGaps && activeTicketSets != null && activeTicketSets.Count > 0)
                {
                    ApplyTicketSetsToCards(activeTicketSets);
                }
                else
                {
                    activeTicketSets.Clear();
                    realtimeTicketFallbackLogKey = string.Empty;
                }
            }
            RefreshRealtimeCountdownLabel(forceRefresh: true);
            return;
        }

        realtimeScheduler.SetCurrentGameStatus(currentGame["status"]);

        string gameId = currentGame["id"];
        if (string.IsNullOrWhiteSpace(gameId))
        {
            RefreshRealtimeCountdownLabel(forceRefresh: true);
            return;
        }

        if (!string.Equals(activeGameId, gameId, StringComparison.Ordinal))
        {
            string previousGameId = activeGameId;
            activeGameId = gameId;
            processedDrawCount = 0;
            currentTicketPage = 0;
            activeTicketSets.Clear();
            realtimeTicketFallbackLogKey = string.Empty;
            ResetRealtimeRoundVisuals();
            NumberGenerator nextRoundGenerator = ResolveNumberGenerator();
            if (nextRoundGenerator != null)
            {
                nextRoundGenerator.ClearPaylineVisuals();
            }

            StopRealtimeNearWinBlinking();
            ResetRealtimeBonusState(closeBonusPanel: true, previousGameId: previousGameId);
        }

        if (string.Equals(realtimeScheduler.LatestGameStatus, "ENDED", StringComparison.OrdinalIgnoreCase))
        {
            delayedOverlayResetGameId = gameId;
        }
        else if (string.Equals(delayedOverlayResetGameId, gameId, StringComparison.Ordinal))
        {
            delayedOverlayResetGameId = string.Empty;
        }

        bool isActiveRoundParticipant = ApplyVisibleTicketSetsForCurrentSnapshot(currentGame, snapshot);
        realtimePlayerParticipatingInCurrentRound = isActiveRoundParticipant;
        ApplyDrawnNumbers(currentGame, isActiveRoundParticipant);
        if (isActiveRoundParticipant)
        {
            RefreshRealtimeWinningPatternVisuals(currentGame);
        }
        else
        {
            ClearRealtimeTicketTransientVisuals();
            StopRealtimeMatchedPatternVisuals();
            StopRealtimeNearWinBlinking();
            ResetRealtimeBonusState(closeBonusPanel: true);
        }
        RefreshRealtimeCountdownLabel(forceRefresh: true);
    }

    private bool TryShowEndedRoundResultsFromHistory(JSONNode snapshot, string gameId)
    {
        if (snapshot == null || snapshot.IsNull || string.IsNullOrWhiteSpace(gameId))
        {
            return false;
        }

        JSONNode endedGame = FindHistoricGameById(snapshot["gameHistory"], gameId);
        if (endedGame == null || endedGame.IsNull)
        {
            return false;
        }

        if (GetLatestValidClaimForCurrentPlayer(endedGame).ClaimNode == null)
        {
            return false;
        }

        if (!TryApplyHistoricTicketsForEndedGame(endedGame, snapshot))
        {
            return false;
        }

        processedDrawCount = 0;
        ApplyDrawnNumbers(endedGame, shouldMarkCards: true);
        RefreshRealtimeWinningPatternVisuals(endedGame);
        return true;
    }

    private JSONNode FindHistoricGameById(JSONNode gameHistory, string gameId)
    {
        if (gameHistory == null || gameHistory.IsNull || !gameHistory.IsArray || string.IsNullOrWhiteSpace(gameId))
        {
            return null;
        }

        for (int i = gameHistory.Count - 1; i >= 0; i--)
        {
            JSONNode historicGame = gameHistory[i];
            if (historicGame == null || historicGame.IsNull)
            {
                continue;
            }

            string historicGameId = historicGame["id"];
            if (string.Equals(historicGameId?.Trim(), gameId, StringComparison.Ordinal))
            {
                return historicGame;
            }
        }

        return null;
    }

    private bool TryApplyHistoricTicketsForEndedGame(JSONNode historicGame, JSONNode snapshot)
    {
        if (historicGame == null || historicGame.IsNull)
        {
            return false;
        }

        return TryApplyTicketSetsFromNode(historicGame["tickets"], snapshot, allowFallbackTicketSource: false);
    }

    private bool ApplyVisibleTicketSetsForCurrentSnapshot(JSONNode currentGame, JSONNode snapshot)
    {
        if (TryApplyCurrentRoundTickets(currentGame, snapshot))
        {
            return true;
        }

        if (TryApplyPreRoundTicketsFromSnapshot(snapshot))
        {
            return false;
        }

        if (TryApplyCachedStableTickets())
        {
            return false;
        }

        ClearRealtimeTicketCards();
        activeTicketSets.Clear();
        cachedStableTicketSets.Clear();
        realtimeTicketFallbackLogKey = string.Empty;
        return false;
    }

    private bool TryApplyCurrentRoundTickets(JSONNode currentGame, JSONNode snapshot)
    {
        return TryApplyTicketSetsFromNode(currentGame?["tickets"], snapshot, allowFallbackTicketSource: true);
    }

    private bool TryApplyTicketSetsFromNode(JSONNode tickets, JSONNode snapshot, bool allowFallbackTicketSource)
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
        ApplyTicketSetsToCards(activeTicketSets);
        return true;
    }

    private bool TryApplyCachedStableTickets()
    {
        if (!preserveTicketNumbersOnTransientSnapshotGaps ||
            cachedStableTicketSets == null ||
            cachedStableTicketSets.Count == 0)
        {
            TryRequestRealtimeTicketStateResync();
            return false;
        }

        activeTicketSets = RealtimeTicketSetUtils.CloneTicketSets(cachedStableTicketSets);
        ApplyTicketSetsToCards(activeTicketSets);
        PublishRuntimeStatus(
            "Bruker siste gyldige preround-bonger fordi snapshotet midlertidig manglet preRoundTickets.",
            asError: false);
        TryRequestRealtimeTicketStateResync();
        return true;
    }

    private bool TryApplyPreRoundTicketsFromSnapshot(JSONNode snapshot)
    {
        if (snapshot == null || snapshot.IsNull)
        {
            return false;
        }

        JSONNode preRoundTickets = snapshot["preRoundTickets"];
        if (preRoundTickets == null || preRoundTickets.IsNull)
        {
            return false;
        }

        string ticketSourcePlayerId = ResolveRealtimePlayerIdFromSnapshot(snapshot, syncField: true);
        JSONNode myTicketsNode = null;
        if (!string.IsNullOrWhiteSpace(activePlayerId))
        {
            myTicketsNode = preRoundTickets[activePlayerId];
        }

        if ((myTicketsNode == null || myTicketsNode.IsNull) &&
            !string.IsNullOrWhiteSpace(ticketSourcePlayerId) &&
            !string.Equals(ticketSourcePlayerId, activePlayerId, StringComparison.Ordinal))
        {
            myTicketsNode = preRoundTickets[ticketSourcePlayerId];
        }

        bool usedFallbackTicketSource = false;
        if ((myTicketsNode == null || myTicketsNode.IsNull) && string.IsNullOrWhiteSpace(ticketSourcePlayerId))
        {
            usedFallbackTicketSource = TryResolveFallbackTicketSource(
                preRoundTickets,
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
        ApplyTicketSetsToCards(activeTicketSets);
        return true;
    }

    private string ResolveRealtimePlayerIdFromSnapshot(JSONNode snapshot, bool syncField)
    {
        string normalizedActivePlayerId = string.IsNullOrWhiteSpace(activePlayerId)
            ? string.Empty
            : activePlayerId.Trim();

        if (SnapshotContainsPlayerId(snapshot, normalizedActivePlayerId))
        {
            return normalizedActivePlayerId;
        }

        string resolvedPlayerId = RealtimeRoomStateUtils.ResolvePlayerIdFromSnapshot(snapshot, walletId, playerName);
        if (string.IsNullOrWhiteSpace(resolvedPlayerId))
        {
            return normalizedActivePlayerId;
        }

        if (syncField && !string.Equals(activePlayerId, resolvedPlayerId, StringComparison.Ordinal))
        {
            Debug.LogWarning(
                $"[APIManager] Justerer activePlayerId i realtime fra '{activePlayerId}' til '{resolvedPlayerId}' " +
                $"basert på snapshot/wallet mapping.");
            activePlayerId = resolvedPlayerId;
        }

        return resolvedPlayerId;
    }

    private static bool SnapshotContainsPlayerId(JSONNode snapshot, string playerId)
    {
        if (snapshot == null || snapshot.IsNull || string.IsNullOrWhiteSpace(playerId))
        {
            return false;
        }

        JSONNode players = snapshot["players"];
        if (players == null || players.IsNull || !players.IsArray)
        {
            return false;
        }

        for (int i = 0; i < players.Count; i++)
        {
            string candidateId = players[i]?["id"];
            if (string.Equals(candidateId?.Trim(), playerId, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private void TryRequestRealtimeTicketStateResync()
    {
        if (!useRealtimeBackend || realtimeClient == null || !realtimeClient.IsReady)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode))
        {
            return;
        }

        if (Time.unscaledTime < nextMissingRealtimeTicketsResyncAt)
        {
            return;
        }

        nextMissingRealtimeTicketsResyncAt = Time.unscaledTime + 0.75f;
        PublishRuntimeStatus(
            "Snapshot manglet preround-bonger. Ber om fersk room-state for resync.",
            asError: false);
        RequestRealtimeState();
    }

    private void ClearRealtimeTicketCards()
    {
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator == null || generator.cardClasses == null)
        {
            return;
        }

        generator.ApplyExplicitRealtimeCardViewBindingsFromComponent();
        TMP_FontAsset numberFallbackFont = RealtimeTextStyleUtils.ResolveFallbackFont();
        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null)
            {
                continue;
            }

            EnsureRealtimeCardBindings(card);
            card.numb.Clear();
            card.selectedPayLineCanBe.Clear();
            card.paylineindex.Clear();

            for (int i = 0; i < card.payLinePattern.Count; i++)
            {
                card.payLinePattern[i] = 0;
            }

            for (int i = 0; i < 15; i++)
            {
                card.numb.Add(0);
                if (i < card.num_text.Count)
                {
                    RealtimeTextStyleUtils.ApplyCardNumber(card.num_text[i], "-", numberFallbackFont);
                }
            }

            for (int i = 0; i < card.selectionImg.Count; i++)
            {
                SetActiveIfChanged(card.selectionImg[i], false);
            }
            for (int i = 0; i < card.missingPatternImg.Count; i++)
            {
                SetActiveIfChanged(card.missingPatternImg[i], false);
            }
            for (int i = 0; i < card.matchPatternImg.Count; i++)
            {
                SetActiveIfChanged(card.matchPatternImg[i], false);
            }
            if (card.paylineObj != null)
            {
                for (int i = 0; i < card.paylineObj.Count; i++)
                {
                    SetActiveIfChanged(card.paylineObj[i], false);
                }
            }

            if (card.win != null)
            {
                SetActiveIfChanged(card.win.gameObject, false);
            }
        }

        GameManager gameManager = GameManager.instance;
        if (gameManager != null)
        {
            if (gameManager.winAmtText != null)
            {
                RealtimeTextStyleUtils.ApplyHudText(gameManager.winAmtText, "0");
            }

            if (gameManager.displayCardWinPoints != null)
            {
                for (int i = 0; i < gameManager.displayCardWinPoints.Count; i++)
                {
                    if (gameManager.displayCardWinPoints[i] != null)
                    {
                        SetActiveIfChanged(gameManager.displayCardWinPoints[i].gameObject, false);
                    }
                }
            }
        }
    }

    private bool TryResolveFallbackTicketSource(
        JSONNode ticketsNode,
        out JSONNode fallbackTicketNode,
        out string fallbackPlayerId)
    {
        fallbackTicketNode = null;
        fallbackPlayerId = string.Empty;

        if (ticketsNode == null || ticketsNode.IsNull)
        {
            return false;
        }

        foreach (KeyValuePair<string, JSONNode> entry in ticketsNode.Linq)
        {
            JSONNode candidateNode = entry.Value;
            if (candidateNode == null || candidateNode.IsNull)
            {
                continue;
            }

            List<List<int>> candidateTicketSets = RealtimeTicketSetUtils.ExtractTicketSets(candidateNode);
            if (candidateTicketSets.Count == 0)
            {
                continue;
            }

            fallbackPlayerId = string.IsNullOrWhiteSpace(entry.Key) ? "<unknown-player>" : entry.Key;
            fallbackTicketNode = candidateNode;
            return true;
        }

        return false;
    }

    private void LogTicketSourceFallbackOnce(string sourcePlayerId, int ticketCount)
    {
        string gameKey = string.IsNullOrWhiteSpace(activeGameId) ? "<no-game>" : activeGameId;
        string sourceKey = string.IsNullOrWhiteSpace(sourcePlayerId) ? "<unknown-player>" : sourcePlayerId.Trim();
        string logKey = $"{gameKey}:{sourceKey}:{ticketCount}";
        if (string.Equals(realtimeTicketFallbackLogKey, logKey, StringComparison.Ordinal))
        {
            return;
        }

        realtimeTicketFallbackLogKey = logKey;
        string requestedPlayer = string.IsNullOrWhiteSpace(activePlayerId) ? "<empty>" : activePlayerId;
        Debug.LogWarning(
            $"[APIManager] Ticket fallback aktiv i realtime (Theme1): activePlayerId={requestedPlayer}, " +
            $"bruker tickets fra playerId={sourceKey} (ticketCount={ticketCount}) for visning.");
    }

    private void ApplyTicketSetsToCards(List<List<int>> ticketSets)
    {
        if (ticketSets == null || ticketSets.Count == 0)
        {
            return;
        }

        NumberGenerator generator = ResolveNumberGenerator();
        if (generator == null || generator.cardClasses == null)
        {
            return;
        }

        generator.ApplyExplicitRealtimeCardViewBindingsFromComponent();
        CandyCardViewBindingSet cardBindingSet = generator.GetComponent<CandyCardViewBindingSet>();
        if (cardBindingSet != null && !cardBindingSet.TryApplyTo(generator, out string bindingError))
        {
            PublishRuntimeStatus("Card bindings er ugyldige i Theme1. " + bindingError, asError: true);
            RegisterRealtimeTicketRender(ticketSets.Count, 0);
            return;
        }

        StopRealtimeNearWinBlinking();

        int cardSlots = Mathf.Max(1, generator.cardClasses.Length);
        int pageCount = Mathf.Max(1, Mathf.CeilToInt((float)ticketSets.Count / cardSlots));
        if (!enableTicketPaging)
        {
            currentTicketPage = 0;
        }

        if (currentTicketPage >= pageCount)
        {
            currentTicketPage = 0;
        }

        int pageStartIndex = currentTicketPage * cardSlots;
        TMP_FontAsset numberFallbackFont = RealtimeTextStyleUtils.ResolveFallbackFont();
        int populatedCards = 0;
        int renderedCardCells = 0;

        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null)
            {
                continue;
            }

            EnsureRealtimeCardBindings(card);

            card.numb.Clear();
            card.selectedPayLineCanBe.Clear();
            card.paylineindex.Clear();

            for (int i = 0; i < card.payLinePattern.Count; i++)
            {
                card.payLinePattern[i] = 0;
            }

            for (int i = 0; i < card.selectionImg.Count; i++)
            {
                SetActiveIfChanged(card.selectionImg[i], false);
            }

            for (int i = 0; i < card.missingPatternImg.Count; i++)
            {
                SetActiveIfChanged(card.missingPatternImg[i], false);
            }

            for (int i = 0; i < card.matchPatternImg.Count; i++)
            {
                SetActiveIfChanged(card.matchPatternImg[i], false);
            }

            int paylineCount = card.paylineObj != null ? card.paylineObj.Count : 0;
            for (int i = 0; i < paylineCount; i++)
            {
                SetActiveIfChanged(card.paylineObj[i], false);
            }

            List<int> sourceTicket = null;
            int ticketIndex = pageStartIndex + cardIndex;
            if (ticketIndex < ticketSets.Count)
            {
                sourceTicket = RealtimeTicketSetUtils.NormalizeTicketNumbers(ticketSets[ticketIndex]);
            }
            else if (duplicateTicketAcrossAllCards && ticketSets.Count == 1)
            {
                sourceTicket = RealtimeTicketSetUtils.NormalizeTicketNumbers(ticketSets[0]);
            }

            bool shouldPopulate = sourceTicket != null;
            if (shouldPopulate)
            {
                populatedCards++;
            }
            for (int cellIndex = 0; cellIndex < 15; cellIndex++)
            {
                int value = shouldPopulate ? sourceTicket[cellIndex] : 0;
                card.numb.Add(value);

                if (cellIndex < card.num_text.Count)
                {
                    TextMeshProUGUI cardLabel = card.num_text[cellIndex];
                    RealtimeTextStyleUtils.ApplyCardNumber(
                        cardLabel,
                        value > 0 ? value.ToString() : "-",
                        numberFallbackFont);
                    if (cardLabel != null)
                    {
                        renderedCardCells += 1;
                        RegisterRealtimeCardTarget(cardLabel);
                    }
                }
            }
        }

        RegisterRealtimeTicketRender(ticketSets.Count, renderedCardCells);

        int expectedCardsWithTickets = Mathf.Min(cardSlots, Mathf.Max(1, realtimeTicketsPerPlayer));
        if (populatedCards < expectedCardsWithTickets)
        {
            PublishRuntimeStatus(
                $"Manglende bonger i snapshot. Fikk {populatedCards}/{expectedCardsWithTickets} aktive bonger i rom {activeRoomCode}.",
                asError: true);
        }

        if (logBootstrapEvents)
        {
            Debug.Log($"[APIManager] Applied ticket page {currentTicketPage + 1}/{pageCount} ({ticketSets.Count} total ticket(s)) for player {activePlayerId}. Room {activeRoomCode}, game {activeGameId}");
        }
    }

    private static void EnsureRealtimeCardBindings(CardClass card)
    {
        if (card == null)
        {
            return;
        }

        if (card.payLinePattern == null)
        {
            card.payLinePattern = new List<byte>(15);
        }

        while (card.payLinePattern.Count < 15)
        {
            card.payLinePattern.Add(0);
        }

        if (card.num_text == null)
        {
            card.num_text = new List<TextMeshProUGUI>(15);
        }

        bool needsNumberRebind = card.num_text.Count < 15;
        if (!needsNumberRebind)
        {
            for (int i = 0; i < 15; i++)
            {
                if (card.num_text[i] == null)
                {
                    needsNumberRebind = true;
                    break;
                }
            }
        }

        if (!needsNumberRebind)
        {
            return;
        }

        while (card.num_text.Count < 15)
        {
            card.num_text.Add(null);
        }

        int selectionCount = card.selectionImg != null ? card.selectionImg.Count : 0;
        int cellCount = Mathf.Min(15, selectionCount);
        for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
        {
            if (card.num_text[cellIndex] != null)
            {
                continue;
            }

            GameObject selectionCell = card.selectionImg[cellIndex];
            if (selectionCell == null)
            {
                continue;
            }

            TextMeshProUGUI resolved = Theme1GameplayViewRepairUtils.FindDedicatedCardNumberLabel(selectionCell);

            card.num_text[cellIndex] = resolved;
        }
    }

    private void ApplyDrawnNumbers(JSONNode currentGame, bool shouldMarkCards)
    {
        JSONNode drawnNumbers = currentGame["drawnNumbers"];
        if (drawnNumbers == null || drawnNumbers.IsNull || !drawnNumbers.IsArray)
        {
            return;
        }

        NumberGenerator generator = ResolveNumberGenerator();
        bool canMarkCards = shouldMarkCards && generator != null && generator.cardClasses != null;
        bool shouldTrace = ShouldLogRealtimeDrawTrace();

        int previousProcessedDrawCount = Mathf.Max(0, processedDrawCount);
        for (int drawIndex = 0; drawIndex < drawnNumbers.Count; drawIndex++)
        {
            int drawnNumber = drawnNumbers[drawIndex].AsInt;
            bool isValidTheme1Number = GameManager.IsValidTheme1BallNumber(drawnNumber);
            if (canMarkCards && isValidTheme1Number)
            {
                RealtimeTicketSetUtils.MarkDrawnNumberOnCards(generator, drawnNumber);
            }

            if (drawIndex < previousProcessedDrawCount)
            {
                continue;
            }

            if (!isValidTheme1Number)
            {
                PublishRuntimeStatus(
                    $"Ignorerer ugyldig Theme1 draw-nummer {drawnNumber}. Theme1 tillater kun 1-{GameManager.Theme1MaxBallNumber}.",
                    asError: true);
                continue;
            }

            RegisterRealtimeDrawObserved(drawnNumbers.Count, drawnNumber);
            ShowRealtimeDrawBall(drawIndex, drawnNumber);

            if (shouldTrace)
            {
                int markedCells = canMarkCards ? CountMarkedCells(generator) : 0;
                Debug.Log(
                    $"[candy-draw] game={activeGameId} drawIndex={drawIndex + 1} number={drawnNumber} " +
                    $"drawnCount={drawnNumbers.Count} markedCells={markedCells} canMark={canMarkCards}");
                Debug.Log(
                    $"[draw] draw_rendered game={activeGameId} idx={drawIndex + 1} " +
                    $"number={drawnNumber} markedCells={markedCells} canMark={canMarkCards}");
            }

            if (autoMarkDrawnNumbers &&
                shouldMarkCards &&
                RealtimeTicketSetUtils.TicketContainsInAnyTicketSet(activeTicketSets, drawnNumber) &&
                !string.IsNullOrWhiteSpace(activeRoomCode) &&
                !string.IsNullOrWhiteSpace(activePlayerId) &&
                realtimeClient != null &&
                realtimeClient.IsReady)
            {
                realtimeClient.MarkNumber(activeRoomCode, activePlayerId, drawnNumber, null);
            }
        }

        processedDrawCount = drawnNumbers.Count;
    }

    private void ClearRealtimeTicketTransientVisuals()
    {
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator == null || generator.cardClasses == null)
        {
            return;
        }

        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null)
            {
                continue;
            }

            EnsureRealtimeCardBindings(card);
            card.selectedPayLineCanBe.Clear();
            card.paylineindex.Clear();

            for (int i = 0; i < card.payLinePattern.Count; i++)
            {
                card.payLinePattern[i] = 0;
            }

            for (int i = 0; i < card.selectionImg.Count; i++)
            {
                SetActiveIfChanged(card.selectionImg[i], false);
            }

            for (int i = 0; i < card.missingPatternImg.Count; i++)
            {
                SetActiveIfChanged(card.missingPatternImg[i], false);
            }

            for (int i = 0; i < card.matchPatternImg.Count; i++)
            {
                SetActiveIfChanged(card.matchPatternImg[i], false);
            }

            if (card.paylineObj != null)
            {
                for (int i = 0; i < card.paylineObj.Count; i++)
                {
                    SetActiveIfChanged(card.paylineObj[i], false);
                }
            }

            if (card.win != null)
            {
                SetActiveIfChanged(card.win.gameObject, false);
            }
        }

        GameManager gameManager = GameManager.instance;
        if (gameManager?.winAmtText != null)
        {
            RealtimeTextStyleUtils.ApplyHudText(gameManager.winAmtText, "0");
        }

        if (gameManager?.displayCardWinPoints == null)
        {
            return;
        }

        for (int i = 0; i < gameManager.displayCardWinPoints.Count; i++)
        {
            if (gameManager.displayCardWinPoints[i] != null)
            {
                SetActiveIfChanged(gameManager.displayCardWinPoints[i].gameObject, false);
            }
        }
    }

    private int CountMarkedCells(NumberGenerator generator)
    {
        if (generator == null || generator.cardClasses == null)
        {
            return 0;
        }

        int total = 0;
        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null || card.payLinePattern == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < card.payLinePattern.Count; cellIndex++)
            {
                if (card.payLinePattern[cellIndex] == 1)
                {
                    total++;
                }
            }
        }

        return total;
    }

    private void RefreshRealtimeWinningPatternVisuals(JSONNode currentGame)
    {
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator == null || generator.cardClasses == null || generator.patternList == null)
        {
            StopRealtimeMatchedPatternVisuals();
            StopRealtimeNearWinBlinking();
            return;
        }

        List<int> activePatternIndexes = GetActivePatternIndexes(generator);
        if (activePatternIndexes.Count == 0)
        {
            generator.ClearPaylineVisuals();
            StopRealtimeMatchedPatternVisuals();
            StopRealtimeNearWinBlinking();
            NumberGenerator.isPrizeMissedByOneCard = false;
            RefreshRealtimeBonusFlow(currentGame, default, null);
            return;
        }

        RealtimeClaimInfo latestClaim = GetLatestValidClaimForCurrentPlayer(currentGame);
        Dictionary<int, HashSet<int>> winningPatternsByCard = ResolveWinningPatternsByCard(
            generator,
            activePatternIndexes,
            latestClaim,
            currentGame);

        LogRealtimeWinningPatternResolution(currentGame, latestClaim, winningPatternsByCard);

        SyncRealtimeMatchedPatternVisuals(winningPatternsByCard);

        Dictionary<int, RealtimeNearWinState> activeNearWinStates = new();
        for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
        {
            CardClass card = generator.cardClasses[cardNo];
            if (card == null)
            {
                continue;
            }

            HashSet<int> wonPatternIndexes = winningPatternsByCard.TryGetValue(cardNo, out HashSet<int> resolvedWonPatternIndexes)
                ? resolvedWonPatternIndexes
                : null;

            ApplyTicketStateVisualsForCard(
                generator,
                cardNo,
                activePatternIndexes,
                wonPatternIndexes,
                activeNearWinStates);
        }

        SyncRealtimeNearWinBlinking(activeNearWinStates);
        NumberGenerator.isPrizeMissedByOneCard = activeNearWinStates.Count > 0;
        RefreshRealtimeBonusFlow(currentGame, latestClaim, winningPatternsByCard);
    }

    private RealtimeClaimInfo GetLatestValidClaimForCurrentPlayer(JSONNode currentGame)
    {
        if (currentGame == null || currentGame.IsNull || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return default;
        }

        JSONNode claims = currentGame["claims"];
        if (claims == null || claims.IsNull || !claims.IsArray)
        {
            return default;
        }

        for (int i = claims.Count - 1; i >= 0; i--)
        {
            JSONNode claim = claims[i];
            if (claim == null || claim.IsNull || !claim["valid"].AsBool)
            {
                continue;
            }

            string claimPlayerId = claim["playerId"];
            if (!string.Equals(claimPlayerId?.Trim(), activePlayerId, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            string claimType = claim["type"];
            if (string.Equals(claimType, "LINE", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(claimType, "BINGO", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(claimType, "BONUS", StringComparison.OrdinalIgnoreCase))
            {
                if (ShouldLogRealtimeDrawTrace())
                {
                    Debug.Log(
                        $"[candy-claim] game={currentGame["id"]} playerId={activePlayerId} " +
                        $"claimId={claim["id"]} type={claimType} valid={claim["valid"]} " +
                        $"patternIndex={claim["patternIndex"]} winningPatternIndex={claim["winningPatternIndex"]}");
                }

                return new RealtimeClaimInfo
                {
                    ClaimId = claim["id"],
                    ClaimType = claimType.Trim().ToUpperInvariant(),
                    ClaimNode = claim
                };
            }
        }

        return default;
    }

    private void LogRealtimeWinningPatternResolution(
        JSONNode currentGame,
        RealtimeClaimInfo latestClaim,
        Dictionary<int, HashSet<int>> winningPatternsByCard)
    {
        if (!ShouldLogRealtimeDrawTrace())
        {
            return;
        }

        string gameId = currentGame?["id"];
        string gameStatus = currentGame?["status"];
        string claimId = string.IsNullOrWhiteSpace(latestClaim.ClaimId) ? "<none>" : latestClaim.ClaimId;
        string claimType = string.IsNullOrWhiteSpace(latestClaim.ClaimType) ? "<none>" : latestClaim.ClaimType;
        int totalWinningPatterns = CountMatchedPatterns(winningPatternsByCard);
        string cardSummary = BuildWinningPatternCardSummary(winningPatternsByCard);

        Debug.Log(
            $"[candy-claim] resolve game={gameId} status={gameStatus} playerId={activePlayerId} " +
            $"claimId={claimId} type={claimType} totalWinningPatterns={totalWinningPatterns} cards={cardSummary}");
    }

    private static string BuildWinningPatternCardSummary(Dictionary<int, HashSet<int>> winningPatternsByCard)
    {
        if (winningPatternsByCard == null || winningPatternsByCard.Count == 0)
        {
            return "<none>";
        }

        List<string> entries = new();
        foreach (KeyValuePair<int, HashSet<int>> entry in winningPatternsByCard)
        {
            if (entry.Value == null || entry.Value.Count == 0)
            {
                continue;
            }

            List<int> sortedIndexes = new(entry.Value);
            sortedIndexes.Sort();
            entries.Add($"card{entry.Key}=[{string.Join(",", sortedIndexes)}]");
        }

        return entries.Count > 0 ? string.Join(";", entries) : "<none>";
    }

    private List<int> GetActivePatternIndexes(NumberGenerator generator)
    {
        List<int> activePatternIndexes = new();
        if (generator == null || generator.patternList == null || generator.patternList.Count == 0)
        {
            return activePatternIndexes;
        }

        bool preferAllRealtimePatterns = useRealtimeBackend &&
                                         (NumberManager.instance == null ||
                                          NumberManager.instance.currentPatternIndex == null ||
                                          NumberManager.instance.currentPatternIndex.Count == 0);
        if (preferAllRealtimePatterns)
        {
            for (int patternIndex = 0; patternIndex < generator.patternList.Count; patternIndex++)
            {
                activePatternIndexes.Add(patternIndex);
            }

            return activePatternIndexes;
        }

        HashSet<int> uniquePatternIndexes = new();
        List<int> selectedPatterns = generator.totalSelectedPatterns;
        if (selectedPatterns != null)
        {
            for (int i = 0; i < selectedPatterns.Count; i++)
            {
                int patternIndex = selectedPatterns[i];
                if (patternIndex < 0 || patternIndex >= generator.patternList.Count)
                {
                    continue;
                }

                if (uniquePatternIndexes.Add(patternIndex))
                {
                    activePatternIndexes.Add(patternIndex);
                }
            }
        }

        if (activePatternIndexes.Count == 0)
        {
            for (int patternIndex = 0; patternIndex < generator.patternList.Count; patternIndex++)
            {
                activePatternIndexes.Add(patternIndex);
            }
        }

        return activePatternIndexes;
    }

    private Dictionary<int, HashSet<int>> ResolveWinningPatternsByCard(
        NumberGenerator generator,
        List<int> activePatternIndexes,
        RealtimeClaimInfo latestClaim,
        JSONNode currentGame)
    {
        Dictionary<int, HashSet<int>> winningPatternsByCard = new();
        if (generator == null || generator.cardClasses == null || generator.patternList == null)
        {
            return winningPatternsByCard;
        }

        for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
        {
            winningPatternsByCard[cardNo] = new HashSet<int>();
        }

        HashSet<int> explicitWinningPatternIndexes = ExtractWinningPatternIndexes(
            latestClaim.ClaimNode,
            generator.patternList.Count);

        List<int> candidatePatternIndexes = explicitWinningPatternIndexes.Count > 0
            ? BuildOrderedPatternPriority(activePatternIndexes, explicitWinningPatternIndexes)
            : activePatternIndexes;

        for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
        {
            CardClass card = generator.cardClasses[cardNo];
            if (card == null)
            {
                continue;
            }

            winningPatternsByCard[cardNo] = FindMatchedPatternIndexes(
                card,
                generator.patternList,
                candidatePatternIndexes);
        }

        if (latestClaim.ClaimNode != null &&
            !latestClaim.ClaimNode.IsNull &&
            CountMatchedPatterns(winningPatternsByCard) == 0)
        {
            List<int> allPatternIndexes = new(generator.patternList.Count);
            for (int patternIndex = 0; patternIndex < generator.patternList.Count; patternIndex++)
            {
                allPatternIndexes.Add(patternIndex);
            }

            for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
            {
                CardClass card = generator.cardClasses[cardNo];
                if (card == null)
                {
                    continue;
                }

                winningPatternsByCard[cardNo] = FindMatchedPatternIndexes(
                    card,
                    generator.patternList,
                    allPatternIndexes);
            }

            if (CountMatchedPatterns(winningPatternsByCard) == 0)
            {
                bool assignedFromBackendClaim = TryAssignBackendClaimPatternVisual(
                    currentGame,
                    latestClaim,
                    generator.patternList.Count,
                    winningPatternsByCard);

                if (!assignedFromBackendClaim)
                {
                    TryAssignFallbackClaimVisual(generator, latestClaim, winningPatternsByCard);
                }
            }
        }

        return winningPatternsByCard;
    }

    private static int CountMatchedPatterns(Dictionary<int, HashSet<int>> winningPatternsByCard)
    {
        if (winningPatternsByCard == null)
        {
            return 0;
        }

        int total = 0;
        foreach (HashSet<int> winningPatterns in winningPatternsByCard.Values)
        {
            if (winningPatterns == null)
            {
                continue;
            }

            total += winningPatterns.Count;
        }

        return total;
    }

    private bool TryAssignFallbackClaimVisual(
        NumberGenerator generator,
        RealtimeClaimInfo latestClaim,
        Dictionary<int, HashSet<int>> winningPatternsByCard)
    {
        if (generator == null ||
            generator.cardClasses == null ||
            generator.patternList == null ||
            latestClaim.ClaimNode == null ||
            latestClaim.ClaimNode.IsNull)
        {
            return false;
        }

        List<int> candidatePatternIndexes = BuildFallbackPatternCandidates(latestClaim, generator.patternList.Count);
        if (candidatePatternIndexes.Count == 0)
        {
            return false;
        }

        int bestCardNo = -1;
        int bestPatternIndex = -1;
        int bestMatchedCells = -1;
        int bestRequiredCells = int.MaxValue;

        for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
        {
            CardClass card = generator.cardClasses[cardNo];
            if (card == null)
            {
                continue;
            }

            for (int i = 0; i < candidatePatternIndexes.Count; i++)
            {
                int patternIndex = candidatePatternIndexes[i];
                if (patternIndex < 0 || patternIndex >= generator.patternList.Count)
                {
                    continue;
                }

                int matchedCells = CountMatchedPatternCells(card, generator.patternList[patternIndex].pattern, out int requiredCells);
                if (matchedCells <= 0)
                {
                    continue;
                }

                bool isBetterCandidate = matchedCells > bestMatchedCells ||
                                         (matchedCells == bestMatchedCells && requiredCells < bestRequiredCells) ||
                                         (matchedCells == bestMatchedCells &&
                                          requiredCells == bestRequiredCells &&
                                          (bestPatternIndex < 0 || patternIndex < bestPatternIndex));
                if (!isBetterCandidate)
                {
                    continue;
                }

                bestCardNo = cardNo;
                bestPatternIndex = patternIndex;
                bestMatchedCells = matchedCells;
                bestRequiredCells = requiredCells;
            }
        }

        if (bestCardNo < 0 || bestPatternIndex < 0)
        {
            return false;
        }

        if (!winningPatternsByCard.TryGetValue(bestCardNo, out HashSet<int> winningPatterns) || winningPatterns == null)
        {
            winningPatterns = new HashSet<int>();
            winningPatternsByCard[bestCardNo] = winningPatterns;
        }

        winningPatterns.Add(bestPatternIndex);
        return true;
    }

    private bool TryAssignBackendClaimPatternVisual(
        JSONNode currentGame,
        RealtimeClaimInfo latestClaim,
        int generatorPatternCount,
        Dictionary<int, HashSet<int>> winningPatternsByCard)
    {
        if (currentGame == null ||
            currentGame.IsNull ||
            latestClaim.ClaimNode == null ||
            latestClaim.ClaimNode.IsNull ||
            generatorPatternCount <= 0 ||
            string.IsNullOrWhiteSpace(activePlayerId))
        {
            return false;
        }

        HashSet<int> claimPatternIndexes = ExtractWinningPatternIndexes(latestClaim.ClaimNode, generatorPatternCount);
        if (claimPatternIndexes.Count == 0)
        {
            return false;
        }

        JSONNode playerTickets = currentGame["tickets"]?[activePlayerId];
        if (playerTickets == null || playerTickets.IsNull || !playerTickets.IsArray)
        {
            return false;
        }

        HashSet<int> drawnNumbers = ExtractPositiveIntSet(currentGame["drawnNumbers"]);
        if (drawnNumbers.Count == 0)
        {
            return false;
        }

        bool assigned = false;
        foreach (int patternIndex in claimPatternIndexes)
        {
            int resolvedPatternIndex = Mathf.Clamp(patternIndex, 0, generatorPatternCount - 1);
            int bestCardIndex = -1;
            int bestMatchCount = -1;
            bool hasCompleteMatch = false;

            for (int ticketIndex = 0; ticketIndex < playerTickets.Count; ticketIndex++)
            {
                JSONNode ticketNode = playerTickets[ticketIndex];
                int matchedCells = CountMatchedBackendClaimPatternCells(ticketNode?["grid"], patternIndex, drawnNumbers, out bool isComplete);
                if (matchedCells <= 0 && !isComplete)
                {
                    continue;
                }

                if (isComplete)
                {
                    if (!winningPatternsByCard.TryGetValue(ticketIndex, out HashSet<int> winningPatterns) || winningPatterns == null)
                    {
                        winningPatterns = new HashSet<int>();
                        winningPatternsByCard[ticketIndex] = winningPatterns;
                    }

                    winningPatterns.Add(resolvedPatternIndex);
                    assigned = true;
                    hasCompleteMatch = true;
                }
                else if (!hasCompleteMatch && matchedCells > bestMatchCount)
                {
                    bestMatchCount = matchedCells;
                    bestCardIndex = ticketIndex;
                }
            }

            if (!hasCompleteMatch && bestCardIndex >= 0)
            {
                if (!winningPatternsByCard.TryGetValue(bestCardIndex, out HashSet<int> winningPatterns) || winningPatterns == null)
                {
                    winningPatterns = new HashSet<int>();
                    winningPatternsByCard[bestCardIndex] = winningPatterns;
                }

                winningPatterns.Add(resolvedPatternIndex);
                assigned = true;
            }
        }

        return assigned;
    }

    private static HashSet<int> ExtractPositiveIntSet(JSONNode valuesNode)
    {
        HashSet<int> values = new();
        if (valuesNode == null || valuesNode.IsNull || !valuesNode.IsArray)
        {
            return values;
        }

        for (int i = 0; i < valuesNode.Count; i++)
        {
            int value = valuesNode[i].AsInt;
            if (value > 0)
            {
                values.Add(value);
            }
        }

        return values;
    }

    private static int CountMatchedBackendClaimPatternCells(
        JSONNode gridNode,
        int patternIndex,
        HashSet<int> drawnNumbers,
        out bool isComplete)
    {
        isComplete = false;
        List<int> patternNumbers = ExtractBackendClaimPatternNumbers(gridNode, patternIndex);
        if (patternNumbers.Count == 0 || drawnNumbers == null || drawnNumbers.Count == 0)
        {
            return 0;
        }

        int matchedCells = 0;
        for (int i = 0; i < patternNumbers.Count; i++)
        {
            if (drawnNumbers.Contains(patternNumbers[i]))
            {
                matchedCells += 1;
            }
        }

        isComplete = matchedCells >= patternNumbers.Count;
        return matchedCells;
    }

    private static List<int> ExtractBackendClaimPatternNumbers(JSONNode gridNode, int patternIndex)
    {
        List<int> numbers = new();
        if (gridNode == null || gridNode.IsNull || !gridNode.IsArray || gridNode.Count == 0)
        {
            return numbers;
        }

        int rowCount = gridNode.Count;
        int colCount = gridNode[0] != null && gridNode[0].IsArray ? gridNode[0].Count : 0;
        if (colCount <= 0)
        {
            return numbers;
        }

        if (patternIndex >= 0 && patternIndex < rowCount)
        {
            AppendPositivePatternNumbers(gridNode[patternIndex], numbers);
            return numbers;
        }

        int columnPatternOffset = rowCount;
        if (patternIndex >= columnPatternOffset && patternIndex < columnPatternOffset + colCount)
        {
            int columnIndex = patternIndex - columnPatternOffset;
            for (int rowIndex = 0; rowIndex < rowCount; rowIndex++)
            {
                int value = gridNode[rowIndex]?[columnIndex].AsInt ?? 0;
                if (value > 0)
                {
                    numbers.Add(value);
                }
            }

            return numbers;
        }

        int diagonalPatternOffset = rowCount + colCount;
        if (patternIndex == diagonalPatternOffset)
        {
            int diagonalLength = Mathf.Min(rowCount, colCount);
            for (int i = 0; i < diagonalLength; i++)
            {
                int value = gridNode[i]?[i].AsInt ?? 0;
                if (value > 0)
                {
                    numbers.Add(value);
                }
            }

            return numbers;
        }

        if (patternIndex == diagonalPatternOffset + 1)
        {
            int diagonalLength = Mathf.Min(rowCount, colCount);
            for (int i = 0; i < diagonalLength; i++)
            {
                int value = gridNode[i]?[colCount - 1 - i].AsInt ?? 0;
                if (value > 0)
                {
                    numbers.Add(value);
                }
            }
        }

        return numbers;
    }

    private static void AppendPositivePatternNumbers(JSONNode rowNode, List<int> target)
    {
        if (rowNode == null || rowNode.IsNull || !rowNode.IsArray || target == null)
        {
            return;
        }

        for (int i = 0; i < rowNode.Count; i++)
        {
            int value = rowNode[i].AsInt;
            if (value > 0)
            {
                target.Add(value);
            }
        }
    }

    private List<int> BuildFallbackPatternCandidates(RealtimeClaimInfo latestClaim, int patternCount)
    {
        List<int> candidates = new();
        if (patternCount <= 0)
        {
            return candidates;
        }

        HashSet<int> seen = new();
        HashSet<int> explicitWinningPatternIndexes = ExtractWinningPatternIndexes(latestClaim.ClaimNode, patternCount);
        foreach (int patternIndex in explicitWinningPatternIndexes)
        {
            if (seen.Add(patternIndex))
            {
                candidates.Add(patternIndex);
            }

            int payoutSlotIndex = GameManager.ResolvePayoutSlotIndex(patternIndex, patternCount);
            if (payoutSlotIndex >= 0 && seen.Add(payoutSlotIndex))
            {
                candidates.Add(payoutSlotIndex);
            }
        }

        for (int patternIndex = 0; patternIndex < patternCount; patternIndex++)
        {
            if (seen.Add(patternIndex))
            {
                candidates.Add(patternIndex);
            }
        }

        return candidates;
    }

    private int CountMatchedPatternCells(CardClass card, List<byte> patternMask, out int requiredCells)
    {
        requiredCells = 0;
        if (card == null || patternMask == null || card.payLinePattern == null)
        {
            return 0;
        }

        int matchedCells = 0;
        int cellCount = Mathf.Min(patternMask.Count, card.payLinePattern.Count);
        for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
        {
            if (patternMask[cellIndex] != 1)
            {
                continue;
            }

            requiredCells += 1;
            if (card.payLinePattern[cellIndex] == 1)
            {
                matchedCells += 1;
            }
        }

        return matchedCells;
    }

    private HashSet<int> ExtractWinningPatternIndexes(JSONNode claimNode, int patternCount)
    {
        HashSet<int> winningIndexes = new();
        if (claimNode == null || claimNode.IsNull || patternCount <= 0)
        {
            return winningIndexes;
        }

        AddWinningPatternIndex(claimNode["patternIndex"], patternCount, winningIndexes);
        AddWinningPatternIndex(claimNode["winningPatternIndex"], patternCount, winningIndexes);
        AddWinningPatternIndex(claimNode["lineIndex"], patternCount, winningIndexes);
        AddWinningPatternIndexesFromArray(claimNode["patternIndexes"], patternCount, winningIndexes);
        AddWinningPatternIndexesFromArray(claimNode["winningPatternIndexes"], patternCount, winningIndexes);

        JSONNode payloadNode = claimNode["payload"];
        if (payloadNode != null && !payloadNode.IsNull)
        {
            AddWinningPatternIndex(payloadNode["patternIndex"], patternCount, winningIndexes);
            AddWinningPatternIndex(payloadNode["winningPatternIndex"], patternCount, winningIndexes);
            AddWinningPatternIndex(payloadNode["lineIndex"], patternCount, winningIndexes);
            AddWinningPatternIndexesFromArray(payloadNode["patternIndexes"], patternCount, winningIndexes);
            AddWinningPatternIndexesFromArray(payloadNode["winningPatternIndexes"], patternCount, winningIndexes);
        }

        return winningIndexes;
    }

    private void AddWinningPatternIndexesFromArray(JSONNode node, int patternCount, HashSet<int> target)
    {
        if (node == null || node.IsNull || !node.IsArray)
        {
            return;
        }

        for (int i = 0; i < node.Count; i++)
        {
            AddWinningPatternIndex(node[i], patternCount, target);
        }
    }

    private void AddWinningPatternIndex(JSONNode node, int patternCount, HashSet<int> target)
    {
        if (!TryParsePatternIndex(node, patternCount, out int patternIndex))
        {
            return;
        }

        target.Add(patternIndex);
    }

    private bool TryParsePatternIndex(JSONNode node, int patternCount, out int patternIndex)
    {
        patternIndex = -1;
        if (node == null || node.IsNull || patternCount <= 0)
        {
            return false;
        }

        string rawValue = node.Value;
        if (!int.TryParse(rawValue, out int parsed))
        {
            return false;
        }

        if (parsed >= 0 && parsed < patternCount)
        {
            patternIndex = parsed;
            return true;
        }

        if (parsed > 0 && parsed <= patternCount)
        {
            patternIndex = parsed - 1;
            return true;
        }

        return false;
    }

    private List<int> BuildOrderedPatternPriority(List<int> activePatternIndexes, HashSet<int> explicitPatternIndexes)
    {
        List<int> orderedPatterns = new();
        HashSet<int> seen = new();

        if (activePatternIndexes != null)
        {
            for (int i = 0; i < activePatternIndexes.Count; i++)
            {
                int patternIndex = activePatternIndexes[i];
                if (!explicitPatternIndexes.Contains(patternIndex))
                {
                    continue;
                }

                if (seen.Add(patternIndex))
                {
                    orderedPatterns.Add(patternIndex);
                }
            }
        }

        foreach (int patternIndex in explicitPatternIndexes)
        {
            if (seen.Add(patternIndex))
            {
                orderedPatterns.Add(patternIndex);
            }
        }

        return orderedPatterns;
    }

    private HashSet<int> FindMatchedPatternIndexes(CardClass card, List<Patterns> patternList, List<int> candidatePatternIndexes)
    {
        HashSet<int> matchedPatternIndexes = new();
        if (card == null || patternList == null || candidatePatternIndexes == null)
        {
            return matchedPatternIndexes;
        }

        for (int i = 0; i < candidatePatternIndexes.Count; i++)
        {
            int patternIndex = candidatePatternIndexes[i];
            if (patternIndex < 0 || patternIndex >= patternList.Count)
            {
                continue;
            }

            if (RealtimePaylineUtils.IsPatternMatchedOnCard(card, patternList, patternIndex))
            {
                matchedPatternIndexes.Add(patternIndex);
            }
        }

        return matchedPatternIndexes;
    }

    private void ApplyTicketStateVisualsForCard(
        NumberGenerator generator,
        int cardNo,
        List<int> activePatternIndexes,
        HashSet<int> wonPatternIndexes,
        Dictionary<int, RealtimeNearWinState> activeNearWinStates)
    {
        if (generator == null || generator.cardClasses == null || cardNo < 0 || cardNo >= generator.cardClasses.Length)
        {
            return;
        }

        CardClass card = generator.cardClasses[cardNo];
        if (card == null)
        {
            return;
        }

        for (int i = 0; i < card.matchPatternImg.Count; i++)
        {
            if (card.matchPatternImg[i] != null)
            {
                SetActiveIfChanged(card.matchPatternImg[i], false);
            }
        }

        int paylineCount = card.paylineObj != null ? card.paylineObj.Count : 0;
        int visualPatternCount = Mathf.Min(generator.patternList.Count, paylineCount);
        RealtimePaylineUtils.EnsurePaylineIndexCapacity(card, visualPatternCount);

        for (int patternIndex = 0; patternIndex < visualPatternCount; patternIndex++)
        {
            bool isWinner = wonPatternIndexes != null && wonPatternIndexes.Contains(patternIndex);
            if (patternIndex < card.paylineindex.Count)
            {
                card.paylineindex[patternIndex] = isWinner;
            }

            RealtimePaylineUtils.SetPaylineVisual(
                generator.cardClasses,
                cardNo,
                patternIndex,
                isWinner,
                isWinner,
                generator.matchedMat,
                generator.unMatchedMat);
        }

        for (int i = 0; i < activePatternIndexes.Count; i++)
        {
            int patternIndex = activePatternIndexes[i];
            if (patternIndex < 0 || patternIndex >= generator.patternList.Count)
            {
                continue;
            }

            if (wonPatternIndexes != null && wonPatternIndexes.Contains(patternIndex))
            {
                continue;
            }

            if (!TryGetNearWinCellIndex(card, generator.patternList[patternIndex].pattern, out int missingCellIndex))
            {
                continue;
            }

            if (missingCellIndex < 0 ||
                missingCellIndex >= card.missingPatternImg.Count ||
                card.missingPatternImg[missingCellIndex] == null)
            {
                continue;
            }

            int nearWinKey = BuildNearWinKey(cardNo, patternIndex, missingCellIndex);
            int missingNumber = ResolveNearWinMissingNumber(card, missingCellIndex);
            activeNearWinStates[nearWinKey] =
                new RealtimeNearWinState(patternIndex, cardNo, missingCellIndex, missingNumber);
        }
    }

    private bool TryGetNearWinCellIndex(CardClass card, List<byte> mask, out int missingCellIndex)
    {
        missingCellIndex = -1;
        if (card == null || mask == null || card.payLinePattern == null)
        {
            return false;
        }

        int requiredCount = 0;
        int matchedCount = 0;
        int cellCount = Mathf.Min(mask.Count, card.payLinePattern.Count);
        for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
        {
            if (mask[cellIndex] != 1)
            {
                continue;
            }

            requiredCount++;
            if (card.payLinePattern[cellIndex] == 1)
            {
                matchedCount++;
            }
            else if (missingCellIndex < 0)
            {
                missingCellIndex = cellIndex;
            }
        }

        return requiredCount > 0 && matchedCount == requiredCount - 1 && missingCellIndex >= 0;
    }

    private int ResolveNearWinMissingNumber(CardClass card, int missingCellIndex)
    {
        if (card == null || card.numb == null || missingCellIndex < 0 || missingCellIndex >= card.numb.Count)
        {
            return 0;
        }

        return Mathf.Max(0, card.numb[missingCellIndex]);
    }

    private int BuildNearWinKey(int cardNo, int patternIndex, int cellIndex)
    {
        return (cardNo * 10000) + (patternIndex * 100) + cellIndex;
    }

    private void SyncRealtimeMatchedPatternVisuals(Dictionary<int, HashSet<int>> winningPatternsByCard)
    {
        HashSet<int> activeMatchedPatterns = new();
        if (winningPatternsByCard != null)
        {
            foreach (KeyValuePair<int, HashSet<int>> entry in winningPatternsByCard)
            {
                if (entry.Value == null)
                {
                    continue;
                }

                foreach (int patternIndex in entry.Value)
                {
                    activeMatchedPatterns.Add(patternIndex);
                }
            }
        }

        List<int> patternsToDisable = new();
        foreach (int patternIndex in realtimeMatchedPatternIndexes)
        {
            if (!activeMatchedPatterns.Contains(patternIndex))
            {
                patternsToDisable.Add(patternIndex);
            }
        }

        for (int i = 0; i < patternsToDisable.Count; i++)
        {
            int patternIndex = patternsToDisable[i];
            EventManager.ShowMatchedPattern(patternIndex, false);
            realtimeMatchedPatternIndexes.Remove(patternIndex);
        }

        foreach (int patternIndex in activeMatchedPatterns)
        {
            if (realtimeMatchedPatternIndexes.Add(patternIndex))
            {
                EventManager.ShowMatchedPattern(patternIndex, true);
            }
        }
    }

    private void SyncRealtimeNearWinBlinking(Dictionary<int, RealtimeNearWinState> activeNearWinStates)
    {
        List<int> keysToStop = new List<int>();
        foreach (int key in realtimeNearWinStates.Keys)
        {
            if (!activeNearWinStates.ContainsKey(key))
            {
                keysToStop.Add(key);
            }
        }

        for (int i = 0; i < keysToStop.Count; i++)
        {
            int key = keysToStop[i];
            if (realtimeNearWinStates.TryGetValue(key, out RealtimeNearWinState nearWinState))
            {
                EventManager.ShowMissingPattern(
                    nearWinState.PatternIndex,
                    nearWinState.CellIndex,
                    false,
                    0,
                    nearWinState.CardNo);
            }

            realtimeNearWinStates.Remove(key);
        }

        foreach (KeyValuePair<int, RealtimeNearWinState> entry in activeNearWinStates)
        {
            int key = entry.Key;
            RealtimeNearWinState state = entry.Value;

            bool shouldNotify = !realtimeNearWinStates.TryGetValue(key, out RealtimeNearWinState previousState) ||
                                previousState.MissingNumber != state.MissingNumber;

            if (shouldNotify)
            {
                EventManager.ShowMissingPattern(
                    state.PatternIndex,
                    state.CellIndex,
                    true,
                    state.MissingNumber,
                    state.CardNo);
            }

            realtimeNearWinStates[key] = state;
        }
    }

    private void HideAllMissingPatternVisuals(CardClass[] cards)
    {
        if (cards == null)
        {
            return;
        }

        for (int cardNo = 0; cardNo < cards.Length; cardNo++)
        {
            CardClass card = cards[cardNo];
            if (card == null || card.missingPatternImg == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < card.missingPatternImg.Count; cellIndex++)
            {
                GameObject missingCell = card.missingPatternImg[cellIndex];
                if (missingCell != null)
                {
                    SetActiveIfChanged(missingCell, false);
                }
            }
        }
    }

    private void StopRealtimeNearWinBlinking()
    {
        CardClass[] cards = ResolveNumberGenerator()?.cardClasses;
        foreach (KeyValuePair<int, RealtimeNearWinState> entry in realtimeNearWinStates)
        {
            RealtimeNearWinState state = entry.Value;
            EventManager.ShowMissingPattern(state.PatternIndex, state.CellIndex, false, 0, state.CardNo);
        }

        realtimeNearWinStates.Clear();
        HideAllMissingPatternVisuals(cards);
    }

    private void StopRealtimeMatchedPatternVisuals()
    {
        foreach (int patternIndex in realtimeMatchedPatternIndexes)
        {
            EventManager.ShowMatchedPattern(patternIndex, false);
        }

        realtimeMatchedPatternIndexes.Clear();
    }

    private static void SetActiveIfChanged(GameObject target, bool active)
    {
        if (target != null && target.activeSelf != active)
        {
            target.SetActive(active);
        }
    }

    private void RefreshRealtimeBonusFlow(
        JSONNode currentGame,
        RealtimeClaimInfo latestClaim,
        Dictionary<int, HashSet<int>> winningPatternsByCard)
    {
        if (string.IsNullOrWhiteSpace(activeGameId))
        {
            return;
        }

        if (string.Equals(realtimeBonusTriggeredGameId, activeGameId, StringComparison.Ordinal))
        {
            return;
        }

        if (!TryResolveRealtimeBonusTrigger(latestClaim, winningPatternsByCard, out string triggerSource))
        {
            return;
        }

        if (!TryResolveRealtimeBonusAmount(currentGame, latestClaim, out int bonusAmount, out string amountSource))
        {
            string missingKey = $"{activeGameId}:{latestClaim.ClaimId}";
            if (!string.Equals(realtimeBonusMissingDataLogKey, missingKey, StringComparison.Ordinal))
            {
                realtimeBonusMissingDataLogKey = missingKey;
                Debug.LogWarning(
                    $"[APIManager] Realtime bonus-trigger ({triggerSource}) ble funnet i game {activeGameId}, " +
                    $"men bonusbelop mangler i snapshot/claim. Forventet: claim.bonusAmount / claim.payload.bonusAmount / " +
                    $"currentGame.bonusByPlayer[playerId] / currentGame.bonusAmount.");
            }
            return;
        }

        NumberGenerator generator = ResolveNumberGenerator();
        if (generator == null)
        {
            Debug.LogError($"[APIManager] Realtime bonus-trigger ({triggerSource}) funnet, men NumberGenerator mangler.");
            return;
        }

        bonusAMT = bonusAmount;
        if (!generator.TryOpenRealtimeBonusPanel(bonusAmount, activeGameId, latestClaim.ClaimId))
        {
            return;
        }

        realtimeBonusTriggeredGameId = activeGameId;
        realtimeBonusTriggeredClaimId = latestClaim.ClaimId ?? string.Empty;
        realtimeBonusMissingDataLogKey = string.Empty;
        Debug.Log($"[APIManager] Realtime bonus-trigger aktivert ({triggerSource}). bonusAMT={bonusAmount} ({amountSource}) game={activeGameId} claim={realtimeBonusTriggeredClaimId}");
    }

    private bool TryResolveRealtimeBonusTrigger(
        RealtimeClaimInfo latestClaim,
        Dictionary<int, HashSet<int>> winningPatternsByCard,
        out string triggerSource)
    {
        triggerSource = string.Empty;
        if (latestClaim.ClaimNode == null || latestClaim.ClaimNode.IsNull)
        {
            return false;
        }

        if (TryResolveBackendBonusTrigger(latestClaim.ClaimNode, out bool backendTriggered, out string backendSource))
        {
            triggerSource = backendSource;
            return backendTriggered;
        }

        if (string.Equals(latestClaim.ClaimType, "BONUS", StringComparison.OrdinalIgnoreCase))
        {
            triggerSource = "claim.type=BONUS";
            LogBonusFallbackUsed("trigger", triggerSource, latestClaim.ClaimId);
            return true;
        }

        if (HasTruthyBonusFlag(latestClaim.ClaimNode))
        {
            triggerSource = "claim.bonusFlag";
            LogBonusFallbackUsed("trigger", triggerSource, latestClaim.ClaimId);
            return true;
        }

        if (!string.Equals(latestClaim.ClaimType, "LINE", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (winningPatternsByCard == null)
        {
            return false;
        }

        foreach (KeyValuePair<int, HashSet<int>> cardWin in winningPatternsByCard)
        {
            if (cardWin.Value != null && cardWin.Value.Contains(realtimeBonusPatternIndex))
            {
                triggerSource = $"winningPatternIndex={realtimeBonusPatternIndex}";
                LogBonusFallbackUsed("trigger", triggerSource, latestClaim.ClaimId);
                return true;
            }
        }

        return false;
    }

    private bool TryResolveBackendBonusTrigger(JSONNode claimNode, out bool bonusTriggered, out string source)
    {
        bonusTriggered = false;
        source = string.Empty;
        if (claimNode == null || claimNode.IsNull)
        {
            return false;
        }

        if (TryParseOptionalBool(claimNode["bonusTriggered"], out bool claimFlag))
        {
            bonusTriggered = claimFlag;
            source = "claim.bonusTriggered";
            return true;
        }

        JSONNode payload = claimNode["payload"];
        if (TryParseOptionalBool(payload?["bonusTriggered"], out bool payloadFlag))
        {
            bonusTriggered = payloadFlag;
            source = "claim.payload.bonusTriggered";
            return true;
        }

        return false;
    }

    private bool HasTruthyBonusFlag(JSONNode claimNode)
    {
        if (claimNode == null || claimNode.IsNull)
        {
            return false;
        }

        if (IsTruthyNode(claimNode["hasBonus"]) ||
            IsTruthyNode(claimNode["isBonus"]))
        {
            return true;
        }

        JSONNode payload = claimNode["payload"];
        return IsTruthyNode(payload?["hasBonus"]) ||
               IsTruthyNode(payload?["isBonus"]);
    }

    private bool IsTruthyNode(JSONNode node)
    {
        if (node == null || node.IsNull)
        {
            return false;
        }

        if (bool.TryParse(node.Value, out bool boolValue))
        {
            return boolValue;
        }

        if (int.TryParse(node.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int intValue))
        {
            return intValue != 0;
        }

        return node.AsBool;
    }

    private bool TryResolveRealtimeBonusAmount(
        JSONNode currentGame,
        RealtimeClaimInfo latestClaim,
        out int bonusAmount,
        out string source)
    {
        bonusAmount = 0;
        source = string.Empty;

        if (TryResolveBackendBonusAmount(latestClaim.ClaimNode, out bonusAmount, out source))
        {
            source = $"claim.{source}";
            return true;
        }

        JSONNode claimPayload = latestClaim.ClaimNode?["payload"];
        if (TryResolveBackendBonusAmount(claimPayload, out bonusAmount, out source))
        {
            source = $"claim.payload.{source}";
            return true;
        }

        if (TryResolveBonusAmountFromNode(latestClaim.ClaimNode, out bonusAmount, out source))
        {
            source = $"claim.{source}";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromNode(claimPayload, out bonusAmount, out source))
        {
            source = $"claim.payload.{source}";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromNode(currentGame, out bonusAmount, out source))
        {
            source = $"currentGame.{source}";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromPlayerMap(currentGame?["bonusByPlayer"], out bonusAmount))
        {
            source = $"currentGame.bonusByPlayer[{activePlayerId}]";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromPlayerMap(currentGame?["bonusAmounts"], out bonusAmount))
        {
            source = $"currentGame.bonusAmounts[{activePlayerId}]";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromPlayerMap(currentGame?["bonusAwards"], out bonusAmount))
        {
            source = $"currentGame.bonusAwards[{activePlayerId}]";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        return false;
    }

    private bool TryResolveBackendBonusAmount(JSONNode node, out int bonusAmount, out string source)
    {
        bonusAmount = 0;
        source = string.Empty;
        if (node == null || node.IsNull)
        {
            return false;
        }

        if (TryParsePositiveAmount(node["bonusAmount"], out bonusAmount))
        {
            source = "bonusAmount";
            return true;
        }

        return false;
    }

    private bool TryResolveBonusAmountFromNode(JSONNode node, out int bonusAmount, out string source)
    {
        bonusAmount = 0;
        source = string.Empty;
        if (node == null || node.IsNull)
        {
            return false;
        }

        if (TryParsePositiveAmount(node["bonusAmount"], out bonusAmount))
        {
            source = "bonusAmount";
            return true;
        }

        if (TryParsePositiveAmount(node["bonusAmt"], out bonusAmount))
        {
            source = "bonusAmt";
            return true;
        }

        if (TryParsePositiveAmount(node["bonusPayout"], out bonusAmount))
        {
            source = "bonusPayout";
            return true;
        }

        if (TryParsePositiveAmount(node["bonusValue"], out bonusAmount))
        {
            source = "bonusValue";
            return true;
        }

        JSONNode bonusNode = node["bonus"];
        if (TryParseBonusAmountFromGenericNode(bonusNode, out bonusAmount))
        {
            source = "bonus";
            return true;
        }

        return false;
    }

    private bool TryResolveBonusAmountFromPlayerMap(JSONNode mapNode, out int bonusAmount)
    {
        bonusAmount = 0;
        if (mapNode == null || mapNode.IsNull || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return false;
        }

        JSONNode playerNode = mapNode[activePlayerId];
        return TryParseBonusAmountFromGenericNode(playerNode, out bonusAmount);
    }

    private bool TryParseBonusAmountFromGenericNode(JSONNode node, out int bonusAmount)
    {
        bonusAmount = 0;
        if (node == null || node.IsNull)
        {
            return false;
        }

        if (TryParsePositiveAmount(node, out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["amount"], out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["bonusAmount"], out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["value"], out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["payout"], out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["bonusPayout"], out bonusAmount))
        {
            return true;
        }

        return false;
    }

    private bool TryParsePositiveAmount(JSONNode node, out int value)
    {
        value = 0;
        if (node == null || node.IsNull)
        {
            return false;
        }

        string raw = node.Value;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out int intValue))
        {
            if (intValue > 0)
            {
                value = intValue;
                return true;
            }

            return false;
        }

        if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out double doubleValue) && doubleValue > 0d)
        {
            value = Mathf.RoundToInt((float)doubleValue);
            return value > 0;
        }

        return false;
    }

    private bool TryParseOptionalBool(JSONNode node, out bool value)
    {
        value = false;
        if (node == null || node.IsNull)
        {
            return false;
        }

        string raw = node.Value;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        if (bool.TryParse(raw, out bool boolValue))
        {
            value = boolValue;
            return true;
        }

        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out int intValue))
        {
            value = intValue != 0;
            return true;
        }

        return false;
    }

    private void LogBonusFallbackUsed(string scope, string source, string claimId)
    {
        string normalizedClaimId = string.IsNullOrWhiteSpace(claimId) ? "<unknown-claim>" : claimId;
        Debug.LogWarning(
            $"[APIManager] Realtime bonus-{scope} bruker fallback ({source}) i game {activeGameId}, claim {normalizedClaimId}. " +
            "Backend-feltene claim.bonusTriggered/claim.bonusAmount mangler.");
    }

    private void ResetRealtimeBonusState(bool closeBonusPanel, string previousGameId = null)
    {
        bonusAMT = 0;
        realtimeBonusTriggeredGameId = string.Empty;
        realtimeBonusTriggeredClaimId = string.Empty;
        realtimeBonusMissingDataLogKey = string.Empty;

        NumberGenerator generator = ResolveNumberGenerator();
        if (generator == null)
        {
            return;
        }

        generator.ResetRealtimeBonusFlow(closeBonusPanel, previousGameId);
    }

    private int GetCardSlotsCount()
    {
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator != null && generator.cardClasses != null && generator.cardClasses.Length > 0)
        {
            return generator.cardClasses.Length;
        }

        return 1;
    }

    private void ResetActiveRoomState(bool clearDesiredRoomCode)
    {
        ClearJoinOrCreatePending();
        activeRoomCode = string.Empty;
        activePlayerId = string.Empty;
        activeHostPlayerId = string.Empty;
        activeGameId = string.Empty;
        realtimeScheduler.Reset();
        realtimeRoomConfigurator.ResetWarningState();
        realtimeCountdownPresenter.ResetLayoutCache();
        processedDrawCount = 0;
        currentTicketPage = 0;
        activeTicketSets.Clear();
        cachedStableTicketSets.Clear();
        realtimeTicketFallbackLogKey = string.Empty;
        realtimePlayerParticipatingInCurrentRound = false;
        realtimeBetArmedForNextRound = false;
        desiredRealtimeBetArmedForNextRound = false;
        pendingRealtimeBetArmRequest = false;
        realtimeBetArmAwaitingAck = false;
        realtimeBetArmMutationVersion = 0;
        pendingRealtimePreRoundEditContinuation = null;
        delayedOverlayResetGameId = string.Empty;
        overlaysClearedForEndedGameId = string.Empty;
        StopRealtimeNearWinBlinking();
        ResetRealtimeBonusState(closeBonusPanel: true);
        nextScheduledRoomStateRefreshAt = -1f;
        nextScheduledManualStartAttemptAt = -1f;
        nextMissingRealtimeTicketsResyncAt = -1f;

        if (clearDesiredRoomCode)
        {
            roomCode = string.Empty;
        }
    }

    private void MarkJoinOrCreatePending()
    {
        isJoinOrCreatePending = true;
        joinOrCreateIssuedAtRealtime = Time.realtimeSinceStartup;
    }

    private void ClearJoinOrCreatePending()
    {
        isJoinOrCreatePending = false;
        joinOrCreateIssuedAtRealtime = -1f;
    }

    private bool IsJoinOrCreateTimedOut()
    {
        if (!isJoinOrCreatePending)
        {
            return false;
        }

        if (joinOrCreateIssuedAtRealtime < 0f)
        {
            return true;
        }

        return (Time.realtimeSinceStartup - joinOrCreateIssuedAtRealtime) > 8f;
    }
}
