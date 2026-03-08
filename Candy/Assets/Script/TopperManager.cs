using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class TopperManager : MonoBehaviour
{
    private readonly struct ActiveNearWinState
    {
        public readonly int PatternIndex;
        public readonly int HeaderSlotIndex;
        public readonly int ColIndex;
        public readonly int CardNo;
        public readonly int MissingNumber;
        public readonly int PayoutAmount;

        public ActiveNearWinState(
            int patternIndex,
            int headerSlotIndex,
            int colIndex,
            int cardNo,
            int missingNumber,
            int payoutAmount)
        {
            PatternIndex = patternIndex;
            HeaderSlotIndex = headerSlotIndex;
            ColIndex = colIndex;
            CardNo = cardNo;
            MissingNumber = missingNumber;
            PayoutAmount = payoutAmount;
        }
    }

    public List<GameObject> patterns;
    public List<GameObject> matchedPatterns;
    public List<GameObject> missedPattern;
    public List<TextMeshProUGUI> prizes;

    [Header("Missing Pattern Blink")]
    [SerializeField] private Color missingPatternBaseColor = new Color(1f, 0.56f, 0.12f, 0.92f);
    [SerializeField] private Color missingPatternBlinkColor = new Color(1f, 0.87f, 0.22f, 1f);
    [SerializeField] private Color missingPrizeBlinkColor = new Color(1f, 0.92f, 0.3f, 1f);
    [SerializeField] private float missingPatternBlinkInterval = 0.2f;
    [SerializeField] private bool useSolidMissingHighlight = true;
    [SerializeField] private bool showMissingNumberInPrizeLabel = true;
    [SerializeField] private string missingNumberLabelPrefix = "Mangler";
    [SerializeField] private bool showBonusLabelUnderConfiguredPattern = true;
    [SerializeField] [Min(1)] private int bonusPatternPositionFromRight = 2;
    [SerializeField] private string bonusPatternLabel = "BONUS";

    private readonly Dictionary<(int patternIndex, int colIndex, int cardNo), ActiveNearWinState> activeNearWins =
        new Dictionary<(int patternIndex, int colIndex, int cardNo), ActiveNearWinState>();
    private readonly HashSet<long> activeMatchedPatternIndexes = new HashSet<long>();
    private readonly Dictionary<GameObject, TextMeshProUGUI> missingCellLabelCache =
        new Dictionary<GameObject, TextMeshProUGUI>();
    private readonly List<Color> defaultPrizeColors = new List<Color>();
    private readonly List<string> defaultPrizeTexts = new List<string>();

    private Coroutine missingBlinkCoroutine;
    private Coroutine initialPrizeRefreshCoroutine;
    private bool missingBlinkVisible;
    private Sprite solidHighlightSprite;
    private TMP_FontAsset prizeFontOverride;

    private void OnEnable()
    {
        EventManager.OnPlay += Reset;
        EventManager.OnMatchedPattern += ShowMatchedPattern;
        EventManager.OnMissingPattern += ShowMissingPattern;
        CacheDefaultPrizeColors();
        CacheDefaultPrizeTexts();
        RefreshDefaultPrizeTextsFromRuntime(applyToPrizeLabels: false);
        ApplyPrizeTypography();
        RestartInitialPrizeRefresh();
    }

    private void OnDisable()
    {
        EventManager.OnPlay -= Reset;
        EventManager.OnMatchedPattern -= ShowMatchedPattern;
        EventManager.OnMissingPattern -= ShowMissingPattern;

        StopBlinkRoutine();
        StopInitialPrizeRefresh();
        activeNearWins.Clear();
        activeMatchedPatternIndexes.Clear();
        missingCellLabelCache.Clear();
        NumberGenerator.isPrizeMissedByOneCard = false;
    }

    private void Start()
    {
        ShowAllPatterns();
        PrepareMissingPatternVisuals();
        RefreshDefaultPrizeTextsFromRuntime(applyToPrizeLabels: true);
        ApplyPrizeTypography();
        Reset();
        RestartInitialPrizeRefresh();
    }

    private void RestartInitialPrizeRefresh()
    {
        StopInitialPrizeRefresh();
        initialPrizeRefreshCoroutine = StartCoroutine(RefreshPrizeTextsAfterBootstrap());
    }

    private void StopInitialPrizeRefresh()
    {
        if (initialPrizeRefreshCoroutine == null)
        {
            return;
        }

        StopCoroutine(initialPrizeRefreshCoroutine);
        initialPrizeRefreshCoroutine = null;
    }

    private IEnumerator RefreshPrizeTextsAfterBootstrap()
    {
        for (int pass = 0; pass < 6; pass++)
        {
            yield return null;
            RefreshDefaultPrizeTextsFromRuntime(applyToPrizeLabels: true);
            ApplyPrizeTypography();
        }

        initialPrizeRefreshCoroutine = null;
    }

    private void ShowAllPatterns()
    {
        for (int i = 0; i < patterns.Count; i++)
        {
            ShowPattern(i, true);
        }
    }

    private void ShowPattern(int index, bool active)
    {
        if (index < 0 || index >= patterns.Count)
        {
            return;
        }

        SetActiveIfChanged(patterns[index], active);
    }

    private void ShowMatchedPattern(int index, int cardNo, bool active)
    {
        if (index < 0 || index >= matchedPatterns.Count)
        {
            return;
        }

        long key = BuildMatchedPatternKey(index, cardNo);
        if (active)
        {
            activeMatchedPatternIndexes.Add(key);
        }
        else
        {
            activeMatchedPatternIndexes.Remove(key);
        }

        RefreshVisualState();
    }

    private void ShowMissingPattern(int patternIndex, int colIndex, bool active, int missingNumber, int cardNo)
    {
        int headerSlotIndex = GetPatternIndex(patternIndex);
        var key = (patternIndex, colIndex, cardNo);

        if (!active)
        {
            activeNearWins.Remove(key);
            RefreshVisualState();
            return;
        }

        int payoutAmount = ResolvePatternPayoutAmount(patternIndex);
        activeNearWins[key] = new ActiveNearWinState(
            patternIndex,
            headerSlotIndex,
            colIndex,
            cardNo,
            missingNumber,
            payoutAmount);

        RefreshVisualState();
    }

    private void RefreshVisualState()
    {
        ApplyMatchedPatternVisibility();

        if (activeNearWins.Count > 0)
        {
            if (missingBlinkCoroutine == null)
            {
                missingBlinkVisible = true;
                missingBlinkCoroutine = StartCoroutine(BlinkMissingPatterns());
            }
        }
        else
        {
            StopBlinkRoutine();
        }

        ApplyNearWinVisuals();
        NumberGenerator.isPrizeMissedByOneCard = activeNearWins.Count > 0;
    }

    private IEnumerator BlinkMissingPatterns()
    {
        WaitForSeconds wait = new WaitForSeconds(missingPatternBlinkInterval);

        while (activeNearWins.Count > 0)
        {
            yield return wait;
            missingBlinkVisible = !missingBlinkVisible;
            ApplyNearWinVisuals();
        }

        missingBlinkCoroutine = null;
        missingBlinkVisible = false;
        ApplyNearWinVisuals();
    }

    private void StopBlinkRoutine()
    {
        if (missingBlinkCoroutine != null)
        {
            StopCoroutine(missingBlinkCoroutine);
            missingBlinkCoroutine = null;
        }

        missingBlinkVisible = false;
    }

    private void ApplyMatchedPatternVisibility()
    {
        for (int i = 0; i < matchedPatterns.Count; i++)
        {
            SetActiveIfChanged(matchedPatterns[i], activeMatchedPatternIndexes.Contains(i));
        }
    }

    private void ApplyNearWinVisuals()
    {
        Dictionary<int, List<ActiveNearWinState>> headerNearWinsBySlot = BuildHeaderNearWinsBySlot();
        Dictionary<(int cardNo, int colIndex), ActiveNearWinState> cardNearWinsByCell = BuildCardNearWinsByCell();
        bool hasNearWinVisuals = activeNearWins.Count > 0;
        Color activeNearWinColor = ResolveMissingPatternPulseColor();

        HideAllHeaderMissingPatternVisuals();
        HideAllCardMissingPatternVisuals();

        if (hasNearWinVisuals)
        {
            foreach (KeyValuePair<int, List<ActiveNearWinState>> entry in headerNearWinsBySlot)
            {
                for (int i = 0; i < entry.Value.Count; i++)
                {
                    ActiveNearWinState state = entry.Value[i];
                    if (TryGetMissingCell(state.HeaderSlotIndex, state.ColIndex, out GameObject headerMissingCell))
                    {
                        ConfigureHeaderMissingCell(headerMissingCell, activeNearWinColor);
                        SetActiveIfChanged(headerMissingCell, true);
                    }
                }
            }

            foreach (KeyValuePair<(int cardNo, int colIndex), ActiveNearWinState> entry in cardNearWinsByCell)
            {
                GameObject cardMissingCell = ResolveCardMissingCell(entry.Value.CardNo, entry.Value.ColIndex);
                if (cardMissingCell == null)
                {
                    continue;
                }

                ConfigureCardMissingCell(cardMissingCell, entry.Value, activeNearWinColor);
                SetActiveIfChanged(cardMissingCell, true);
            }
        }

        ApplyPrizePresentation(headerNearWinsBySlot, hasNearWinVisuals && missingBlinkVisible);
    }

    private Dictionary<int, List<ActiveNearWinState>> BuildHeaderNearWinsBySlot()
    {
        Dictionary<int, List<ActiveNearWinState>> headerNearWinsBySlot = new Dictionary<int, List<ActiveNearWinState>>();
        foreach (ActiveNearWinState state in activeNearWins.Values)
        {
            if (state.HeaderSlotIndex < 0 || state.HeaderSlotIndex >= missedPattern.Count)
            {
                continue;
            }

            if (IsPatternMatchedOnCard(state.PatternIndex, state.CardNo))
            {
                continue;
            }

            if (!headerNearWinsBySlot.TryGetValue(state.HeaderSlotIndex, out List<ActiveNearWinState> slotStates))
            {
                slotStates = new List<ActiveNearWinState>();
                headerNearWinsBySlot[state.HeaderSlotIndex] = slotStates;
            }

            bool alreadyAdded = false;
            for (int i = 0; i < slotStates.Count; i++)
            {
                ActiveNearWinState existing = slotStates[i];
                if (existing.ColIndex == state.ColIndex && existing.CardNo == state.CardNo && existing.PatternIndex == state.PatternIndex)
                {
                    alreadyAdded = true;
                    break;
                }
            }

            if (!alreadyAdded)
            {
                slotStates.Add(state);
            }
        }

        return headerNearWinsBySlot;
    }

    private Dictionary<(int cardNo, int colIndex), ActiveNearWinState> BuildCardNearWinsByCell()
    {
        Dictionary<(int cardNo, int colIndex), ActiveNearWinState> cardNearWinsByCell =
            new Dictionary<(int cardNo, int colIndex), ActiveNearWinState>();

        foreach (ActiveNearWinState state in activeNearWins.Values)
        {
            if (state.CardNo < 0 || IsPatternMatchedOnCard(state.PatternIndex, state.CardNo))
            {
                continue;
            }

            var key = (state.CardNo, state.ColIndex);
            if (!cardNearWinsByCell.TryGetValue(key, out ActiveNearWinState currentState) ||
                IsBetterNearWinCandidate(state, currentState))
            {
                cardNearWinsByCell[key] = state;
            }
        }

        return cardNearWinsByCell;
    }

    private bool IsBetterNearWinCandidate(ActiveNearWinState candidate, ActiveNearWinState current)
    {
        if (candidate.PayoutAmount != current.PayoutAmount)
        {
            return candidate.PayoutAmount > current.PayoutAmount;
        }

        if (candidate.PatternIndex != current.PatternIndex)
        {
            return candidate.PatternIndex < current.PatternIndex;
        }

        if (candidate.CardNo != current.CardNo)
        {
            return candidate.CardNo < current.CardNo;
        }

        return candidate.ColIndex < current.ColIndex;
    }

    private bool HasMatchedPatternInSlot(int slotIndex)
    {
        foreach (long matchedPatternKey in activeMatchedPatternIndexes)
        {
            if (GetPatternIndex(ExtractPatternIndex(matchedPatternKey)) == slotIndex)
            {
                return true;
            }
        }

        return false;
    }

    private void HideAllHeaderMissingPatternVisuals()
    {
        for (int patternIndex = 0; patternIndex < missedPattern.Count; patternIndex++)
        {
            GameObject patternObject = missedPattern[patternIndex];
            if (patternObject == null)
            {
                continue;
            }

            foreach (Transform child in patternObject.transform)
            {
                SetActiveIfChanged(child.gameObject, false);
            }
        }
    }

    private void HideAllCardMissingPatternVisuals()
    {
        CardClass[] cards = GameManager.instance?.numberGenerator?.cardClasses;
        if (cards == null)
        {
            return;
        }

        for (int cardIndex = 0; cardIndex < cards.Length; cardIndex++)
        {
            CardClass card = cards[cardIndex];
            if (card == null || card.missingPatternImg == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < card.missingPatternImg.Count; cellIndex++)
            {
                GameObject missingCell = card.missingPatternImg[cellIndex];
                if (missingCell == null)
                {
                    continue;
                }

                SetActiveIfChanged(missingCell, false);
                Image missingCellImage = missingCell.GetComponent<Image>();
                if (missingCellImage != null)
                {
                    missingCellImage.color = missingPatternBaseColor;
                }

                TextMeshProUGUI label = ResolveMissingCellLabel(missingCell);
                if (label != null)
                {
                    label.text = string.Empty;
                }
            }
        }
    }

    private Color ResolveMissingPatternPulseColor()
    {
        if (!missingBlinkVisible)
        {
            return missingPatternBaseColor;
        }

        return missingPatternBlinkColor;
    }

    private void ConfigureHeaderMissingCell(GameObject headerMissingCell, Color color)
    {
        if (headerMissingCell == null)
        {
            return;
        }

        Image cellImage = headerMissingCell.GetComponent<Image>();
        if (cellImage != null)
        {
            cellImage.color = color;
        }
    }

    private void ApplyPrizePresentation(
        Dictionary<int, List<ActiveNearWinState>> headerNearWinsBySlot,
        bool showNearWinVisuals)
    {
        for (int slotIndex = 0; slotIndex < prizes.Count; slotIndex++)
        {
            TextMeshProUGUI prizeLabel = prizes[slotIndex];
            if (prizeLabel == null)
            {
                continue;
            }

            prizeLabel.text = GetDefaultPrizeText(slotIndex);

            if (showNearWinVisuals && headerNearWinsBySlot.ContainsKey(slotIndex))
            {
                prizeLabel.color = missingPrizeBlinkColor;
            }
            else if (HasMatchedPatternInSlot(slotIndex))
            {
                prizeLabel.color = Color.green;
            }
            else
            {
                prizeLabel.color = GetDefaultPrizeColor(slotIndex);
            }
        }
    }

    private bool IsPatternMatchedOnCard(int patternIndex, int cardNo)
    {
        return activeMatchedPatternIndexes.Contains(BuildMatchedPatternKey(patternIndex, cardNo));
    }

    private static long BuildMatchedPatternKey(int patternIndex, int cardNo)
    {
        return ((long)(cardNo + 1) << 32) | (uint)patternIndex;
    }

    private static int ExtractPatternIndex(long key)
    {
        return unchecked((int)(key & 0xFFFFFFFF));
    }

    private bool TryGetMissingCell(int patternIndex, int colIndex, out GameObject missingCell)
    {
        missingCell = null;

        if (patternIndex < 0 || patternIndex >= missedPattern.Count || missedPattern[patternIndex] == null)
        {
            return false;
        }

        Transform patternTransform = missedPattern[patternIndex].transform;
        if (colIndex < 0 || colIndex >= patternTransform.childCount)
        {
            return false;
        }

        missingCell = patternTransform.GetChild(colIndex).gameObject;
        return true;
    }

    private GameObject ResolveCardMissingCell(int cardNo, int colIndex)
    {
        if (cardNo < 0)
        {
            return null;
        }

        CardClass[] cards = GameManager.instance?.numberGenerator?.cardClasses;
        if (cards == null || cardNo >= cards.Length)
        {
            return null;
        }

        CardClass card = cards[cardNo];
        if (card == null || card.missingPatternImg == null || colIndex < 0 || colIndex >= card.missingPatternImg.Count)
        {
            return null;
        }

        return card.missingPatternImg[colIndex];
    }

    private void ConfigureCardMissingCell(GameObject cardMissingCell, ActiveNearWinState state, Color color)
    {
        if (cardMissingCell == null)
        {
            return;
        }

        Image cellImage = cardMissingCell.GetComponent<Image>();
        if (cellImage != null)
        {
            cellImage.color = color;
        }

        TextMeshProUGUI label = ResolveMissingCellLabel(cardMissingCell);
        if (label != null)
        {
            label.text = ResolveCardBadgeText(state);
        }
    }

    private string ResolveCardBadgeText(ActiveNearWinState state)
    {
        if (state.PayoutAmount > 0)
        {
            return state.PayoutAmount.ToString();
        }

        if (showMissingNumberInPrizeLabel && state.MissingNumber > 0)
        {
            return state.MissingNumber.ToString();
        }

        int slotIndex = GetPatternIndex(state.PatternIndex);
        return slotIndex >= 0 && slotIndex < prizes.Count && prizes[slotIndex] != null
            ? prizes[slotIndex].text
            : string.Empty;
    }

    private TextMeshProUGUI ResolveMissingCellLabel(GameObject missingCell)
    {
        if (missingCell == null)
        {
            return null;
        }

        if (missingCellLabelCache.TryGetValue(missingCell, out TextMeshProUGUI cachedLabel) &&
            cachedLabel != null)
        {
            return cachedLabel;
        }

        TextMeshProUGUI label = missingCell.GetComponentInChildren<TextMeshProUGUI>(true);
        missingCellLabelCache[missingCell] = label;
        return label;
    }

    private void PrepareMissingPatternVisuals()
    {
        Sprite highlightSprite = useSolidMissingHighlight ? GetSolidHighlightSprite() : null;

        for (int patternIndex = 0; patternIndex < missedPattern.Count; patternIndex++)
        {
            GameObject patternObject = missedPattern[patternIndex];
            if (patternObject == null)
            {
                continue;
            }

            foreach (Transform cell in patternObject.transform)
            {
                Image cellImage = cell.GetComponent<Image>();
                if (cellImage == null)
                {
                    continue;
                }

                if (highlightSprite != null)
                {
                    cellImage.sprite = highlightSprite;
                    cellImage.type = Image.Type.Simple;
                    cellImage.preserveAspect = false;
                }

                cellImage.color = missingPatternBlinkColor;
            }
        }
    }

    private Sprite GetSolidHighlightSprite()
    {
        if (solidHighlightSprite != null)
        {
            return solidHighlightSprite;
        }

        Texture2D baseTexture = Texture2D.whiteTexture;
        solidHighlightSprite = Sprite.Create(baseTexture, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f), 1f);
        return solidHighlightSprite;
    }

    private void CacheDefaultPrizeColors()
    {
        defaultPrizeColors.Clear();

        for (int i = 0; i < prizes.Count; i++)
        {
            defaultPrizeColors.Add(prizes[i] != null ? prizes[i].color : Color.white);
        }
    }

    private void CacheDefaultPrizeTexts()
    {
        defaultPrizeTexts.Clear();

        for (int i = 0; i < prizes.Count; i++)
        {
            defaultPrizeTexts.Add(prizes[i] != null ? prizes[i].text : string.Empty);
        }
    }

    private void RefreshDefaultPrizeTextsFromRuntime(bool applyToPrizeLabels)
    {
        if (defaultPrizeTexts.Count < prizes.Count)
        {
            while (defaultPrizeTexts.Count < prizes.Count)
            {
                defaultPrizeTexts.Add(string.Empty);
            }
        }

        for (int i = 0; i < prizes.Count; i++)
        {
            string resolvedText = string.Empty;
            if (TryResolveRuntimePrizeText(i, out string runtimePrizeText))
            {
                resolvedText = runtimePrizeText;
            }
            else if (prizes[i] != null)
            {
                resolvedText = prizes[i].text;
            }
            else if (i >= 0 && i < defaultPrizeTexts.Count)
            {
                resolvedText = defaultPrizeTexts[i];
            }

            if (i >= 0 && i < defaultPrizeTexts.Count)
            {
                defaultPrizeTexts[i] = resolvedText;
            }

            if (applyToPrizeLabels && prizes[i] != null)
            {
                prizes[i].text = resolvedText;
            }
        }
    }

    private static bool TryResolveRuntimePrizeText(int patternIndex, out string runtimePrizeText)
    {
        runtimePrizeText = string.Empty;

        GameManager gameManager = GameManager.instance;
        if (gameManager == null || !gameManager.TryGetFormattedPayoutLabel(patternIndex, out runtimePrizeText))
        {
            return false;
        }

        return !string.IsNullOrWhiteSpace(runtimePrizeText);
    }

    private int ResolvePatternPayoutAmount(int rawPatternIndex)
    {
        int payoutIndex = GetPatternIndex(rawPatternIndex);
        GameManager gameManager = GameManager.instance;
        if (gameManager != null && payoutIndex >= 0)
        {
            return gameManager.GetPayoutForPatternSlot(payoutIndex);
        }

        if (payoutIndex >= 0 && payoutIndex < prizes.Count && prizes[payoutIndex] != null &&
            TryExtractFirstInteger(GetDefaultPrizeText(payoutIndex), out int fallbackPayout))
        {
            return fallbackPayout;
        }

        return 0;
    }

    private Color GetDefaultPrizeColor(int index)
    {
        if (index >= 0 && index < defaultPrizeColors.Count)
        {
            return defaultPrizeColors[index];
        }

        return Color.white;
    }

    private string GetDefaultPrizeText(int index)
    {
        if (TryResolveRuntimePrizeText(index, out string runtimePrizeText))
        {
            return runtimePrizeText;
        }

        if (index >= 0 && index < defaultPrizeTexts.Count)
        {
            return defaultPrizeTexts[index];
        }

        return string.Empty;
    }

    private int ResolveBonusPatternIndexFromRight()
    {
        if (prizes == null || prizes.Count == 0)
        {
            return -1;
        }

        int offsetFromRight = Mathf.Max(1, bonusPatternPositionFromRight);
        int resolvedIndex = prizes.Count - offsetFromRight;
        return Mathf.Clamp(resolvedIndex, 0, prizes.Count - 1);
    }

    private void ApplyPrizeTypography()
    {
        for (int i = 0; i < prizes.Count; i++)
        {
            if (prizes[i] == null)
            {
                continue;
            }

            prizes[i].enableWordWrapping = false;
            prizes[i].enableAutoSizing = true;
            prizes[i].fontSizeMin = 12f;
            prizes[i].fontSizeMax = 24f;
            prizes[i].fontSize = 18f;
            prizes[i].alignment = TextAlignmentOptions.Center;
            prizes[i].overflowMode = TextOverflowModes.Overflow;
            RealtimeTextStyleUtils.ApplyGameplayTextPresentation(
                prizes[i],
                CandyTypographyRole.Label,
                GameplayTextSurface.TopperValue);
        }
    }

    public int GetPatternIndex(int index)
    {
        return GameManager.ResolvePayoutSlotIndex(index, Mathf.Max(0, prizes.Count));
    }

    private void Reset()
    {
        StopBlinkRoutine();
        activeNearWins.Clear();
        activeMatchedPatternIndexes.Clear();
        ShowAllPatterns();
        RefreshDefaultPrizeTextsFromRuntime(applyToPrizeLabels: true);
        HideAllHeaderMissingPatternVisuals();
        HideAllCardMissingPatternVisuals();
        ApplyMatchedPatternVisibility();

        for (int i = 0; i < prizes.Count; i++)
        {
            if (prizes[i] == null)
            {
                continue;
            }

            prizes[i].color = GetDefaultPrizeColor(i);
            prizes[i].text = GetDefaultPrizeText(i);
        }

        NumberGenerator.isPrizeMissedByOneCard = false;
    }

    private static bool TryExtractFirstInteger(string rawText, out int value)
    {
        value = 0;
        if (string.IsNullOrWhiteSpace(rawText))
        {
            return false;
        }

        int start = -1;
        int end = -1;
        for (int i = 0; i < rawText.Length; i++)
        {
            if (!char.IsDigit(rawText[i]))
            {
                if (start >= 0)
                {
                    end = i;
                    break;
                }

                continue;
            }

            if (start < 0)
            {
                start = i;
            }
        }

        if (start < 0)
        {
            return false;
        }

        if (end < 0)
        {
            end = rawText.Length;
        }

        string digits = rawText.Substring(start, end - start);
        return int.TryParse(digits, out value);
    }

    private TMP_FontAsset ResolvePrizeFontOverride()
    {
        if (prizeFontOverride != null)
        {
            return prizeFontOverride;
        }

        prizeFontOverride = CandyTypographySystem.GetFont(CandyTypographyRole.Label);
        if (prizeFontOverride == null)
        {
            prizeFontOverride = RealtimeTextStyleUtils.ResolveStableFallbackFont();
        }

        return prizeFontOverride;
    }

    private static void SetActiveIfChanged(GameObject target, bool active)
    {
        if (target != null && target.activeSelf != active)
        {
            target.SetActive(active);
        }
    }
}
