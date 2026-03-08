using System.Collections.Generic;
using TMPro;
using UnityEngine;

public sealed class Theme1LocalStateAdapter
{
    public Theme1DisplayState Build(
        Theme1GameplayViewRoot viewRoot,
        NumberGenerator generator,
        BallManager ballManager,
        GameManager gameManager)
    {
        int cardCount = viewRoot?.Cards != null ? viewRoot.Cards.Length : 0;
        int ballSlotCount = viewRoot?.BallRack?.Slots != null ? viewRoot.BallRack.Slots.Length : 0;
        int topperCount = viewRoot?.TopperStrip?.Slots != null ? viewRoot.TopperStrip.Slots.Length : 0;
        Theme1DisplayState state = Theme1DisplayState.CreateEmpty(cardCount, ballSlotCount, topperCount);

        PopulateCards(state, viewRoot, generator, gameManager);
        PopulateHud(state, viewRoot, generator, gameManager);
        PopulateTopper(state, viewRoot, gameManager);
        PopulateBallRack(state, viewRoot, generator);
        return state;
    }

    private static void PopulateCards(Theme1DisplayState state, Theme1GameplayViewRoot viewRoot, NumberGenerator generator, GameManager gameManager)
    {
        CardClass[] cards = generator != null ? generator.cardClasses : null;
        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            Theme1CardGridView contractCard = viewRoot?.Cards != null && cardIndex < viewRoot.Cards.Length
                ? viewRoot.Cards[cardIndex]
                : null;
            CardClass legacyCard = cards != null && cardIndex < cards.Length ? cards[cardIndex] : null;

            int winAmount = gameManager != null ? gameManager.GetCardWinAmount(cardIndex) : 0;
            Theme1CardRenderState cardState = Theme1CardRenderState.CreateEmpty();
            cardState.HeaderLabel = gameManager != null
                ? gameManager.GetCardIndexLabel(cardIndex)
                : GameManager.FormatTheme1CardHeaderLabel(cardIndex);
            cardState.BetLabel = gameManager != null
                ? gameManager.GetCardStakeLabel()
                : GameManager.FormatTheme1CardStakeLabel(0);
            cardState.WinLabel = winAmount > 0
                ? (gameManager != null
                    ? gameManager.FormatCardWinLabel(winAmount)
                    : GameManager.FormatTheme1CardWinLabel(winAmount))
                : ReadHiddenWinLabel(contractCard?.WinLabel);
            cardState.ShowWinLabel = winAmount > 0;

            int paylineCount = contractCard?.PaylineObjects != null ? contractCard.PaylineObjects.Length : 0;
            cardState.PaylinesActive = new bool[paylineCount];
            for (int paylineIndex = 0; paylineIndex < paylineCount; paylineIndex++)
            {
                cardState.PaylinesActive[paylineIndex] = contractCard.PaylineObjects[paylineIndex] != null &&
                                                         contractCard.PaylineObjects[paylineIndex].activeSelf;
            }

            for (int cellIndex = 0; cellIndex < cardState.Cells.Length; cellIndex++)
            {
                int number = legacyCard != null &&
                             legacyCard.numb != null &&
                             cellIndex < legacyCard.numb.Count
                    ? GameManager.NormalizeTheme1BallNumber(legacyCard.numb[cellIndex])
                    : 0;

                Theme1CardCellView contractCell = contractCard?.Cells != null && cellIndex < contractCard.Cells.Length
                    ? contractCard.Cells[cellIndex]
                    : null;

                cardState.Cells[cellIndex] = new Theme1CardCellRenderState(
                    number > 0 ? number.ToString() : "-",
                    contractCell?.SelectionOverlay != null && contractCell.SelectionOverlay.activeSelf,
                    contractCell?.MissingOverlay != null && contractCell.MissingOverlay.activeSelf,
                    contractCell?.MatchedOverlay != null && contractCell.MatchedOverlay.activeSelf);
            }

            state.Cards[cardIndex] = cardState;
        }
    }

    private static void PopulateHud(Theme1DisplayState state, Theme1GameplayViewRoot viewRoot, NumberGenerator generator, GameManager gameManager)
    {
        Theme1HudBarView hud = viewRoot?.HudBar;
        state.Hud.CountdownLabel = ReadText(generator != null ? generator.autoSpinRemainingPlayText : null, ReadText(hud?.CountdownText, string.Empty));
        state.Hud.PlayerCountLabel = ReadText(hud?.RoomPlayerCountText, string.Empty);
        state.Hud.CreditLabel = ReadHudValue(gameManager != null ? gameManager.displayTotalMoney : null, hud?.CreditText);
        state.Hud.WinningsLabel = ReadHudValue(gameManager != null ? gameManager.winAmtText : null, hud?.WinningsText);
        state.Hud.BetLabel = ReadHudValue(gameManager != null ? gameManager.displayCurrentBets : null, hud?.BetText);
    }

    private static void PopulateTopper(Theme1DisplayState state, Theme1GameplayViewRoot viewRoot, GameManager gameManager)
    {
        int slotCount = state.Topper.Slots != null ? state.Topper.Slots.Length : 0;
        for (int slotIndex = 0; slotIndex < slotCount; slotIndex++)
        {
            Theme1TopperSlotView contractSlot = viewRoot?.TopperStrip?.Slots != null && slotIndex < viewRoot.TopperStrip.Slots.Length
                ? viewRoot.TopperStrip.Slots[slotIndex]
                : null;

            Theme1TopperSlotRenderState slotState = new Theme1TopperSlotRenderState
            {
                PrizeLabel = ResolvePrizeLabel(contractSlot?.PrizeLabel, gameManager, slotIndex),
                ShowPattern = contractSlot?.PatternRoot == null || contractSlot.PatternRoot.activeSelf,
                ShowMatchedPattern = contractSlot?.MatchedPatternRoot != null && contractSlot.MatchedPatternRoot.activeSelf
            };

            int missingCount = contractSlot?.MissingCells != null ? contractSlot.MissingCells.Length : 0;
            slotState.MissingCellsVisible = new bool[missingCount];
            bool hasNearWin = false;
            for (int cellIndex = 0; cellIndex < missingCount; cellIndex++)
            {
                bool visible = contractSlot.MissingCells[cellIndex] != null && contractSlot.MissingCells[cellIndex].activeSelf;
                slotState.MissingCellsVisible[cellIndex] = visible;
                hasNearWin |= visible;
            }

            slotState.PrizeVisualState = slotState.ShowMatchedPattern
                ? Theme1PrizeVisualState.Matched
                : (hasNearWin ? Theme1PrizeVisualState.NearWin : Theme1PrizeVisualState.Normal);
            state.Topper.Slots[slotIndex] = slotState;
        }
    }

    private static void PopulateBallRack(Theme1DisplayState state, Theme1GameplayViewRoot viewRoot, NumberGenerator generator)
    {
        Theme1BallRackView rack = viewRoot?.BallRack;
        state.BallRack.ShowBallMachine = rack?.BallMachine != null && rack.BallMachine.activeSelf;
        state.BallRack.ShowExtraBallMachine = rack?.ExtraBallMachine != null && rack.ExtraBallMachine.activeSelf;
        state.BallRack.ShowBallOutMachine = rack?.BallOutMachineAnimParent == null || rack.BallOutMachineAnimParent.activeSelf;
        state.BallRack.ShowBigBall = rack?.BigBallImage != null && rack.BigBallImage.gameObject.activeSelf;

        int[] drawnNumbers = ExtractValidDrawnNumbers(generator);
        int lastVisibleDrawIndex = -1;

        int slotCount = state.BallRack.Slots != null ? state.BallRack.Slots.Length : 0;
        for (int slotIndex = 0; slotIndex < slotCount; slotIndex++)
        {
            bool isVisible = rack?.Slots != null &&
                             slotIndex < rack.Slots.Length &&
                             rack.Slots[slotIndex] != null &&
                             rack.Slots[slotIndex].Root != null &&
                             rack.Slots[slotIndex].Root.activeSelf;
            int ballNumber = slotIndex < drawnNumbers.Length ? drawnNumbers[slotIndex] : 0;
            if (isVisible && ballNumber > 0)
            {
                lastVisibleDrawIndex = slotIndex;
            }

            state.BallRack.Slots[slotIndex] = new Theme1BallSlotRenderState(
                isVisible && ballNumber > 0,
                ballNumber > 0 ? ballNumber.ToString() : string.Empty);
        }

        if (lastVisibleDrawIndex >= 0 && lastVisibleDrawIndex < drawnNumbers.Length)
        {
            state.BallRack.BigBallNumber = drawnNumbers[lastVisibleDrawIndex].ToString();
        }
        else
        {
            state.BallRack.BigBallNumber = ReadText(rack?.BigBallText, string.Empty);
        }
    }

    private static string ResolvePrizeLabel(TMP_Text currentPrizeLabel, GameManager gameManager, int slotIndex)
    {
        string current = ReadText(currentPrizeLabel, string.Empty);
        if (!string.IsNullOrWhiteSpace(current) && current.IndexOf("kr", System.StringComparison.OrdinalIgnoreCase) >= 0)
        {
            return current;
        }

        if (gameManager != null && gameManager.TryGetFormattedPayoutLabel(slotIndex, out string payoutLabel))
        {
            return payoutLabel;
        }

        return current;
    }

    private static string ReadText(TMP_Text target, string fallback)
    {
        string value = target != null ? (target.text ?? string.Empty) : string.Empty;
        return string.IsNullOrWhiteSpace(value) ? fallback : value;
    }

    private static string ReadHiddenWinLabel(TMP_Text target)
    {
        if (target == null || !target.gameObject.activeSelf)
        {
            return string.Empty;
        }

        return ReadText(target, string.Empty);
    }

    private static string ReadHudValue(TMP_Text primary, TMP_Text fallback)
    {
        string value = ReadText(primary, ReadText(fallback, string.Empty));
        return string.IsNullOrWhiteSpace(value) ? "0" : value;
    }

    private static int[] ExtractValidDrawnNumbers(NumberGenerator generator)
    {
        if (generator?.generatedNO == null || generator.generatedNO.Count == 0)
        {
            return System.Array.Empty<int>();
        }

        List<int> values = new List<int>(generator.generatedNO.Count);
        for (int i = 0; i < generator.generatedNO.Count; i++)
        {
            int normalized = GameManager.NormalizeTheme1BallNumber(generator.generatedNO[i]);
            if (normalized > 0)
            {
                values.Add(normalized);
            }
        }

        return values.ToArray();
    }
}
