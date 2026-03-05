using System;
using System.Collections.Generic;
using SimpleJSON;
using TMPro;
using UnityEngine;

public partial class APIManager
{
    private void HandleRealtimeRoomUpdate(JSONNode snapshot)
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

        ApplySchedulerMetadata(snapshot);

        JSONNode currentGame = snapshot["currentGame"];
        if (currentGame == null || currentGame.IsNull)
        {
            realtimeScheduler.SetCurrentGameStatus("NONE");
            if (!string.IsNullOrWhiteSpace(activeGameId))
            {
                ResetRealtimeRoundVisuals();
            }

            NumberGenerator endedRoundGenerator = GameManager.instance?.numberGenerator;
            if (endedRoundGenerator != null)
            {
                endedRoundGenerator.ClearPaylineVisuals();
            }

            activeGameId = string.Empty;
            processedDrawCount = 0;
            currentTicketPage = 0;
            activeTicketSets.Clear();
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
            activeGameId = gameId;
            processedDrawCount = 0;
            currentTicketPage = 0;
            activeTicketSets.Clear();
            ResetRealtimeRoundVisuals();
            NumberGenerator nextRoundGenerator = GameManager.instance?.numberGenerator;
            if (nextRoundGenerator != null)
            {
                nextRoundGenerator.ClearPaylineVisuals();
            }
        }

        ApplyMyTicketToCards(currentGame);
        ApplyDrawnNumbers(currentGame);
        RefreshRealtimeWinningPatternVisuals(currentGame);
        RefreshRealtimeCountdownLabel(forceRefresh: true);
    }

    private void ApplyMyTicketToCards(JSONNode currentGame)
    {
        if (string.IsNullOrWhiteSpace(activePlayerId))
        {
            return;
        }

        JSONNode tickets = currentGame["tickets"];
        if (tickets == null || tickets.IsNull)
        {
            return;
        }

        JSONNode myTicketsNode = tickets[activePlayerId];
        if (myTicketsNode == null || myTicketsNode.IsNull)
        {
            return;
        }

        List<List<int>> ticketSets = RealtimeTicketSetUtils.ExtractTicketSets(myTicketsNode);
        if (ticketSets.Count == 0)
        {
            return;
        }

        if (RealtimeTicketSetUtils.AreTicketSetsEqual(activeTicketSets, ticketSets))
        {
            return;
        }

        activeTicketSets = RealtimeTicketSetUtils.CloneTicketSets(ticketSets);
        ApplyTicketSetsToCards(activeTicketSets);
    }

    private void ApplyTicketSetsToCards(List<List<int>> ticketSets)
    {
        if (ticketSets == null || ticketSets.Count == 0)
        {
            return;
        }

        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null || generator.cardClasses == null)
        {
            return;
        }

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

        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null)
            {
                continue;
            }

            card.numb.Clear();
            card.selectedPayLineCanBe.Clear();
            card.paylineindex.Clear();

            for (int i = 0; i < card.payLinePattern.Count; i++)
            {
                card.payLinePattern[i] = 0;
            }

            for (int i = 0; i < card.selectionImg.Count; i++)
            {
                card.selectionImg[i].SetActive(false);
            }

            for (int i = 0; i < card.missingPatternImg.Count; i++)
            {
                card.missingPatternImg[i].SetActive(false);
            }

            for (int i = 0; i < card.matchPatternImg.Count; i++)
            {
                card.matchPatternImg[i].SetActive(false);
            }

            for (int i = 0; i < card.paylineObj.Count; i++)
            {
                card.paylineObj[i].SetActive(false);
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
            for (int cellIndex = 0; cellIndex < 15; cellIndex++)
            {
                int value = shouldPopulate ? sourceTicket[cellIndex] : 0;
                card.numb.Add(value);

                if (cellIndex < card.num_text.Count)
                {
                    RealtimeTextStyleUtils.ApplyCardNumber(
                        card.num_text[cellIndex],
                        shouldPopulate ? value.ToString() : "-",
                        numberFallbackFont);
                }
            }
        }

        Debug.Log($"[APIManager] Applied ticket page {currentTicketPage + 1}/{pageCount} ({ticketSets.Count} total ticket(s)) for player {activePlayerId}. Room {activeRoomCode}, game {activeGameId}");
    }

    private void ApplyDrawnNumbers(JSONNode currentGame)
    {
        JSONNode drawnNumbers = currentGame["drawnNumbers"];
        if (drawnNumbers == null || drawnNumbers.IsNull || !drawnNumbers.IsArray)
        {
            return;
        }

        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null || generator.cardClasses == null)
        {
            return;
        }

        int previousProcessedDrawCount = Mathf.Max(0, processedDrawCount);
        for (int drawIndex = 0; drawIndex < drawnNumbers.Count; drawIndex++)
        {
            int drawnNumber = drawnNumbers[drawIndex].AsInt;
            RealtimeTicketSetUtils.MarkDrawnNumberOnCards(generator, drawnNumber);

            if (drawIndex < previousProcessedDrawCount)
            {
                continue;
            }

            ShowRealtimeDrawBall(drawIndex, drawnNumber);

            if (autoMarkDrawnNumbers &&
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

    private void RefreshRealtimeWinningPatternVisuals(JSONNode currentGame)
    {
        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null)
        {
            return;
        }

        string latestClaimType = GetLatestValidClaimTypeForCurrentPlayer(currentGame);
        if (string.IsNullOrWhiteSpace(latestClaimType))
        {
            generator.ClearPaylineVisuals();
            return;
        }

        bool onlyFirstMatchPerCard = string.Equals(latestClaimType, "LINE", StringComparison.OrdinalIgnoreCase);
        generator.ShowMatchedPaylinePatternsForCurrentCards(onlyFirstMatchPerCard);
    }

    private string GetLatestValidClaimTypeForCurrentPlayer(JSONNode currentGame)
    {
        if (currentGame == null || currentGame.IsNull || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return string.Empty;
        }

        JSONNode claims = currentGame["claims"];
        if (claims == null || claims.IsNull || !claims.IsArray)
        {
            return string.Empty;
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
                string.Equals(claimType, "BINGO", StringComparison.OrdinalIgnoreCase))
            {
                return claimType.Trim().ToUpperInvariant();
            }
        }

        return string.Empty;
    }

    private int GetCardSlotsCount()
    {
        NumberGenerator generator = GameManager.instance?.numberGenerator;
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
        nextScheduledRoomStateRefreshAt = -1f;
        nextScheduledManualStartAttemptAt = -1f;

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
