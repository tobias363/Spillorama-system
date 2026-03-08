using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public sealed class Theme1DisplayPresenter
{
    private static readonly Color MatchedPrizeColor = Color.green;
    private static readonly Color NearWinPrizeColor = new Color(1f, 0.92f, 0.3f, 1f);

    public void Render(Theme1GameplayViewRoot root, Theme1DisplayState state)
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

            ApplyHudText(view?.HeaderLabel, state.HeaderLabel);
            ApplyHudText(view?.BetLabel, state.BetLabel);
            if (view?.WinLabel != null)
            {
                if (state.ShowWinLabel && !string.IsNullOrWhiteSpace(state.WinLabel))
                {
                    ApplyHudText(view.WinLabel, state.WinLabel);
                }
                else
                {
                    ApplyRawText(view.WinLabel, string.Empty);
                }

                SetActive(view.WinLabel.gameObject, state.ShowWinLabel);
            }

            int cellCount = view?.Cells != null ? view.Cells.Length : 0;
            for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
            {
                Theme1CardCellView cellView = view.Cells[cellIndex];
                Theme1CardCellRenderState cellState = state.Cells != null && cellIndex < state.Cells.Length
                    ? state.Cells[cellIndex]
                    : Theme1CardCellRenderState.Empty;

                ApplyCardNumberText(cellView?.NumberLabel, cellState.NumberLabel);
                SetActive(cellView?.SelectionOverlay, cellState.IsSelected);
                SetActive(cellView?.MissingOverlay, cellState.IsMissing);
                SetActive(cellView?.MatchedOverlay, cellState.IsMatched);
            }

            int paylineCount = view?.PaylineObjects != null ? view.PaylineObjects.Length : 0;
            for (int paylineIndex = 0; paylineIndex < paylineCount; paylineIndex++)
            {
                bool isActive = state.PaylinesActive != null &&
                                paylineIndex < state.PaylinesActive.Length &&
                                state.PaylinesActive[paylineIndex];
                SetActive(view.PaylineObjects[paylineIndex], isActive);
            }
        }
    }

    private static void RenderBallRack(Theme1GameplayViewRoot root, Theme1BallRackRenderState state)
    {
        Theme1BallRackView view = root.BallRack;
        if (view == null || state == null)
        {
            return;
        }

        SetActive(view.BallOutMachineAnimParent, state.ShowBallOutMachine);
        SetActive(view.BallMachine, state.ShowBallMachine);
        SetActive(view.ExtraBallMachine, state.ShowExtraBallMachine);
        if (view.BigBallImage != null)
        {
            SetActive(view.BigBallImage.gameObject, state.ShowBigBall);
        }

        SetHiddenBallNumberLabel(view.BigBallText, state.BigBallNumber);
        ApplyBigBallSprite(view.BigBallImage, state.BigBallNumber);

        int slotCount = view.Slots != null ? view.Slots.Length : 0;
        for (int slotIndex = 0; slotIndex < slotCount; slotIndex++)
        {
            Theme1BallSlotView slotView = view.Slots[slotIndex];
            Theme1BallSlotRenderState slotState = state.Slots != null && slotIndex < state.Slots.Length
                ? state.Slots[slotIndex]
                : Theme1BallSlotRenderState.Empty;

            SetActive(slotView?.Root, slotState.IsVisible);
            SetHiddenBallNumberLabel(slotView?.NumberLabel, slotState.NumberLabel);
            ApplySlotBallSprite(slotView?.SpriteTarget, slotState.NumberLabel);
        }
    }

    private static void RenderHud(Theme1GameplayViewRoot root, Theme1HudRenderState state)
    {
        Theme1HudBarView view = root.HudBar;
        if (view == null || state == null)
        {
            return;
        }

        GameManager gameManager = GameManager.instance;
        ApplyHudText(view.CountdownText, state.CountdownLabel);
        ApplyHudText(view.RoomPlayerCountText, state.PlayerCountLabel);
        ApplyRequiredHudValue(
            view.CreditText,
            state.CreditLabel,
            gameManager != null ? gameManager.CreditBalance.ToString() : "0");
        ApplyRequiredHudValue(
            view.WinningsText,
            state.WinningsLabel,
            gameManager != null ? gameManager.RoundWinnings.ToString() : "0");
        ApplyRequiredHudValue(
            view.BetText,
            state.BetLabel,
            gameManager != null ? gameManager.currentBet.ToString() : "0");
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

            SetActive(slotView?.PatternRoot, slotState.ShowPattern);
            SetActive(slotView?.MatchedPatternRoot, slotState.ShowMatchedPattern);
            ApplyTopperText(slotView?.PrizeLabel, slotState.PrizeLabel, slotView != null ? slotView.DefaultPrizeColor : Color.white);

            if (slotView?.PrizeLabel != null)
            {
                slotView.PrizeLabel.color = slotState.PrizeVisualState switch
                {
                    Theme1PrizeVisualState.Matched => MatchedPrizeColor,
                    Theme1PrizeVisualState.NearWin => NearWinPrizeColor,
                    _ => slotView.DefaultPrizeColor
                };
            }

            int missingCount = slotView?.MissingCells != null ? slotView.MissingCells.Length : 0;
            for (int cellIndex = 0; cellIndex < missingCount; cellIndex++)
            {
                bool visible = slotState.MissingCellsVisible != null &&
                               cellIndex < slotState.MissingCellsVisible.Length &&
                               slotState.MissingCellsVisible[cellIndex];
                SetActive(slotView.MissingCells[cellIndex], visible);
            }
        }
    }

    private static void ApplyCardNumberText(TMP_Text target, string value)
    {
        if (target is TextMeshProUGUI label)
        {
            RealtimeTextStyleUtils.ApplyCardNumber(label, value ?? string.Empty);
            return;
        }

        ApplyRawText(target, value);
    }

    private static void ApplyHudText(TMP_Text target, string value)
    {
        if (target is TextMeshProUGUI label)
        {
            RealtimeTextStyleUtils.ApplyHudText(label, value ?? string.Empty, preferredColor: label.color);
            return;
        }

        ApplyRawText(target, value);
    }

    private static void ApplyRequiredHudValue(TMP_Text target, string value, string authoritativeFallback)
    {
        string resolvedValue = !string.IsNullOrWhiteSpace(value)
            ? value
            : (!string.IsNullOrWhiteSpace(authoritativeFallback)
                ? authoritativeFallback
                : (!string.IsNullOrWhiteSpace(target?.text) ? target.text : "0"));
        ApplyHudText(target, resolvedValue);
    }

    private static void ApplyTopperText(TMP_Text target, string value, Color defaultColor)
    {
        if (target is TextMeshProUGUI label)
        {
            RealtimeTextStyleUtils.ApplyHudText(label, value ?? string.Empty, preferredColor: defaultColor);
            return;
        }

        ApplyRawText(target, value);
    }

    private static void ApplySlotBallSprite(Image target, string numberLabel)
    {
        if (target == null)
        {
            return;
        }

        if (!TryParseBallNumber(numberLabel, out int ballNumber))
        {
            return;
        }

        if (CandyBallVisualCatalog.TryGetSmallSprite(ballNumber, out Sprite sprite))
        {
            target.sprite = sprite;
            target.preserveAspect = true;
            return;
        }

        CandyBallVisualCatalog.LogMissingVisual(ballNumber, "slot");
    }

    private static void ApplyBigBallSprite(Image target, string numberLabel)
    {
        if (target == null)
        {
            return;
        }

        if (!TryParseBallNumber(numberLabel, out int ballNumber))
        {
            return;
        }

        if (CandyBallVisualCatalog.TryGetBigSprite(ballNumber, out Sprite sprite))
        {
            target.sprite = sprite;
            target.preserveAspect = true;
            return;
        }

        CandyBallVisualCatalog.LogMissingVisual(ballNumber, "big-ball");
    }

    private static void SetHiddenBallNumberLabel(TMP_Text target, string value)
    {
        if (target == null)
        {
            return;
        }

        ApplyRawText(target, value);
        target.alpha = 0f;
        target.enabled = false;
        if (target.gameObject.activeSelf)
        {
            target.gameObject.SetActive(false);
        }
    }

    private static void ApplyRawText(TMP_Text target, string value)
    {
        if (target == null)
        {
            return;
        }

        string normalizedValue = value ?? string.Empty;
        if (!string.Equals(target.text, normalizedValue))
        {
            target.text = normalizedValue;
        }

        target.havePropertiesChanged = true;
        target.SetVerticesDirty();
        target.SetMaterialDirty();
        target.SetLayoutDirty();
    }

    private static bool TryParseBallNumber(string value, out int ballNumber)
    {
        ballNumber = 0;
        return !string.IsNullOrWhiteSpace(value) && int.TryParse(value, out ballNumber) && ballNumber > 0;
    }

    private static void SetActive(GameObject target, bool active)
    {
        if (target != null && target.activeSelf != active)
        {
            target.SetActive(active);
        }
    }
}
