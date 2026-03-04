using TMPro;
using UnityEngine;

public sealed class RealtimeCountdownPresenter
{
    private bool isLayoutInitialized;
    private float baseWidth = -1f;
    private float baseParentWidth = -1f;

    public void ResetLayoutCache()
    {
        isLayoutInitialized = false;
        baseWidth = -1f;
        baseParentWidth = -1f;
    }

    public void PositionUnderBalls(
        NumberGenerator generator,
        BallManager ballManager,
        Vector2 offset,
        float widthMultiplier,
        float minParentWidthRatio,
        float minWidth,
        float edgePadding)
    {
        if (generator == null || generator.autoSpinRemainingPlayText == null)
        {
            return;
        }

        if (ballManager == null || ballManager.bigBallImg == null)
        {
            return;
        }

        RectTransform countdownRect = generator.autoSpinRemainingPlayText.rectTransform;
        RectTransform parentRect = countdownRect.parent as RectTransform;
        RectTransform bigBallRect = ballManager.bigBallImg.rectTransform;
        if (parentRect == null || bigBallRect == null)
        {
            return;
        }

        ConfigureCountdownText(generator.autoSpinRemainingPlayText);

        Vector3 worldBallCenter = bigBallRect.TransformPoint(bigBallRect.rect.center);
        Vector3 localBallCenter = parentRect.InverseTransformPoint(worldBallCenter);

        float parentWidth = Mathf.Abs(parentRect.rect.width);
        bool parentWidthChanged = !Mathf.Approximately(parentWidth, baseParentWidth);

        if (!isLayoutInitialized || parentWidthChanged)
        {
            countdownRect.anchorMin = new Vector2(0.5f, 0.5f);
            countdownRect.anchorMax = new Vector2(0.5f, 0.5f);
            countdownRect.pivot = new Vector2(0.5f, 0.5f);

            float initialWidth = countdownRect.rect.width;
            if (initialWidth <= 0f)
            {
                initialWidth = countdownRect.sizeDelta.x;
            }

            float parentDrivenWidth = parentWidth * Mathf.Max(0f, minParentWidthRatio);
            baseWidth = Mathf.Max(Mathf.Max(120f, minWidth), Mathf.Max(parentDrivenWidth, initialWidth));
            baseParentWidth = parentWidth;
            isLayoutInitialized = true;
        }

        float targetWidth = Mathf.Max(Mathf.Max(120f, minWidth), baseWidth * Mathf.Max(0.5f, widthMultiplier));
        float desiredCenterX = localBallCenter.x + offset.x;
        float desiredCenterY = localBallCenter.y + offset.y;

        if (TryGetHorizontalSafeBounds(generator, parentRect, edgePadding, out float safeLeft, out float safeRight))
        {
            float safeWidth = Mathf.Max(120f, safeRight - safeLeft);
            targetWidth = Mathf.Min(targetWidth, safeWidth);

            float halfWidth = targetWidth * 0.5f;
            float minCenterX = safeLeft + halfWidth;
            float maxCenterX = safeRight - halfWidth;
            if (minCenterX <= maxCenterX)
            {
                desiredCenterX = Mathf.Clamp(desiredCenterX, minCenterX, maxCenterX);
            }
        }

        Vector2 size = countdownRect.sizeDelta;
        size.x = targetWidth;
        countdownRect.sizeDelta = size;
        countdownRect.anchoredPosition = new Vector2(desiredCenterX, desiredCenterY);
    }

    private static void ConfigureCountdownText(TextMeshProUGUI countdownText)
    {
        countdownText.alignment = TextAlignmentOptions.Center;
        countdownText.enableWordWrapping = false;
        countdownText.enableAutoSizing = true;
        countdownText.fontSizeMin = 20f;
        countdownText.overflowMode = TextOverflowModes.Overflow;
    }

    private static bool TryGetHorizontalSafeBounds(
        NumberGenerator generator,
        RectTransform parentRect,
        float edgePadding,
        out float safeLeft,
        out float safeRight)
    {
        safeLeft = float.NegativeInfinity;
        safeRight = float.PositiveInfinity;

        if (generator.cardClasses == null || generator.cardClasses.Length == 0)
        {
            return false;
        }

        bool hasLeftCluster = false;
        bool hasRightCluster = false;
        float leftClusterRightEdge = float.NegativeInfinity;
        float rightClusterLeftEdge = float.PositiveInfinity;

        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null || card.num_text == null || card.num_text.Count == 0)
            {
                continue;
            }

            bool hasCardBounds = false;
            float cardLeft = float.PositiveInfinity;
            float cardRight = float.NegativeInfinity;

            for (int textIndex = 0; textIndex < card.num_text.Count; textIndex++)
            {
                TextMeshProUGUI numberText = card.num_text[textIndex];
                if (numberText == null)
                {
                    continue;
                }

                RectTransform numberRect = numberText.rectTransform;
                if (numberRect == null)
                {
                    continue;
                }

                Vector3[] corners = new Vector3[4];
                numberRect.GetWorldCorners(corners);
                for (int cornerIndex = 0; cornerIndex < corners.Length; cornerIndex++)
                {
                    Vector3 localCorner = parentRect.InverseTransformPoint(corners[cornerIndex]);
                    cardLeft = Mathf.Min(cardLeft, localCorner.x);
                    cardRight = Mathf.Max(cardRight, localCorner.x);
                    hasCardBounds = true;
                }
            }

            if (!hasCardBounds)
            {
                continue;
            }

            float cardCenterX = (cardLeft + cardRight) * 0.5f;
            if (cardCenterX < 0f)
            {
                hasLeftCluster = true;
                leftClusterRightEdge = Mathf.Max(leftClusterRightEdge, cardRight);
            }
            else if (cardCenterX > 0f)
            {
                hasRightCluster = true;
                rightClusterLeftEdge = Mathf.Min(rightClusterLeftEdge, cardLeft);
            }
        }

        if (!hasLeftCluster || !hasRightCluster)
        {
            return false;
        }

        float clampedPadding = Mathf.Max(0f, edgePadding);
        safeLeft = leftClusterRightEdge + clampedPadding;
        safeRight = rightClusterLeftEdge - clampedPadding;
        return safeRight > safeLeft;
    }
}
