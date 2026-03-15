using UnityEngine;

[DisallowMultipleComponent]
public sealed class Theme1LayoutController : MonoBehaviour
{
    private const float CompactWidthThreshold = 1024f;

    [SerializeField] private Theme1LayoutMode currentLayoutMode = Theme1LayoutMode.Desktop;

    private bool hasViewportOverride;
    private Vector2 viewportOverride;
    private Vector2 lastViewport = new Vector2(-1f, -1f);
    private bool targetsResolved;
    private Theme1ResponsiveLayoutTargets targets;

    public Theme1LayoutMode CurrentLayoutMode => currentLayoutMode;

    public void SetViewportOverride(Vector2 viewportPixels)
    {
        if (viewportPixels.x <= 0f || viewportPixels.y <= 0f)
        {
            ClearViewportOverride();
            return;
        }

        hasViewportOverride = true;
        viewportOverride = viewportPixels;
        RefreshLayout(force: true);
    }

    public void ClearViewportOverride()
    {
        hasViewportOverride = false;
        viewportOverride = Vector2.zero;
        RefreshLayout(force: true);
    }

    private void OnEnable()
    {
        RefreshLayout(force: true);
    }

    private void OnRectTransformDimensionsChange()
    {
        RefreshLayout(force: false);
    }

    private void RefreshLayout(bool force)
    {
        Vector2 viewport = ResolveViewport();
        if (viewport.x <= 0f || viewport.y <= 0f)
        {
            return;
        }

        Theme1LayoutMode nextMode = ResolveMode(viewport);
        if (!force &&
            nextMode == currentLayoutMode &&
            Approximately(lastViewport, viewport))
        {
            return;
        }

        lastViewport = viewport;
        currentLayoutMode = nextMode;

        if (!TryResolveTargets(out Theme1ResponsiveLayoutTargets resolvedTargets))
        {
            return;
        }

        if (currentLayoutMode == Theme1LayoutMode.Compact)
        {
            resolvedTargets.CaptureDesktopState();
            ApplyCompactLayout(resolvedTargets, viewport);
            return;
        }

        resolvedTargets.RestoreDesktopState();
    }

    private Vector2 ResolveViewport()
    {
        if (hasViewportOverride)
        {
            return viewportOverride;
        }

        if (Screen.width > 0 && Screen.height > 0)
        {
            return new Vector2(Screen.width, Screen.height);
        }

        RectTransform rectTransform = transform as RectTransform;
        return rectTransform != null ? rectTransform.rect.size : Vector2.zero;
    }

    private static Theme1LayoutMode ResolveMode(Vector2 viewport)
    {
        return viewport.x < CompactWidthThreshold
            ? Theme1LayoutMode.Compact
            : Theme1LayoutMode.Desktop;
    }

    private bool TryResolveTargets(out Theme1ResponsiveLayoutTargets resolvedTargets)
    {
        if (targetsResolved)
        {
            resolvedTargets = targets;
            return resolvedTargets.IsUsable;
        }

        targetsResolved = true;
        targets = Theme1ResponsiveLayoutTargets.Resolve(GetComponent<Theme1GameplayViewRoot>());
        targets.CaptureDesktopState();
        resolvedTargets = targets;
        return resolvedTargets.IsUsable;
    }

    private static bool Approximately(Vector2 left, Vector2 right)
    {
        return Mathf.Abs(left.x - right.x) < 0.5f &&
               Mathf.Abs(left.y - right.y) < 0.5f;
    }

