using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

internal static class Theme1ViewHierarchyResolver
{
    internal static Transform ResolveTopperPrizeParent(TopperManager topperManager, int slotIndex, TextMeshProUGUI template)
    {
        if (template != null && template.transform.parent != null)
        {
            return template.transform.parent;
        }

        if (topperManager?.patterns != null &&
            slotIndex >= 0 &&
            slotIndex < topperManager.patterns.Count &&
            topperManager.patterns[slotIndex] != null &&
            topperManager.patterns[slotIndex].transform.parent != null)
        {
            return topperManager.patterns[slotIndex].transform.parent;
        }

        if (topperManager?.matchedPatterns != null &&
            slotIndex >= 0 &&
            slotIndex < topperManager.matchedPatterns.Count &&
            topperManager.matchedPatterns[slotIndex] != null &&
            topperManager.matchedPatterns[slotIndex].transform.parent != null)
        {
            return topperManager.matchedPatterns[slotIndex].transform.parent;
        }

        if (topperManager?.missedPattern != null &&
            slotIndex >= 0 &&
            slotIndex < topperManager.missedPattern.Count &&
            topperManager.missedPattern[slotIndex] != null &&
            topperManager.missedPattern[slotIndex].transform.parent != null)
        {
            return topperManager.missedPattern[slotIndex].transform.parent;
        }

        return null;
    }

    internal static TextMeshProUGUI FindDedicatedCardNumberLabel(GameObject selectionOverlay)
    {
        RectTransform cellRoot = ResolveCardCellRoot(selectionOverlay);
        return Theme1RuntimeTextTargetBuilder.FindNamedTextLabel(cellRoot, Theme1GameplayViewRepairUtils.CardNumberLabelName);
    }

    internal static TextMeshProUGUI FindDedicatedCardRenderLabel(GameObject selectionOverlay)
    {
        RectTransform cellRoot = ResolveCardCellRoot(selectionOverlay);
        if (cellRoot == null)
        {
            return null;
        }

        TextMeshProUGUI visible = Theme1RuntimeTextTargetBuilder.FindNamedTextLabel(
            cellRoot,
            Theme1GameplayViewRepairUtils.CardNumberVisibleLabelName);
        if (visible != null)
        {
            return visible;
        }

        return Theme1RuntimeTextTargetBuilder.FindNamedTextLabel(cellRoot, Theme1GameplayViewRepairUtils.CardNumberLabelName);
    }

    internal static TextMeshProUGUI FindDedicatedBallNumberLabel(GameObject root)
    {
        return root == null
            ? null
            : Theme1RuntimeTextTargetBuilder.FindNamedTextLabel(root.transform, Theme1GameplayViewRepairUtils.BallNumberLabelName);
    }

    internal static TextMeshProUGUI FindDedicatedBigBallNumberLabel(Image bigBallImage)
    {
        return bigBallImage == null
            ? null
            : Theme1RuntimeTextTargetBuilder.FindNamedTextLabel(bigBallImage.transform, Theme1GameplayViewRepairUtils.BigBallNumberLabelName);
    }

    internal static bool IsDedicatedCardNumberLabel(TextMeshProUGUI label, GameObject selectionOverlay)
    {
        return label != null &&
               (string.Equals(label.gameObject.name, Theme1GameplayViewRepairUtils.CardNumberLabelName, StringComparison.Ordinal) ||
                string.Equals(label.gameObject.name, Theme1GameplayViewRepairUtils.CardNumberVisibleLabelName, StringComparison.Ordinal)) &&
               IsTextLocalToSelectionOverlay(label, selectionOverlay);
    }

    internal static bool IsDedicatedBallNumberLabel(TextMeshProUGUI label, GameObject root)
    {
        return label != null &&
               string.Equals(label.gameObject.name, Theme1GameplayViewRepairUtils.BallNumberLabelName, StringComparison.Ordinal) &&
               IsTextLocalToBallRoot(label, root);
    }

