using System;
using UnityEngine;
using UnityEngine.UI;

[Serializable]
public sealed class Theme1HudControlsView
{
    [SerializeField] private RectTransform saldoPanel;
    [SerializeField] private RectTransform winningsPanel;
    [SerializeField] private RectTransform shuffleButtonRoot;
    [SerializeField] private RectTransform stakePanel;
    [SerializeField] private RectTransform placeBetButtonRoot;
    [SerializeField] private RectTransform nextDrawBanner;
    [SerializeField] private Button placeBetButton;
    [SerializeField] private Button shuffleButton;
    [SerializeField] private Button betUpButton;
    [SerializeField] private Button betDownButton;

    public RectTransform SaldoPanel => saldoPanel;
    public RectTransform WinningsPanel => winningsPanel;
    public RectTransform ShuffleButtonRoot => shuffleButtonRoot;
    public RectTransform StakePanel => stakePanel;
    public RectTransform PlaceBetButtonRoot => placeBetButtonRoot;
    public RectTransform NextDrawBanner => nextDrawBanner;
    public Button PlaceBetButton => placeBetButton;
    public Button ShuffleButton => shuffleButton;
    public Button BetUpButton => betUpButton;
    public Button BetDownButton => betDownButton;

    public void PullFrom(
        UIManager uiManager,
        RectTransform resolvedSaldoPanel,
        RectTransform resolvedWinningsPanel,
        RectTransform resolvedShuffleButtonRoot,
        RectTransform resolvedStakePanel,
        RectTransform resolvedPlaceBetButtonRoot,
        RectTransform resolvedNextDrawBanner)
    {
        saldoPanel = resolvedSaldoPanel;
        winningsPanel = resolvedWinningsPanel;
        shuffleButtonRoot = resolvedShuffleButtonRoot;
        stakePanel = resolvedStakePanel;
        placeBetButtonRoot = resolvedPlaceBetButtonRoot;
        nextDrawBanner = resolvedNextDrawBanner;

        placeBetButton = uiManager != null && uiManager.playBtn != null
            ? uiManager.playBtn
            : (resolvedPlaceBetButtonRoot != null ? resolvedPlaceBetButtonRoot.GetComponent<Button>() : null);
        shuffleButton = uiManager != null && uiManager.rerollTicketBtn != null
            ? uiManager.rerollTicketBtn
            : (resolvedShuffleButtonRoot != null ? resolvedShuffleButtonRoot.GetComponent<Button>() : null);
        betUpButton = uiManager != null && uiManager.betUp != null
            ? uiManager.betUp
            : FindNamedButton(resolvedStakePanel, "Theme1StakePlusButton");
        betDownButton = uiManager != null && uiManager.betDown != null
            ? uiManager.betDown
            : FindNamedButton(resolvedStakePanel, "Theme1StakeMinusButton");
    }

    public bool Validate(System.Collections.Generic.List<string> errors)
    {
        bool isValid = true;
        isValid &= ValidateRect(saldoPanel, "hudControls.saldoPanel", errors);
        isValid &= ValidateRect(winningsPanel, "hudControls.winningsPanel", errors);
        isValid &= ValidateRect(shuffleButtonRoot, "hudControls.shuffleButtonRoot", errors);
        isValid &= ValidateRect(stakePanel, "hudControls.stakePanel", errors);
        isValid &= ValidateRect(placeBetButtonRoot, "hudControls.placeBetButtonRoot", errors);
        isValid &= ValidateRect(nextDrawBanner, "hudControls.nextDrawBanner", errors);
        isValid &= ValidateButton(placeBetButton, "hudControls.placeBetButton", errors);
        isValid &= ValidateButton(shuffleButton, "hudControls.shuffleButton", errors);
        isValid &= ValidateButton(betUpButton, "hudControls.betUpButton", errors);
        isValid &= ValidateButton(betDownButton, "hudControls.betDownButton", errors);
        return isValid;
    }

    private static Button FindNamedButton(Transform parent, string objectName)
    {
        if (parent == null || string.IsNullOrWhiteSpace(objectName))
        {
            return null;
        }

        Transform child = parent.Find(objectName);
        return child != null ? child.GetComponent<Button>() : null;
    }

    private static bool ValidateRect(RectTransform target, string label, System.Collections.Generic.List<string> errors)
    {
        if (target != null)
        {
            return true;
        }

        errors.Add(label + " mangler.");
        return false;
    }

    private static bool ValidateButton(Button target, string label, System.Collections.Generic.List<string> errors)
    {
        if (target != null)
        {
            return true;
        }

        errors.Add(label + " mangler.");
        return false;
    }
}