    private static void ApplyCompactLayout(Theme1ResponsiveLayoutTargets targets, Vector2 viewport)
    {
        float widthT = Mathf.Clamp01((viewport.x - 430f) / 350f);
        float cardScale = Mathf.Lerp(0.205f, 0.29f, widthT);
        float cardColumnOffset = Mathf.Lerp(106f, 160f, widthT);
        float topRowY = Mathf.Lerp(118f, 154f, widthT);
        float bottomRowY = Mathf.Lerp(-78f, -116f, widthT);

        ApplyCardLayout(targets.Card1, -cardColumnOffset, topRowY, cardScale);
        ApplyCardLayout(targets.Card2, cardColumnOffset, topRowY, cardScale);
        ApplyCardLayout(targets.Card3, -cardColumnOffset, bottomRowY, cardScale);
        ApplyCardLayout(targets.Card4, cardColumnOffset, bottomRowY, cardScale);

        float smallPanelScale = Mathf.Lerp(0.36f, 0.5f, widthT);
        float stakePanelScale = Mathf.Lerp(0.3f, 0.42f, widthT);
        float shuffleScale = Mathf.Lerp(0.5f, 0.68f, widthT);
        float placeBetScale = Mathf.Lerp(0.42f, 0.58f, widthT);
        float bannerScale = Mathf.Lerp(0.58f, 0.74f, widthT);
        float bottomHudY = Mathf.Lerp(14f, 24f, widthT);
        float panelSpacing = Mathf.Lerp(82f, 112f, widthT);

        ApplyHudLayout(targets.SaldoPanel, -panelSpacing * 1.45f, bottomHudY, smallPanelScale);
        ApplyHudLayout(targets.WinningsPanel, -panelSpacing * 0.55f, bottomHudY, smallPanelScale);
        ApplyHudLayout(targets.StakePanel, panelSpacing * 0.55f, bottomHudY, stakePanelScale);
        ApplyHudLayout(targets.ShuffleButton, 0f, bottomHudY + 42f, shuffleScale);
        ApplyHudLayout(targets.PlaceBetButton, 0f, bottomHudY + 92f, placeBetScale);
        ApplyHudLayout(targets.NextDrawBanner, 0f, bottomHudY + 150f, bannerScale);
    }

    private static void ApplyCardLayout(RectTransform target, float anchoredX, float anchoredY, float uniformScale)
    {
        if (target == null)
        {
            return;
        }

        Vector2 centeredAnchor = new Vector2(0.5f, 0.5f);
        target.anchorMin = centeredAnchor;
        target.anchorMax = centeredAnchor;
        target.pivot = centeredAnchor;
        target.anchoredPosition = new Vector2(anchoredX, anchoredY);
        target.localScale = new Vector3(uniformScale, uniformScale, uniformScale);
    }

    private static void ApplyHudLayout(RectTransform target, float anchoredX, float anchoredY, float uniformScale)
    {
        if (target == null)
        {
            return;
        }

        target.anchoredPosition = new Vector2(anchoredX, anchoredY);
        target.localScale = new Vector3(uniformScale, uniformScale, uniformScale);
    }

    private sealed class Theme1ResponsiveLayoutTargets
    {
        public RectTransform Card1;
        public RectTransform Card2;
        public RectTransform Card3;
        public RectTransform Card4;
        public RectTransform SaldoPanel;
        public RectTransform WinningsPanel;
        public RectTransform ShuffleButton;
        public RectTransform StakePanel;
        public RectTransform PlaceBetButton;
        public RectTransform NextDrawBanner;

        private RectTransformSnapshot card1Snapshot;
        private RectTransformSnapshot card2Snapshot;
        private RectTransformSnapshot card3Snapshot;
        private RectTransformSnapshot card4Snapshot;
        private RectTransformSnapshot saldoPanelSnapshot;
        private RectTransformSnapshot winningsPanelSnapshot;
        private RectTransformSnapshot shuffleButtonSnapshot;
        private RectTransformSnapshot stakePanelSnapshot;
        private RectTransformSnapshot placeBetButtonSnapshot;
        private RectTransformSnapshot nextDrawBannerSnapshot;
        private bool desktopStateCaptured;

        public bool IsUsable =>
            Card1 != null &&
            Card2 != null &&
            Card3 != null &&
            Card4 != null &&
            SaldoPanel != null &&
            WinningsPanel != null &&
            ShuffleButton != null &&
            StakePanel != null &&
            PlaceBetButton != null &&
            NextDrawBanner != null;

