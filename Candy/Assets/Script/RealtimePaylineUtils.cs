using System.Collections.Generic;
using UnityEngine;

public static class RealtimePaylineUtils
{
    public static void EnsurePaylineIndexCapacity(CardClass card, int requiredCount)
    {
        if (card == null || requiredCount <= 0)
        {
            return;
        }

        while (card.paylineindex.Count < requiredCount)
        {
            card.paylineindex.Add(false);
        }
    }

    public static void SetPaylineVisual(
        CardClass[] cards,
        int cardNo,
        int patternIndex,
        bool active,
        bool matched,
        Material matchedMaterial,
        Material unmatchedMaterial)
    {
        if (cards == null || cardNo < 0 || cardNo >= cards.Length)
        {
            return;
        }

        CardClass card = cards[cardNo];
        if (card == null || card.paylineObj == null || patternIndex < 0 || patternIndex >= card.paylineObj.Count)
        {
            return;
        }

        GameObject paylineObject = card.paylineObj[patternIndex];
        if (paylineObject == null)
        {
            return;
        }

        paylineObject.SetActive(active);
        Material targetMaterial = matched ? matchedMaterial : unmatchedMaterial;
        if (targetMaterial == null)
        {
            return;
        }

        foreach (Transform segment in paylineObject.transform)
        {
            LineRenderer renderer = segment.GetComponent<LineRenderer>();
            if (renderer != null)
            {
                renderer.material = targetMaterial;
            }
        }
    }

    public static bool IsPatternMatchedOnCard(CardClass card, List<Patterns> patternList, int patternIndex)
    {
        if (card == null || patternList == null || patternIndex < 0 || patternIndex >= patternList.Count)
        {
            return false;
        }

        List<byte> mask = patternList[patternIndex].pattern;
        if (mask == null)
        {
            return false;
        }

        int cellCount = Mathf.Min(mask.Count, card.payLinePattern.Count);
        for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
        {
            if (mask[cellIndex] == 1 && card.payLinePattern[cellIndex] != 1)
            {
                return false;
            }
        }

        return true;
    }

    public static void ShowMatchedPaylinePatternsForCurrentCards(
        CardClass[] cards,
        List<Patterns> patternList,
        bool onlyFirstMatchPerCard,
        Material matchedMaterial,
        Material unmatchedMaterial)
    {
        if (cards == null || patternList == null)
        {
            return;
        }

        for (int cardNo = 0; cardNo < cards.Length; cardNo++)
        {
            CardClass card = cards[cardNo];
            if (card == null || card.paylineObj == null)
            {
                continue;
            }

            int patternCount = Mathf.Min(patternList.Count, card.paylineObj.Count);
            EnsurePaylineIndexCapacity(card, patternCount);

            bool matchedLineShown = false;
            for (int patternIndex = 0; patternIndex < patternCount; patternIndex++)
            {
                bool isMatched = !matchedLineShown &&
                                 IsPatternMatchedOnCard(card, patternList, patternIndex);

                card.paylineindex[patternIndex] = isMatched;
                SetPaylineVisual(
                    cards,
                    cardNo,
                    patternIndex,
                    isMatched,
                    isMatched,
                    matchedMaterial,
                    unmatchedMaterial);

                if (isMatched && onlyFirstMatchPerCard)
                {
                    matchedLineShown = true;
                }
            }
        }
    }

    public static void ClearPaylineVisuals(CardClass[] cards)
    {
        if (cards == null)
        {
            return;
        }

        for (int cardNo = 0; cardNo < cards.Length; cardNo++)
        {
            CardClass card = cards[cardNo];
            if (card == null || card.paylineObj == null)
            {
                continue;
            }

            for (int patternIndex = 0; patternIndex < card.paylineObj.Count; patternIndex++)
            {
                GameObject paylineObject = card.paylineObj[patternIndex];
                if (paylineObject != null)
                {
                    paylineObject.SetActive(false);
                }
            }

            for (int i = 0; i < card.paylineindex.Count; i++)
            {
                card.paylineindex[i] = false;
            }
        }
    }
}
