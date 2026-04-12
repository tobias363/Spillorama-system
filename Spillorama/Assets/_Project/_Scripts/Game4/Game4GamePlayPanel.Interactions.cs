using UnityEngine;

public partial class Game4GamePlayPanel
{
    public void Game4ChangeTickets()
    {
        // TODO: Wire to Spillorama REST endpoint when Game 4 backend is ready.
        Debug.LogWarning("[Game4] Game4ChangeTickets: Spillorama endpoint not yet implemented");
    }

    public void OnPlayButtonTap()
    {
        SoundManager.Instance.ResetPlayedAnnouncements();
        btnPlay.interactable = false;
        CallGame4PlayEvent();
    }

    public void OnTicketButtonTap()
    {
        if (IsGamePlayInProcess || isGameRunningStatus)
            return;

        IsTicketOptionEnable = !IsTicketOptionEnable;
        imgSelectTicketHighlight.color = theme.betPanelTheme.ticketThumbnailOutlineColor;
        imgSelectTicketHighlight.gameObject.SetActive(IsTicketOptionEnable);
    }

    public void OnTryOtherGamesButtonTap()
    {
        imgTryOtherGamesPanel.Open();
    }

    public void ModifyBetValue(bool isIncreased)
    {
        betMultiplierIndex += isIncreased ? 1 : -1;

        if (betMultiplierIndex > game4Data.betData.ticket1Multiplier.Count - 1)
            betMultiplierIndex = 0;
        else if (betMultiplierIndex < 0)
            betMultiplierIndex = game4Data.betData.ticket1Multiplier.Count - 1;

        RefreshBetValue();
    }

    public UtilityMessagePanel GetUtilityMessagePanel()
    {
        if (loaderPanel && Utility.Instance.IsSplitScreenSupported && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1)
            return messagePopup;

        return UIManager.Instance.messagePopup;
    }

    public void DisplayLoader(bool showLoader)
    {
        if (loaderPanel && Utility.Instance.IsSplitScreenSupported && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1)
        {
            if (showLoader)
            {
                loaderPanel.ShowLoader();
            }
            else
            {
                loaderPanel.HideLoader();
                UIManager.Instance.DisplayLoader(false);
            }
        }
    }

    /// <summary>
    /// This is a custom UI handling function. Code normalization is remain.
    /// </summary>
    public void RefreshSplitScreenLayoutUI(int totalActiveGames)
    {
        if (totalActiveGames >= 3)
        {
            rectTransformTicketScrollViewContainer.localScale = new Vector3(0.7f, 0.7f, 0.7f);

            rectTransformTicketScrollViewContainer.SetTop(55);
            rectTransformTicketScrollViewContainer.SetBottom(155);
            rectTransformTicketScrollViewContainer.SetLeft(-78);
            rectTransformTicketScrollViewContainer.SetRight(244);

            rectTransformTicketContainer.pivot = new Vector2(0, 1);

            gridLayoutGroupTicketContainer.spacing = new Vector2(36, 0);
            gridLayoutGroupTicketContainer.constraintCount = 1;

            rectTransformWithdrawBallPanel.pivot = new Vector2(1f, 0);
            rectTransformWithdrawBallPanel.SetAnchor(AnchorPresets.BottomRight, -34, 218);
            rectTransformWithdrawBallPanel.sizeDelta = new Vector2(292, 150);

            gridLayoutGroupWithdrawBallContainer.cellSize = new Vector2(28, 28);
            gridLayoutGroupWithdrawBallContainer.spacing = new Vector2(3, 6);

            rectTransformPatternContainerPanel.SetAnchor(AnchorPresets.HorStretchBottom, 0, 82);
            rectTransformPatternContainerPanel.SetLeft(1.25f);
            rectTransformPatternContainerPanel.SetRight(0);

            btnTicketRefreshInScrollViewButton.enabled = false;
            btnTicketRefreshPhysicalButton.Open();
            return;
        }

        rectTransformTicketScrollViewContainer.localScale = Vector3.one;

        rectTransformTicketScrollViewContainer.SetTop(130);
        rectTransformTicketScrollViewContainer.SetBottom(155);
        rectTransformTicketScrollViewContainer.SetLeft(0);
        rectTransformTicketScrollViewContainer.SetRight(0);

        rectTransformTicketContainer.pivot = new Vector2(0.5f, 1);

        gridLayoutGroupTicketContainer.spacing = new Vector2(54, 38.82f);
        gridLayoutGroupTicketContainer.constraintCount = 2;

        rectTransformWithdrawBallPanel.pivot = new Vector2(0.5f, 0);
        rectTransformWithdrawBallPanel.SetAnchor(AnchorPresets.BottomCenter, 0, 200);
        rectTransformWithdrawBallPanel.sizeDelta = new Vector2(892, 150);

        gridLayoutGroupWithdrawBallContainer.cellSize = new Vector2(42, 42);
        gridLayoutGroupWithdrawBallContainer.spacing = new Vector2(4, 4);

        if (totalActiveGames == 1)
        {
            rectTransformPatternContainerPanel.SetAnchor(AnchorPresets.BottomCenter, 0, 82);
            rectTransformPatternContainerPanel.sizeDelta = new Vector2(1450, 74);
        }
        else
        {
            rectTransformPatternContainerPanel.SetAnchor(AnchorPresets.HorStretchBottom, 0, 82);
            rectTransformPatternContainerPanel.SetLeft(1.25f);
            rectTransformPatternContainerPanel.SetRight(0);
        }

        btnTicketRefreshInScrollViewButton.enabled = true;
        btnTicketRefreshPhysicalButton.Close();
    }

    private void CloseMiniGames()
    {
        fortuneWheelManager.Close();
        treasureChestPanel.Close();
        mysteryGamePanel.Close();
    }
}