    internal static bool IsDedicatedBigBallNumberLabel(TextMeshProUGUI label, Image bigBallImage)
    {
        return label != null &&
               bigBallImage != null &&
               string.Equals(label.gameObject.name, Theme1GameplayViewRepairUtils.BigBallNumberLabelName, StringComparison.Ordinal) &&
               label.transform.IsChildOf(bigBallImage.transform);
    }

    internal static bool IsTextLocalToSelectionOverlay(TextMeshProUGUI label, GameObject selectionOverlay)
    {
        if (label == null || selectionOverlay == null)
        {
            return false;
        }

        RectTransform cellRoot = ResolveCardCellRoot(selectionOverlay);
        return cellRoot != null &&
               label.transform.parent == cellRoot &&
               cellRoot.parent != null &&
               string.Equals(cellRoot.parent.name, Theme1GameplayViewRepairUtils.CardNumberLayerName, StringComparison.Ordinal);
    }

    internal static bool IsTextLocalToBallRoot(TextMeshProUGUI label, GameObject root)
    {
        return label != null && root != null && label.transform.IsChildOf(root.transform);
    }

    internal static Transform ResolveCardRoot(CardClass card)
    {
        if (card == null)
        {
            return null;
        }

        if (card.selectionImg != null)
        {
            for (int i = 0; i < card.selectionImg.Count; i++)
            {
                Transform resolved = ResolveCardRoot(card.selectionImg[i]);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        if (card.num_text != null)
        {
            for (int i = 0; i < card.num_text.Count; i++)
            {
                Transform resolved = ResolveCardRoot(card.num_text[i] != null ? card.num_text[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        if (card.win != null)
        {
            Transform resolved = ResolveCardRoot(card.win.transform);
            if (resolved != null)
            {
                return resolved;
            }
        }

        if (card.paylineObj != null)
        {
            for (int i = 0; i < card.paylineObj.Count; i++)
            {
                Transform resolved = ResolveCardRoot(card.paylineObj[i] != null ? card.paylineObj[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        return null;
    }

    internal static Transform ResolveCardRoot(CandyCardViewBinding binding)
    {
        if (binding == null)
        {
            return null;
        }

        IReadOnlyList<GameObject> selectionOverlays = binding.SelectionOverlays;
        if (selectionOverlays != null)
        {
            for (int i = 0; i < selectionOverlays.Count; i++)
            {
                Transform resolved = ResolveCardRoot(selectionOverlays[i] != null ? selectionOverlays[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        IReadOnlyList<TextMeshProUGUI> numberTexts = binding.NumberTexts;
        if (numberTexts != null)
        {
            for (int i = 0; i < numberTexts.Count; i++)
            {
                Transform resolved = ResolveCardRoot(numberTexts[i] != null ? numberTexts[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        return null;
    }

    internal static RectTransform ResolveCardCellRoot(GameObject overlay)
    {
        if (overlay == null)
        {
            return null;
        }

        Transform current = overlay.transform;
        while (current != null)
        {
            if (current is RectTransform cellRoot &&
                current.parent != null &&
                (current.parent.GetComponent<GridLayoutGroup>() != null ||
                 string.Equals(current.parent.name, Theme1GameplayViewRepairUtils.CardNumberLayerName, StringComparison.Ordinal)))
            {
                return cellRoot;
            }

            current = current.parent;
        }

        return null;
    }

    private static Transform ResolveCardRoot(GameObject selectionOverlay)
    {
        return ResolveCardRoot(selectionOverlay != null ? selectionOverlay.transform : null);
    }

    private static Transform ResolveCardRoot(Transform source)
    {
        if (source == null)
        {
            return null;
        }

        Transform current = source;
        while (current != null)
        {
            if (string.Equals(current.name, Theme1GameplayViewRepairUtils.CardNumberLayerName, StringComparison.Ordinal) && current.parent != null)
            {
                return current.parent;
            }

            if (current.GetComponent<GridLayoutGroup>() != null && current.parent != null)
            {
                return current.parent;
            }

            current = current.parent;
        }

        return null;
    }
}