        public static Theme1ResponsiveLayoutTargets Resolve(Theme1GameplayViewRoot root)
        {
            Theme1ResponsiveLayoutTargets resolved = new Theme1ResponsiveLayoutTargets();
            if (root != null)
            {
                Theme1CardGridView[] cards = root.Cards;
                resolved.Card1 = cards != null && cards.Length > 0 ? cards[0]?.RootRect : null;
                resolved.Card2 = cards != null && cards.Length > 1 ? cards[1]?.RootRect : null;
                resolved.Card3 = cards != null && cards.Length > 2 ? cards[2]?.RootRect : null;
                resolved.Card4 = cards != null && cards.Length > 3 ? cards[3]?.RootRect : null;

                Theme1HudControlsView hudControls = root.HudControls;
                resolved.SaldoPanel = hudControls?.SaldoPanel;
                resolved.WinningsPanel = hudControls?.WinningsPanel;
                resolved.ShuffleButton = hudControls?.ShuffleButtonRoot;
                resolved.StakePanel = hudControls?.StakePanel;
                resolved.PlaceBetButton = hudControls?.PlaceBetButtonRoot;
                resolved.NextDrawBanner = hudControls?.NextDrawBanner;
            }

            if (resolved.IsUsable)
            {
                return resolved;
            }

            if (Application.isPlaying)
            {
                return resolved;
            }

            RectTransform[] rects = Object.FindObjectsByType<RectTransform>(
                FindObjectsInactive.Include,
                FindObjectsSortMode.None);
            for (int i = 0; i < rects.Length; i++)
            {
                RectTransform rect = rects[i];
                if (rect == null)
                {
                    continue;
                }

                switch (rect.gameObject.name)
                {
                    case "Card_1":
                        resolved.Card1 = rect;
                        break;
                    case "Card_2":
                        resolved.Card2 = rect;
                        break;
                    case "Card_3":
                        resolved.Card3 = rect;
                        break;
                    case "Card_4":
                        resolved.Card4 = rect;
                        break;
                    case "Theme1SaldoPanel":
                        resolved.SaldoPanel = rect;
                        break;
                    case "Theme1GevinstPanel":
                        resolved.WinningsPanel = rect;
                        break;
                    case "Theme1ShuffleButton":
                        resolved.ShuffleButton = rect;
                        break;
                    case "Theme1StakePanel":
                        resolved.StakePanel = rect;
                        break;
                    case "Theme1PlaceBetButton":
                        resolved.PlaceBetButton = rect;
                        break;
                    case "Theme1NextDrawBanner":
                        resolved.NextDrawBanner = rect;
                        break;
                }
            }

            return resolved;
        }

        public void CaptureDesktopState()
        {
            if (desktopStateCaptured)
            {
                return;
            }

            card1Snapshot = RectTransformSnapshot.Capture(Card1);
            card2Snapshot = RectTransformSnapshot.Capture(Card2);
            card3Snapshot = RectTransformSnapshot.Capture(Card3);
            card4Snapshot = RectTransformSnapshot.Capture(Card4);
            saldoPanelSnapshot = RectTransformSnapshot.Capture(SaldoPanel);
            winningsPanelSnapshot = RectTransformSnapshot.Capture(WinningsPanel);
            shuffleButtonSnapshot = RectTransformSnapshot.Capture(ShuffleButton);
            stakePanelSnapshot = RectTransformSnapshot.Capture(StakePanel);
            placeBetButtonSnapshot = RectTransformSnapshot.Capture(PlaceBetButton);
            nextDrawBannerSnapshot = RectTransformSnapshot.Capture(NextDrawBanner);
            desktopStateCaptured = true;
        }

        public void RestoreDesktopState()
        {
            if (!desktopStateCaptured)
            {
                return;
            }

            card1Snapshot.Apply(Card1);
            card2Snapshot.Apply(Card2);
            card3Snapshot.Apply(Card3);
            card4Snapshot.Apply(Card4);
            saldoPanelSnapshot.Apply(SaldoPanel);
            winningsPanelSnapshot.Apply(WinningsPanel);
            shuffleButtonSnapshot.Apply(ShuffleButton);
            stakePanelSnapshot.Apply(StakePanel);
            placeBetButtonSnapshot.Apply(PlaceBetButton);
            nextDrawBannerSnapshot.Apply(NextDrawBanner);
        }
    }

    private struct RectTransformSnapshot
    {
        private readonly Vector2 anchorMin;
        private readonly Vector2 anchorMax;
        private readonly Vector2 pivot;
        private readonly Vector2 anchoredPosition;
        private readonly Vector3 localScale;

        private RectTransformSnapshot(
            Vector2 anchorMin,
            Vector2 anchorMax,
            Vector2 pivot,
            Vector2 anchoredPosition,
            Vector3 localScale)
        {
            this.anchorMin = anchorMin;
            this.anchorMax = anchorMax;
            this.pivot = pivot;
            this.anchoredPosition = anchoredPosition;
            this.localScale = localScale;
        }

        public static RectTransformSnapshot Capture(RectTransform target)
        {
            return target == null
                ? default
                : new RectTransformSnapshot(
                    target.anchorMin,
                    target.anchorMax,
                    target.pivot,
                    target.anchoredPosition,
                    target.localScale);
        }

        public void Apply(RectTransform target)
        {
            if (target == null)
            {
                return;
            }

            target.anchorMin = anchorMin;
            target.anchorMax = anchorMax;
            target.pivot = pivot;
            target.anchoredPosition = anchoredPosition;
            target.localScale = localScale;
        }
    }
}
