using TMPro;
using UnityEngine;
using UnityEngine.UI;

public sealed class Theme1RealtimePresenter
{
    private static readonly Color MatchedPrizeColor = Color.green;
    private static readonly Color NearWinPrizeColor = new Color(1f, 0.92f, 0.3f, 1f);

    public void Render(Theme1GameplayViewRoot root, Theme1RoundRenderState state)
    {
        if (root == null || state == null)
        {
            return;
        }

        root.EnsurePresentationInitialized();
        RenderCards(root, state.Cards);
        RenderBallRack(root, state.BallRack);
        RenderHud(root, state.Hud);
        RenderTopper(root, state.Topper);
    }

    private static void RenderCards(Theme1GameplayViewRoot root, Theme1CardRenderState[] cards)
    {
        int cardCount = root.Cards != null ? root.Cards.Length : 0;
        for (int cardIndex = 0; cardIndex < cardCount; cardIndex++)
        {
            Theme1CardGridView view = root.Cards[cardIndex];
            Theme1CardRenderState state = cards != null && cardIndex < cards.Length
                ? cards[cardIndex]
                : Theme1CardRenderState.CreateEmpty();

            Theme1PresentationTextUtils.ApplyText(view.HeaderLabel, state.HeaderLabel);
            Theme1PresentationTextUtils.ApplyText(view.BetLabel, state.BetLabel);
            Theme1PresentationTextUtils.SetActive(view.HeaderLabel != null ? view.HeaderLabel.gameObject : null, Theme1BongStyle.ShowCardOverlayLabels);
            Theme1PresentationTextUtils.SetActive(view.BetLabel != null ? view.BetLabel.gameObject : null, Theme1BongStyle.ShowCardOverlayLabels);
            Theme1CardLabelPolicy.ApplyRenderedWinLabel(view?.WinLabel, state.WinLabel, state.ShowWinLabel);

            int cellCount = view.Cells != null ? view.Cells.Length : 0;
            for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
            {
                Theme1CardCellView cellView = view.Cells[cellIndex];
                Theme1CardCellRenderState cellState = state.Cells != null && cellIndex < state.Cells.Length
                    ? state.Cells[cellIndex]
                    : Theme1CardCellRenderState.Empty;

                Theme1PresentationTextUtils.ApplyCardNumberText(cellView, cellState.NumberLabel);
                Theme1PresentationTextUtils.SetActive(cellView.SelectionOverlay, cellState.IsSelected);
                Theme1PresentationTextUtils.SetActive(cellView.MissingOverlay, cellState.IsMissing);
                Theme1PresentationTextUtils.SetActive(cellView.MatchedOverlay, cellState.IsMatched);
                Theme1BongRenderUtils.ApplyCellVisual(cellView, cellState);
            }

            Theme1BongRenderUtils.ApplyPaylineVisuals(view, state);
        }
    }

    private static void RenderBallRack(Theme1GameplayViewRoot root, Theme1BallRackRenderState state)
    {
        Theme1BallRackView view = root.BallRack;
        if (view == null || state == null)
        {
            return;
        }

        Theme1PresentationTextUtils.SetActive(view.BallOutMachineAnimParent, state.ShowBallOutMachine);
        Theme1PresentationTextUtils.SetActive(view.BallMachine, state.ShowBallMachine);
        Theme1PresentationTextUtils.SetActive(view.ExtraBallMachine, state.ShowExtraBallMachine);
        if (view.BigBallImage != null)
        {
            Theme1PresentationTextUtils.SetActive(view.BigBallImage.gameObject, state.ShowBigBall);
        }

        Theme1PresentationTextUtils.ApplyBallNumberText(view.BigBallText, state.BigBallNumber);

        int slotCount = view.Slots != null ? view.Slots.Length : 0;
        for (int slotIndex = 0; slotIndex < slotCount; slotIndex++)
        {
            Theme1BallSlotView slotView = view.Slots[slotIndex];
            Theme1BallSlotRenderState slotState = state.Slots != null && slotIndex < state.Slots.Length
                ? state.Slots[slotIndex]
                : Theme1BallSlotRenderState.Empty;

            Theme1PresentationTextUtils.SetActive(slotView.Root, slotState.IsVisible);
            Theme1PresentationTextUtils.ApplyBallNumberText(slotView.NumberLabel, slotState.NumberLabel);
        }
    }

    private static void RenderHud(Theme1GameplayViewRoot root, Theme1HudRenderState state)
    {
        Theme1HudBarView view = root.HudBar;
        if (view == null || state == null)
        {
            return;
        }

        Theme1PresentationTextUtils.ApplyPreservedHudValue(view.CountdownText, state.CountdownLabel, "00:45");
        Theme1PresentationTextUtils.ApplyOptionalHudValue(view.RoomPlayerCountText, state.PlayerCountLabel);
        Theme1PresentationTextUtils.SetActive(view.RoomPlayerCountText != null ? view.RoomPlayerCountText.gameObject : null, !string.IsNullOrWhiteSpace(view.RoomPlayerCountText != null ? view.RoomPlayerCountText.text : string.Empty));
        Theme1PresentationTextUtils.ApplyHudText(view.CreditText, state.CreditLabel);
        Theme1PresentationTextUtils.ApplyHudText(view.WinningsText, state.WinningsLabel);
        Theme1PresentationTextUtils.ApplyHudText(view.BetText, state.BetLabel);
    }

    private static void RenderTopper(Theme1GameplayViewRoot root, Theme1TopperRenderState state)
    {
        Theme1TopperStripView view = root.TopperStrip;
        if (view == null || state == null || view.Slots == null)
        {
            return;
        }

        int slotCount = view.Slots.Length;
        for (int slotIndex = 0; slotIndex < slotCount; slotIndex++)
        {
            Theme1TopperSlotView slotView = view.Slots[slotIndex];
            Theme1TopperSlotRenderState slotState = state.Slots != null && slotIndex < state.Slots.Length
                ? state.Slots[slotIndex]
                : Theme1TopperSlotRenderState.Empty;

            Theme1PresentationTextUtils.SetActive(slotView.PatternRoot, slotState.ShowPattern);
            Theme1PresentationTextUtils.SetActive(slotView.MatchedPatternRoot, slotState.ShowMatchedPattern);
            Theme1PresentationTextUtils.ApplyTopperText(slotView.PrizeLabel, slotState.PrizeLabel, slotView.DefaultPrizeColor);

            if (slotView.PrizeLabel != null)
            {
                slotView.PrizeLabel.color = slotState.PrizeVisualState switch
                {
                    Theme1PrizeVisualState.Matched => MatchedPrizeColor,
                    Theme1PrizeVisualState.NearWin => NearWinPrizeColor,
                    _ => slotView.DefaultPrizeColor
                };
            }

            int missingCount = slotView.MissingCells != null ? slotView.MissingCells.Length : 0;
            for (int cellIndex = 0; cellIndex < missingCount; cellIndex++)
            {
                bool visible = slotState.MissingCellsVisible != null &&
                               cellIndex < slotState.MissingCellsVisible.Length &&
                               slotState.MissingCellsVisible[cellIndex];
                Theme1PresentationTextUtils.SetActive(slotView.MissingCells[cellIndex], visible);
            }
        }
    }
}
