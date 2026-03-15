using System.Collections.Generic;
using TMPro;
using UnityEngine;

internal static class Theme1RealtimeCardContractBuilder
{
    public static void EnsureCardNumberTargets(NumberGenerator generator)
    {
        if (generator?.cardClasses == null)
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

            Transform cardRoot = Theme1ViewHierarchyResolver.ResolveCardRoot(card);
            RectTransform visibleGrid = Theme1CardBoardBuilder.EnsureDedicatedVisibleGrid(cardRoot);
            if (visibleGrid == null)
            {
                continue;
            }

            Theme1CardBoardBuilder.EnsureDedicatedCardBoard(cardRoot, visibleGrid);
            RectTransform patternOverlayRoot = Theme1CardBoardBuilder.EnsureDedicatedPatternOverlayRoot(cardRoot, visibleGrid);
            Theme1CardBoardBuilder.EnsureDedicatedPaylineObjects(card, patternOverlayRoot, generator.patternList);

            card.num_text ??= new List<TextMeshProUGUI>(Theme1GameplayViewRepairUtils.TotalCardCellCount);
            card.selectionImg ??= new List<GameObject>(Theme1GameplayViewRepairUtils.TotalCardCellCount);
            card.missingPatternImg ??= new List<GameObject>(Theme1GameplayViewRepairUtils.TotalCardCellCount);
            card.matchPatternImg ??= new List<GameObject>(Theme1GameplayViewRepairUtils.TotalCardCellCount);
            Theme1RuntimeViewCommon.EnsureListCapacity(card.num_text, Theme1GameplayViewRepairUtils.TotalCardCellCount);
            Theme1RuntimeViewCommon.EnsureListCapacity(card.selectionImg, Theme1GameplayViewRepairUtils.TotalCardCellCount);
            Theme1RuntimeViewCommon.EnsureListCapacity(card.missingPatternImg, Theme1GameplayViewRepairUtils.TotalCardCellCount);
            Theme1RuntimeViewCommon.EnsureListCapacity(card.matchPatternImg, Theme1GameplayViewRepairUtils.TotalCardCellCount);
            for (int cellIndex = 0; cellIndex < Theme1GameplayViewRepairUtils.TotalCardCellCount; cellIndex++)
            {
                RectTransform cellRoot = Theme1CardBoardBuilder.ResolveDedicatedCellRoot(visibleGrid, cellIndex);
                if (cellRoot == null)
                {
                    continue;
                }

                Vector2 preferredSize = Theme1RuntimeViewCommon.ResolvePreferredCellSize(cellRoot);
                TextMeshProUGUI label = Theme1RuntimeTextTargetBuilder.ResolveOrCreateTextLabel(
                    cellRoot,
                    Theme1GameplayViewRepairUtils.CardNumberLabelName,
                    preferredSize,
                    GameplayTextSurface.CardNumber,
                    Theme1BongStyle.VisibleNumberMirrorColor,
                    fontSizeMin: 20f,
                    fontSizeMax: 72f);
                if (label == null)
                {
                    continue;
                }

                Theme1RuntimeTextTargetBuilder.PlaceCardNumberLabel(label.rectTransform, cellRoot);
                Theme1VisibleTextMirrorFactory.EnsureVisibleTextMirror(
                    label,
                    Theme1GameplayViewRepairUtils.CardNumberVisibleLabelName,
                    Theme1BongStyle.VisibleNumberMirrorColor,
                    hideWhenBlank: false);
                Theme1RuntimeTextTargetBuilder.DeactivateLegacyTextLabels(cellRoot, label);
                Theme1CardBoardBuilder.EnsureDedicatedCellVisuals(cellRoot, label);
                TextMeshProUGUI visibleLabel = Theme1RuntimeTextTargetBuilder.EnsureDedicatedVisibleCardNumberLabel(cellRoot, label);
                GameObject selectionMarker = Theme1CardBoardBuilder.EnsureCardCellStateToken(cellRoot, Theme1GameplayViewRepairUtils.SelectionMarkerName);
                GameObject missingOverlay = Theme1CardBoardBuilder.EnsureCardCellStateToken(cellRoot, Theme1GameplayViewRepairUtils.MissingOverlayName);
                GameObject matchedOverlay = Theme1CardBoardBuilder.EnsureCardCellStateToken(cellRoot, Theme1GameplayViewRepairUtils.MatchedOverlayName);

                bool isVisibleCell = cellIndex < Theme1GameplayViewRepairUtils.VisibleCardCellCount;
                cellRoot.gameObject.SetActive(isVisibleCell);
                Theme1RuntimeViewCommon.SetActiveIfNeeded(selectionMarker, false);
                Theme1RuntimeViewCommon.SetActiveIfNeeded(missingOverlay, false);
                Theme1RuntimeViewCommon.SetActiveIfNeeded(matchedOverlay, false);
                card.num_text[cellIndex] = visibleLabel != null ? visibleLabel : label;
                card.selectionImg[cellIndex] = selectionMarker;
                card.missingPatternImg[cellIndex] = missingOverlay;
                card.matchPatternImg[cellIndex] = matchedOverlay;
            }

            Theme1CardBoardBuilder.PromoteCardNumberLayer(visibleGrid);
        }
    }

    public static void EnsureCardDisplayTextBindings(CandyCardViewBindingSet cardBindings, GameManager gameManager)
    {
        if (cardBindings?.Cards == null)
        {
            return;
        }

        List<TextMeshProUGUI> resolvedBetLabels = new List<TextMeshProUGUI>(cardBindings.Cards.Count);
        List<TextMeshProUGUI> resolvedWinLabels = new List<TextMeshProUGUI>(cardBindings.Cards.Count);

        for (int cardIndex = 0; cardIndex < cardBindings.Cards.Count; cardIndex++)
        {
            CandyCardViewBinding binding = cardBindings.Cards[cardIndex];
            if (binding == null)
            {
                resolvedBetLabels.Add(null);
                resolvedWinLabels.Add(null);
                continue;
            }

            Transform cardRoot = Theme1ViewHierarchyResolver.ResolveCardRoot(binding);
            TextMeshProUGUI header = Theme1RuntimeTextTargetBuilder.EnsureDedicatedCardLabel(
                cardRoot,
                $"RealtimeCardHeaderLabel_{cardIndex + 1}",
                Theme1RuntimeTextTargetBuilder.RuntimeCardLabelKind.CardIndex,
                gameManager != null ? gameManager.GetCardIndexLabel(cardIndex) : GameManager.FormatTheme1CardHeaderLabel(cardIndex));
            TextMeshProUGUI bet = Theme1RuntimeTextTargetBuilder.EnsureDedicatedCardLabel(
                cardRoot,
                $"RealtimeCardBetLabel_{cardIndex + 1}",
                Theme1RuntimeTextTargetBuilder.RuntimeCardLabelKind.Stake,
                gameManager != null ? gameManager.GetCardStakeLabel() : GameManager.FormatTheme1CardStakeLabel(0));
            string defaultWinText = Theme1CardLabelPolicy.ResolveWinLabel(gameManager, 0, string.Empty, out bool showWinLabel);
            TextMeshProUGUI win = Theme1RuntimeTextTargetBuilder.EnsureDedicatedCardLabel(
                cardRoot,
                $"RealtimeCardWinLabel_{cardIndex + 1}",
                Theme1RuntimeTextTargetBuilder.RuntimeCardLabelKind.Win,
                defaultWinText);

            Theme1OverlayLabelFactory.ApplyOverlayLabelDefault(header, gameManager != null ? gameManager.GetCardIndexLabel(cardIndex) : GameManager.FormatTheme1CardHeaderLabel(cardIndex));
            Theme1OverlayLabelFactory.ApplyOverlayLabelDefault(bet, gameManager != null ? gameManager.GetCardStakeLabel() : GameManager.FormatTheme1CardStakeLabel(0));
            Theme1OverlayLabelFactory.ApplyOverlayLabelDefault(win, defaultWinText);
            if (win != null)
            {
                win.gameObject.SetActive(showWinLabel);
            }

            Theme1RuntimeTextTargetBuilder.DeactivateLegacyCardLabelContainers(cardRoot, header, bet, win);
            binding.SetDisplayTexts(header, bet, win);
            resolvedBetLabels.Add(bet);
            resolvedWinLabels.Add(win);
        }

        if (gameManager != null)
        {
            gameManager.CardBets = resolvedBetLabels;
            gameManager.displayCardWinPoints = resolvedWinLabels;
        }
    }

    public static CandyCardViewBinding BuildDedicatedCardBinding(CardClass card, int cardIndex, GameManager gameManager)
    {
        if (card == null)
        {
            return null;
        }

        CandyCardViewBinding binding = new CandyCardViewBinding();
        binding.CopyFrom(card, $"Card {cardIndex + 1}");

        Transform cardRoot = Theme1ViewHierarchyResolver.ResolveCardRoot(card);
        if (cardRoot == null)
        {
            return binding;
        }

        string headerText = gameManager != null
            ? gameManager.GetCardIndexLabel(cardIndex)
            : GameManager.FormatTheme1CardHeaderLabel(cardIndex);
        string betText = gameManager != null
            ? gameManager.GetCardStakeLabel()
            : GameManager.FormatTheme1CardStakeLabel(0);
        int cardWinAmount = gameManager != null ? gameManager.GetCardWinAmount(cardIndex) : 0;
        string winText = Theme1CardLabelPolicy.ResolveWinLabel(gameManager, cardWinAmount, string.Empty, out bool showWinLabel);

        TextMeshProUGUI header = Theme1RuntimeTextTargetBuilder.EnsureDedicatedCardLabel(
            cardRoot,
            $"RealtimeCardHeaderLabel_{cardIndex + 1}",
            Theme1RuntimeTextTargetBuilder.RuntimeCardLabelKind.CardIndex,
            headerText);
        TextMeshProUGUI bet = Theme1RuntimeTextTargetBuilder.EnsureDedicatedCardLabel(
            cardRoot,
            $"RealtimeCardBetLabel_{cardIndex + 1}",
            Theme1RuntimeTextTargetBuilder.RuntimeCardLabelKind.Stake,
            betText);
        TextMeshProUGUI win = Theme1RuntimeTextTargetBuilder.EnsureDedicatedCardLabel(
            cardRoot,
            $"RealtimeCardWinLabel_{cardIndex + 1}",
            Theme1RuntimeTextTargetBuilder.RuntimeCardLabelKind.Win,
            winText);

        Theme1OverlayLabelFactory.ApplyOverlayLabelDefault(header, headerText);
        Theme1OverlayLabelFactory.ApplyOverlayLabelDefault(bet, betText);
        Theme1OverlayLabelFactory.ApplyOverlayLabelDefault(win, winText);
        if (win != null)
        {
            win.gameObject.SetActive(showWinLabel);
        }

        Theme1RuntimeTextTargetBuilder.DeactivateLegacyCardLabelContainers(cardRoot, header, bet, win);
        binding.SetDisplayTexts(header, bet, win);
        card.win = win;
        return binding;
    }
}
