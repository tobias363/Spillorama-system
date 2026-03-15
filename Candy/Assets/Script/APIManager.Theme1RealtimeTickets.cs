using System;
using System.Collections.Generic;
using SimpleJSON;
using TMPro;
using UnityEngine;

public partial class APIManager
{
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

        if (!BootstrapRealtimeCardBindings(generator, out string bootstrapError))
        {
            PublishRuntimeStatus("Card bindings er ugyldige i Theme1. " + bootstrapError, asError: true);
            return;
        }

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
                Theme1PresentationTextUtils.ApplyHudText(gameManager.winAmtText, "0");
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

        if (!BootstrapRealtimeCardBindings(generator, out string bindingError))
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

    private bool BootstrapRealtimeCardBindings(NumberGenerator generator, out string error)
    {
        error = string.Empty;
        if (generator == null)
        {
            error = "NumberGenerator mangler.";
            return false;
        }

        CandyCardViewBindingSet cardBindingSet = generator.GetComponent<CandyCardViewBindingSet>();
        if (cardBindingSet == null)
        {
            error = "CandyCardViewBindingSet mangler på NumberGenerator. Kjør Theme1-produksjonsmigrering.";
            return false;
        }

        if (!cardBindingSet.Validate(out string bindingReport))
        {
            error = bindingReport;
            return false;
        }

        if (!cardBindingSet.TryApplyTo(generator, out error))
        {
            return false;
        }

        return true;
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

            TextMeshProUGUI resolved = Theme1GameplayViewRepairUtils.FindDedicatedCardRenderLabel(selectionCell);

            card.num_text[cellIndex] = resolved;
        }
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
}
