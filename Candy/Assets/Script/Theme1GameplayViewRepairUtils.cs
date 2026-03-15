using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public static class Theme1GameplayViewRepairUtils
{
    public const string CardNumberLayerName = "RealtimeCardNumbers";
    public const string CardNumberHostPrefix = "RealtimeCardCell_";
    public const string CardNumberLabelName = "RealtimeCardNumberLabel";
    public const string CardNumberVisibleLabelName = "RealtimeCardNumberVisibleLabel";
    public const string SelectionMarkerName = "RealtimeSelectionMarker";
    public const string MissingOverlayName = "RealtimeMissingOverlay";
    public const string MatchedOverlayName = "RealtimeMatchedOverlay";
    public const string CreditValueLabelName = "RealtimeCreditValueLabel";
    public const string WinningsValueLabelName = "RealtimeWinningsValueLabel";
    public const string BetValueLabelName = "RealtimeBetValueLabel";
    public const string VisibleLabelSuffix = "_Visible";
    public const string BallNumberLabelName = "RealtimeBallNumberLabel";
    public const string BigBallNumberLabelName = "RealtimeBigBallNumberLabel";
    public const string CardBackgroundName = "CardBg";
    public const string CardBoardRootName = "RealtimeCardBoard";
    public const string CardShellName = "RealtimeCardShell";
    public const string CardShellInnerName = "RealtimeCardShellInner";
    public const string CardShellChromeOuterName = "RealtimeCardShellChromeOuter";
    public const string CardShellChromeInnerName = "RealtimeCardShellChromeInner";
    public const string CardShellGlossName = "RealtimeCardShellGloss";
    public const string CardTopPanelName = "RealtimeCardTopPanel";
    public const string CardTopPanelGlossName = "RealtimeCardTopPanelGloss";
    public const string CardBottomPanelName = "RealtimeCardBottomPanel";
    public const string CardBottomPanelGlossName = "RealtimeCardBottomPanelGloss";
    public const string CardBottomTabName = "RealtimeCardBottomTab";
    public const string CardGridFrameName = "RealtimeCardGridFrame";
    public const string CardPatternOverlayRootName = "RealtimeCardPatternOverlays";
    public const string CardPaylineObjectPrefix = "RealtimeCardPayline_";
    public const string CardCellBackgroundName = "RealtimeCardCellBackground";
    public const string CardCellGlowName = "RealtimeCardCellGlow";
    public const string CardCellPrizeLabelName = "RealtimeCardCellPrizeLabel";
    public const string SingleCardRerollButtonPrefix = "Theme1SingleCardRerollButton_";
    public const int TotalCardCellCount = 15;
    public const int VisibleCardCellCount = 15;
    public const int VisibleCardRows = 3;
    public const int VisibleCardColumns = 5;

    public static string BuildSingleCardRerollButtonName(int cardIndex)
    {
        return SingleCardRerollButtonPrefix + (cardIndex + 1);
    }

    public static void EnsureCardNumberTargets(NumberGenerator generator)
    {
        Theme1RealtimeCardContractBuilder.EnsureCardNumberTargets(generator);
    }

    public static void EnsureBallNumberTargets(BallManager ballManager)
    {
        Theme1RealtimeBallContractBuilder.EnsureBallNumberTargets(ballManager);
    }

    public static void EnsureCardDisplayTextBindings(CandyCardViewBindingSet cardBindings, GameManager gameManager)
    {
        Theme1RealtimeCardContractBuilder.EnsureCardDisplayTextBindings(cardBindings, gameManager);
    }

    public static CandyCardViewBinding BuildDedicatedCardBinding(CardClass card, int cardIndex, GameManager gameManager)
    {
        return Theme1RealtimeCardContractBuilder.BuildDedicatedCardBinding(card, cardIndex, gameManager);
    }

    public static void EnsureHudValueTargets(GameManager gameManager)
    {
        Theme1RealtimeHudContractBuilder.EnsureHudValueTargets(gameManager);
    }

    public static void EnsureTopperPrizeTargets(TopperManager topperManager, GameManager gameManager)
    {
        Theme1RealtimeTopperContractBuilder.EnsureTopperPrizeTargets(topperManager, gameManager);
    }

    public static TextMeshProUGUI FindDedicatedCardNumberLabel(GameObject selectionOverlay)
    {
        return Theme1ViewHierarchyResolver.FindDedicatedCardNumberLabel(selectionOverlay);
    }

    public static TextMeshProUGUI FindDedicatedCardRenderLabel(GameObject selectionOverlay)
    {
        return Theme1ViewHierarchyResolver.FindDedicatedCardRenderLabel(selectionOverlay);
    }

    public static TextMeshProUGUI FindDedicatedBallNumberLabel(GameObject root)
    {
        return Theme1ViewHierarchyResolver.FindDedicatedBallNumberLabel(root);
    }

    public static TextMeshProUGUI FindDedicatedBigBallNumberLabel(Image bigBallImage)
    {
        return Theme1ViewHierarchyResolver.FindDedicatedBigBallNumberLabel(bigBallImage);
    }

    public static bool IsDedicatedCardNumberLabel(TextMeshProUGUI label, GameObject selectionOverlay)
    {
        return Theme1ViewHierarchyResolver.IsDedicatedCardNumberLabel(label, selectionOverlay);
    }

    public static bool IsDedicatedBallNumberLabel(TextMeshProUGUI label, GameObject root)
    {
        return Theme1ViewHierarchyResolver.IsDedicatedBallNumberLabel(label, root);
    }

    public static bool IsDedicatedBigBallNumberLabel(TextMeshProUGUI label, Image bigBallImage)
    {
        return Theme1ViewHierarchyResolver.IsDedicatedBigBallNumberLabel(label, bigBallImage);
    }

    public static bool IsTextLocalToSelectionOverlay(TextMeshProUGUI label, GameObject selectionOverlay)
    {
        return Theme1ViewHierarchyResolver.IsTextLocalToSelectionOverlay(label, selectionOverlay);
    }

    public static bool IsTextLocalToBallRoot(TextMeshProUGUI label, GameObject root)
    {
        return Theme1ViewHierarchyResolver.IsTextLocalToBallRoot(label, root);
    }

}
