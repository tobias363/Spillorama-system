using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

[Serializable]
public sealed class Theme1CardCellView
{
    [SerializeField] private RectTransform cellRoot;
    [SerializeField] private TextMeshProUGUI numberLabel;
    [SerializeField] private GameObject selectionMarker;
    [SerializeField] private GameObject missingOverlay;
    [SerializeField] private GameObject matchedOverlay;

    public RectTransform CellRoot => cellRoot;
    public TextMeshProUGUI NumberLabel => numberLabel;
    public GameObject SelectionMarker => selectionMarker;
    public GameObject SelectionOverlay => selectionMarker;
    public GameObject MissingOverlay => missingOverlay;
    public GameObject MatchedOverlay => matchedOverlay;

    public void PullFrom(RectTransform root, TextMeshProUGUI label, GameObject selection, GameObject missing, GameObject matched)
    {
        cellRoot = root;
        numberLabel = label;
        selectionMarker = selection;
        missingOverlay = missing;
        matchedOverlay = matched;
    }
}

[Serializable]
public sealed class Theme1CardGridView
{
    [SerializeField] private TextMeshProUGUI headerLabel;
    [SerializeField] private TextMeshProUGUI betLabel;
    [SerializeField] private TextMeshProUGUI winLabel;
    [SerializeField] private Theme1CardCellView[] cells = new Theme1CardCellView[15];
    [SerializeField] private GameObject[] paylineObjects = Array.Empty<GameObject>();

    public TextMeshProUGUI HeaderLabel => headerLabel;
    public TextMeshProUGUI BetLabel => betLabel;
    public TextMeshProUGUI WinLabel => winLabel;
    public TextMeshProUGUI CardIndexLabel => headerLabel;
    public TextMeshProUGUI StakeLabel => betLabel;
    public TextMeshProUGUI CardWinLabel => winLabel;
    public Theme1CardCellView[] Cells => cells;
    public GameObject[] PaylineObjects => paylineObjects;

    public void PullFrom(CandyCardViewBinding binding, TextMeshProUGUI resolvedHeaderLabel, TextMeshProUGUI resolvedBetLabel, TextMeshProUGUI resolvedWinLabel)
    {
        headerLabel = resolvedHeaderLabel;
        betLabel = resolvedBetLabel;
        winLabel = resolvedWinLabel;

        int cellCount = 15;
        cells = new Theme1CardCellView[cellCount];
        for (int i = 0; i < cellCount; i++)
        {
            cells[i] = new Theme1CardCellView();
            TextMeshProUGUI numberLabel = binding != null && i < binding.NumberTexts.Count ? binding.NumberTexts[i] : null;
            cells[i].PullFrom(
                numberLabel != null ? numberLabel.transform.parent as RectTransform : null,
                numberLabel,
                binding != null && i < binding.SelectionOverlays.Count ? binding.SelectionOverlays[i] : null,
                binding != null && i < binding.MissingPatternOverlays.Count ? binding.MissingPatternOverlays[i] : null,
                binding != null && i < binding.MatchedPatternOverlays.Count ? binding.MatchedPatternOverlays[i] : null);
        }

        int paylineCount = binding != null && binding.PaylineObjects != null ? binding.PaylineObjects.Count : 0;
        paylineObjects = new GameObject[paylineCount];
        for (int i = 0; i < paylineCount; i++)
        {
            paylineObjects[i] = binding.PaylineObjects[i];
        }
    }
}

[Serializable]
public sealed class Theme1BallSlotView
{
    [SerializeField] private GameObject root;
    [SerializeField] private Image spriteTarget;
    [SerializeField] private TextMeshProUGUI numberLabel;

    public GameObject Root => root;
    public Image SpriteTarget => spriteTarget;
    public TextMeshProUGUI NumberLabel => numberLabel;

    public void PullFrom(CandyBallSlotBinding binding)
    {
        root = binding != null ? binding.Root : null;
        spriteTarget = binding != null ? binding.Image : null;
        numberLabel = binding != null ? binding.NumberText : null;
    }
}

[Serializable]
public sealed class Theme1BallRackView
{
    [SerializeField] private Theme1BallSlotView[] slots = new Theme1BallSlotView[30];
    [SerializeField] private Image bigBallImage;
    [SerializeField] private TextMeshProUGUI bigBallText;
    [SerializeField] private GameObject ballOutMachineAnimParent;
    [SerializeField] private GameObject ballMachine;
    [SerializeField] private GameObject extraBallMachine;

    public Theme1BallSlotView[] Slots => slots;
    public Image BigBallImage => bigBallImage;
    public TextMeshProUGUI BigBallText => bigBallText;
    public GameObject BallOutMachineAnimParent => ballOutMachineAnimParent;
    public GameObject BallMachine => ballMachine;
    public GameObject ExtraBallMachine => extraBallMachine;

    public void PullFrom(CandyBallViewBindingSet bindings)
    {
        int slotCount = bindings?.Slots != null ? bindings.Slots.Count : 0;
        slots = new Theme1BallSlotView[slotCount];
        for (int i = 0; i < slotCount; i++)
        {
            slots[i] = new Theme1BallSlotView();
            slots[i].PullFrom(bindings.Slots[i]);
        }

        bigBallImage = bindings?.BigBallImage;
        bigBallText = bindings?.BigBallText;
        ballOutMachineAnimParent = bindings?.BallOutMachineAnimParent;
        ballMachine = bindings?.BallMachine;
        extraBallMachine = bindings?.ExtraBallMachine;
    }
}

[Serializable]
public sealed class Theme1HudBarView
{
    [SerializeField] private TextMeshProUGUI countdownText;
    [SerializeField] private TextMeshProUGUI roomPlayerCountText;
    [SerializeField] private TextMeshProUGUI creditText;
    [SerializeField] private TextMeshProUGUI winningsText;
    [SerializeField] private TextMeshProUGUI betText;

    public TextMeshProUGUI CountdownText => countdownText;
    public TextMeshProUGUI RoomPlayerCountText => roomPlayerCountText;
    public TextMeshProUGUI CreditText => creditText;
    public TextMeshProUGUI WinningsText => winningsText;
    public TextMeshProUGUI BetText => betText;

    public void PullFrom(CandyTheme1HudBindingSet hudBindings)
    {
        countdownText = hudBindings != null ? hudBindings.CountdownText : null;
        roomPlayerCountText = hudBindings != null ? hudBindings.RoomPlayerCountText : null;
        creditText = hudBindings != null ? hudBindings.CreditText : null;
        winningsText = hudBindings != null ? hudBindings.WinningsText : null;
        betText = hudBindings != null ? hudBindings.BetText : null;
    }
}

[Serializable]
public sealed class Theme1TopperSlotView
{
    [SerializeField] private GameObject patternRoot;
    [SerializeField] private GameObject matchedPatternRoot;
    [SerializeField] private GameObject[] missingCells = Array.Empty<GameObject>();
    [SerializeField] private TextMeshProUGUI prizeLabel;
    [SerializeField] private Color defaultPrizeColor = Color.white;

    public GameObject PatternRoot => patternRoot;
    public GameObject MatchedPatternRoot => matchedPatternRoot;
    public GameObject[] MissingCells => missingCells;
    public TextMeshProUGUI PrizeLabel => prizeLabel;
    public Color DefaultPrizeColor => defaultPrizeColor;

    public void PullFrom(GameObject resolvedPatternRoot, GameObject resolvedMatchedPatternRoot, GameObject resolvedMissingPatternRoot, TextMeshProUGUI resolvedPrizeLabel)
    {
        patternRoot = resolvedPatternRoot;
        matchedPatternRoot = resolvedMatchedPatternRoot;
        prizeLabel = resolvedPrizeLabel;
        defaultPrizeColor = resolvedPrizeLabel != null ? resolvedPrizeLabel.color : Color.white;

        if (resolvedMissingPatternRoot == null)
        {
            missingCells = Array.Empty<GameObject>();
            return;
        }

        int childCount = resolvedMissingPatternRoot.transform.childCount;
        missingCells = new GameObject[childCount];
        for (int i = 0; i < childCount; i++)
        {
            Transform child = resolvedMissingPatternRoot.transform.GetChild(i);
            missingCells[i] = child != null ? child.gameObject : null;
        }
    }
}

[Serializable]
public sealed class Theme1TopperStripView
{
    [SerializeField] private Theme1TopperSlotView[] slots = Array.Empty<Theme1TopperSlotView>();

    public Theme1TopperSlotView[] Slots => slots;

    public void PullFrom(TopperManager topperManager)
    {
        int slotCount = topperManager != null && topperManager.prizes != null ? topperManager.prizes.Count : 0;
        slots = new Theme1TopperSlotView[slotCount];
        for (int i = 0; i < slotCount; i++)
        {
            slots[i] = new Theme1TopperSlotView();
            slots[i].PullFrom(
                topperManager != null && topperManager.patterns != null && i < topperManager.patterns.Count ? topperManager.patterns[i] : null,
                topperManager != null && topperManager.matchedPatterns != null && i < topperManager.matchedPatterns.Count ? topperManager.matchedPatterns[i] : null,
                topperManager != null && topperManager.missedPattern != null && i < topperManager.missedPattern.Count ? topperManager.missedPattern[i] : null,
                topperManager != null && topperManager.prizes != null && i < topperManager.prizes.Count ? topperManager.prizes[i] : null);
        }
    }
}

public sealed class Theme1GameplayViewRoot : MonoBehaviour
{
    private const int Theme1CardCellCount = 15;
    private const int Theme1VisibleCardCellCount = 15;
    [SerializeField] private Theme1CardGridView[] cards = new Theme1CardGridView[4];
    [SerializeField] private Theme1BallRackView ballRack = new Theme1BallRackView();
    [SerializeField] private Theme1HudBarView hudBar = new Theme1HudBarView();
    [SerializeField] private Theme1TopperStripView topperStrip = new Theme1TopperStripView();
    private bool presentationInitialized;

    public Theme1CardGridView[] Cards => cards;
    public Theme1BallRackView BallRack => ballRack;
    public Theme1HudBarView HudBar => hudBar;
    public Theme1TopperStripView TopperStrip => topperStrip;

    public void PullFrom(
        CandyCardViewBindingSet cardBindings,
        CandyBallViewBindingSet ballBindings,
        CandyTheme1HudBindingSet hudBindings,
        TopperManager topperManager)
    {
        cards = new Theme1CardGridView[cardBindings != null ? cardBindings.Cards.Count : 0];
        for (int i = 0; i < cards.Length; i++)
        {
            cards[i] = new Theme1CardGridView();
            cards[i].PullFrom(
                cardBindings.Cards[i],
                cardBindings.Cards[i].HeaderText,
                cardBindings.Cards[i].BetText,
                cardBindings.Cards[i].WinningText);
        }

        ballRack = new Theme1BallRackView();
        ballRack.PullFrom(ballBindings);

        hudBar = new Theme1HudBarView();
        hudBar.PullFrom(hudBindings);

        topperStrip = new Theme1TopperStripView();
        topperStrip.PullFrom(topperManager);
        presentationInitialized = false;
    }

    public void EnsurePresentationInitialized()
    {
        if (presentationInitialized)
        {
            return;
        }

        presentationInitialized = true;
        RegisterManagedTextTargets();
        ApplyTypography();
    }

    private void OnDisable()
    {
        Theme1ManagedTypographyRegistry.Clear();
    }

    public bool ValidateContract(out string report)
    {
        List<string> errors = new List<string>();
        bool isValid = true;
        if (cards == null || cards.Length != 4)
        {
            errors.Add($"Theme1GameplayViewRoot forventer 4 kort. Fikk {cards?.Length ?? 0}.");
            isValid = false;
        }

        if (cards != null)
        {
            for (int cardIndex = 0; cardIndex < cards.Length; cardIndex++)
            {
                Theme1CardGridView card = cards[cardIndex];
                if (card == null)
                {
                    errors.Add($"Card view {cardIndex} er null.");
                    isValid = false;
                    continue;
                }

                if (!ValidateText(card.HeaderLabel, $"cards[{cardIndex}].headerLabel", errors, requireActive: true))
                {
                    isValid = false;
                }

                if (!ValidateText(card.BetLabel, $"cards[{cardIndex}].betLabel", errors, requireActive: true))
                {
                    isValid = false;
                }

                if (!ValidateText(card.WinLabel, $"cards[{cardIndex}].winLabel", errors, requireActive: false))
                {
                    isValid = false;
                }

                if (card.Cells == null || card.Cells.Length != Theme1CardCellCount)
                {
                    errors.Add($"cards[{cardIndex}].cells har feil lengde. Fikk {card.Cells?.Length ?? 0}.");
                    isValid = false;
                }
                else
                {
                    for (int cellIndex = 0; cellIndex < card.Cells.Length; cellIndex++)
                    {
                        Theme1CardCellView cell = card.Cells[cellIndex];
                        if (cell == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}] er null.");
                            isValid = false;
                            continue;
                        }

                        bool requireVisibleCell = cellIndex < Theme1VisibleCardCellCount;
                        if (!ValidateText(cell.NumberLabel, $"cards[{cardIndex}].cells[{cellIndex}].numberLabel", errors, requireActive: requireVisibleCell))
                        {
                            isValid = false;
                        }

                        if (cell.CellRoot == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].cellRoot mangler.");
                            isValid = false;
                        }

                        if (!Theme1GameplayViewRepairUtils.IsDedicatedCardNumberLabel(cell.NumberLabel, cell.SelectionOverlay))
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].numberLabel peker ikke til lokal RealtimeCardNumberLabel.");
                            isValid = false;
                        }

                        if (cell.SelectionMarker == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].selectionMarker mangler.");
                            isValid = false;
                        }

                        if (cell.MissingOverlay == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].missingOverlay mangler.");
                            isValid = false;
                        }

                        if (cell.MatchedOverlay == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].matchedOverlay mangler.");
                            isValid = false;
                        }
                    }
                }
            }
        }

        if (ballRack == null)
        {
            errors.Add("ballRack mangler.");
            isValid = false;
        }
        else
        {
            if (ballRack.Slots == null || ballRack.Slots.Length != 30)
            {
                errors.Add($"ballRack.slots har feil lengde. Fikk {ballRack.Slots?.Length ?? 0}.");
                isValid = false;
            }
            else
            {
                for (int slotIndex = 0; slotIndex < ballRack.Slots.Length; slotIndex++)
                {
                    Theme1BallSlotView slot = ballRack.Slots[slotIndex];
                    if (slot == null)
                    {
                        errors.Add($"ballRack.slots[{slotIndex}] er null.");
                        isValid = false;
                        continue;
                    }

                    if (slot.Root == null)
                    {
                        errors.Add($"ballRack.slots[{slotIndex}].root mangler.");
                        isValid = false;
                    }

                    if (slot.SpriteTarget == null)
                    {
                        errors.Add($"ballRack.slots[{slotIndex}].spriteTarget mangler.");
                        isValid = false;
                    }
                }
            }

            if (ballRack.BigBallImage == null)
            {
                errors.Add("ballRack.bigBallImage mangler.");
                isValid = false;
            }
        }

        if (hudBar == null)
        {
            errors.Add("hudBar mangler.");
            isValid = false;
        }
        else
        {
            isValid &= ValidateText(hudBar.CountdownText, "hudBar.countdownText", errors, requireActive: true);
            isValid &= ValidateText(hudBar.RoomPlayerCountText, "hudBar.roomPlayerCountText", errors, requireActive: true);
            isValid &= ValidateText(hudBar.CreditText, "hudBar.creditText", errors, requireActive: true);
            isValid &= ValidateText(hudBar.WinningsText, "hudBar.winningsText", errors, requireActive: true);
            isValid &= ValidateText(hudBar.BetText, "hudBar.betText", errors, requireActive: true);
        }

        if (topperStrip == null || topperStrip.Slots == null || topperStrip.Slots.Length == 0)
        {
            errors.Add("topperStrip mangler slots.");
            isValid = false;
        }
        else
        {
            for (int slotIndex = 0; slotIndex < topperStrip.Slots.Length; slotIndex++)
            {
                Theme1TopperSlotView slot = topperStrip.Slots[slotIndex];
                if (slot == null)
                {
                    errors.Add($"topperStrip.slots[{slotIndex}] er null.");
                    isValid = false;
                    continue;
                }

                if (slot.PatternRoot == null)
                {
                    errors.Add($"topperStrip.slots[{slotIndex}].patternRoot mangler.");
                    isValid = false;
                }

                if (slot.MatchedPatternRoot == null)
                {
                    errors.Add($"topperStrip.slots[{slotIndex}].matchedPatternRoot mangler.");
                    isValid = false;
                }

                if (!ValidateText(slot.PrizeLabel, $"topperStrip.slots[{slotIndex}].prizeLabel", errors, requireActive: true))
                {
                    isValid = false;
                }
            }
        }

        report = string.Join(Environment.NewLine, errors);
        return isValid;
    }

    public Theme1RoundRenderState CaptureRenderedState()
    {
        Theme1RoundRenderState state = Theme1RoundRenderState.CreateEmpty(
            cards != null ? cards.Length : 0,
            ballRack?.Slots != null ? ballRack.Slots.Length : 0,
            topperStrip?.Slots != null ? topperStrip.Slots.Length : 0);

        for (int cardIndex = 0; cards != null && cardIndex < cards.Length; cardIndex++)
        {
            Theme1CardGridView card = cards[cardIndex];
            Theme1CardRenderState cardState = Theme1CardRenderState.CreateEmpty();
            cardState.HeaderLabel = ReadText(card?.HeaderLabel);
            cardState.BetLabel = ReadText(card?.BetLabel);
            cardState.WinLabel = ReadText(card?.WinLabel);
            cardState.ShowWinLabel = card?.WinLabel != null && card.WinLabel.gameObject.activeSelf;
            int paylineCount = card?.PaylineObjects != null ? card.PaylineObjects.Length : 0;
            cardState.PaylinesActive = new bool[paylineCount];
            for (int paylineIndex = 0; paylineIndex < paylineCount; paylineIndex++)
            {
                GameObject payline = card.PaylineObjects[paylineIndex];
                cardState.PaylinesActive[paylineIndex] = payline != null && payline.activeSelf;
            }

            for (int cellIndex = 0; card?.Cells != null && cellIndex < card.Cells.Length; cellIndex++)
            {
                Theme1CardCellView cell = card.Cells[cellIndex];
                cardState.Cells[cellIndex] = new Theme1CardCellRenderState(
                    ReadText(cell?.NumberLabel),
                    IsActive(cell?.SelectionOverlay),
                    IsActive(cell?.MissingOverlay),
                    IsActive(cell?.MatchedOverlay));
            }

            state.Cards[cardIndex] = cardState;
        }

        if (ballRack != null)
        {
            state.BallRack.ShowBigBall = ballRack.BigBallImage != null && ballRack.BigBallImage.gameObject.activeSelf;
            state.BallRack.BigBallNumber = ReadText(ballRack.BigBallText);
            state.BallRack.ShowBallMachine = IsActive(ballRack.BallMachine);
            state.BallRack.ShowExtraBallMachine = IsActive(ballRack.ExtraBallMachine);
            state.BallRack.ShowBallOutMachine = IsActive(ballRack.BallOutMachineAnimParent);
            for (int slotIndex = 0; ballRack.Slots != null && slotIndex < ballRack.Slots.Length; slotIndex++)
            {
                Theme1BallSlotView slot = ballRack.Slots[slotIndex];
                state.BallRack.Slots[slotIndex] = new Theme1BallSlotRenderState(
                    IsActive(slot?.Root),
                    ReadText(slot?.NumberLabel));
            }
        }

        if (hudBar != null)
        {
            state.Hud.CountdownLabel = ReadText(hudBar.CountdownText);
            state.Hud.PlayerCountLabel = ReadText(hudBar.RoomPlayerCountText);
            state.Hud.CreditLabel = ReadText(hudBar.CreditText);
            state.Hud.WinningsLabel = ReadText(hudBar.WinningsText);
            state.Hud.BetLabel = ReadText(hudBar.BetText);
        }

        for (int slotIndex = 0; topperStrip?.Slots != null && slotIndex < topperStrip.Slots.Length; slotIndex++)
        {
            Theme1TopperSlotView slot = topperStrip.Slots[slotIndex];
            Theme1TopperSlotRenderState slotState = new Theme1TopperSlotRenderState
            {
                PrizeLabel = ReadText(slot?.PrizeLabel),
                ShowPattern = IsActive(slot?.PatternRoot),
                ShowMatchedPattern = IsActive(slot?.MatchedPatternRoot),
                PrizeVisualState = ResolvePrizeVisualState(slot)
            };

            int missingCount = slot?.MissingCells != null ? slot.MissingCells.Length : 0;
            slotState.MissingCellsVisible = new bool[missingCount];
            for (int cellIndex = 0; cellIndex < missingCount; cellIndex++)
            {
                slotState.MissingCellsVisible[cellIndex] = IsActive(slot.MissingCells[cellIndex]);
            }

            state.Topper.Slots[slotIndex] = slotState;
        }

        return state;
    }

    private void ApplyTypography()
    {
        for (int cardIndex = 0; cards != null && cardIndex < cards.Length; cardIndex++)
        {
            Theme1CardGridView card = cards[cardIndex];
            RealtimeTextStyleUtils.ApplyHudText(card?.HeaderLabel, ReadText(card?.HeaderLabel), preferredColor: card?.HeaderLabel != null ? card.HeaderLabel.color : Color.white);
            RealtimeTextStyleUtils.ApplyHudText(card?.BetLabel, ReadText(card?.BetLabel), preferredColor: card?.BetLabel != null ? card.BetLabel.color : Color.white);
            RealtimeTextStyleUtils.ApplyHudText(card?.WinLabel, ReadText(card?.WinLabel), preferredColor: card?.WinLabel != null ? card.WinLabel.color : Color.white);

            for (int cellIndex = 0; card?.Cells != null && cellIndex < card.Cells.Length; cellIndex++)
            {
                RealtimeTextStyleUtils.ApplyCardNumber(
                    card.Cells[cellIndex]?.NumberLabel,
                    ReadText(card.Cells[cellIndex]?.NumberLabel));
            }
        }

        RealtimeTextStyleUtils.ApplyBallNumber(ballRack?.BigBallText, ReadText(ballRack?.BigBallText));
        for (int slotIndex = 0; ballRack?.Slots != null && slotIndex < ballRack.Slots.Length; slotIndex++)
        {
            RealtimeTextStyleUtils.ApplyBallNumber(
                ballRack.Slots[slotIndex]?.NumberLabel,
                ReadText(ballRack.Slots[slotIndex]?.NumberLabel));
        }

        RealtimeTextStyleUtils.ApplyHudText(hudBar?.CountdownText, ReadText(hudBar?.CountdownText), preferredColor: hudBar?.CountdownText != null ? hudBar.CountdownText.color : Color.white);
        RealtimeTextStyleUtils.ApplyHudText(hudBar?.RoomPlayerCountText, ReadText(hudBar?.RoomPlayerCountText), preferredColor: hudBar?.RoomPlayerCountText != null ? hudBar.RoomPlayerCountText.color : Color.white);
        RealtimeTextStyleUtils.ApplyHudText(hudBar?.CreditText, ReadText(hudBar?.CreditText), preferredColor: hudBar?.CreditText != null ? hudBar.CreditText.color : Color.white);
        RealtimeTextStyleUtils.ApplyHudText(hudBar?.WinningsText, ReadText(hudBar?.WinningsText), preferredColor: hudBar?.WinningsText != null ? hudBar.WinningsText.color : Color.white);
        RealtimeTextStyleUtils.ApplyHudText(hudBar?.BetText, ReadText(hudBar?.BetText), preferredColor: hudBar?.BetText != null ? hudBar.BetText.color : Color.white);

        for (int slotIndex = 0; topperStrip?.Slots != null && slotIndex < topperStrip.Slots.Length; slotIndex++)
        {
            Theme1TopperSlotView slot = topperStrip.Slots[slotIndex];
            RealtimeTextStyleUtils.ApplyHudText(
                slot?.PrizeLabel,
                ReadText(slot?.PrizeLabel),
                preferredColor: slot != null ? slot.DefaultPrizeColor : Color.white);
        }
    }

    private void RegisterManagedTextTargets()
    {
        Theme1ManagedTypographyRegistry.Clear();

        for (int cardIndex = 0; cards != null && cardIndex < cards.Length; cardIndex++)
        {
            Theme1CardGridView card = cards[cardIndex];
            Theme1ManagedTypographyRegistry.Register(card?.HeaderLabel);
            Theme1ManagedTypographyRegistry.Register(card?.BetLabel);
            Theme1ManagedTypographyRegistry.Register(card?.WinLabel);
            for (int cellIndex = 0; card?.Cells != null && cellIndex < card.Cells.Length; cellIndex++)
            {
                Theme1ManagedTypographyRegistry.Register(card.Cells[cellIndex]?.NumberLabel);
            }
        }

        Theme1ManagedTypographyRegistry.Register(ballRack?.BigBallText);
        for (int slotIndex = 0; ballRack?.Slots != null && slotIndex < ballRack.Slots.Length; slotIndex++)
        {
            Theme1ManagedTypographyRegistry.Register(ballRack.Slots[slotIndex]?.NumberLabel);
        }

        Theme1ManagedTypographyRegistry.Register(hudBar?.CountdownText);
        Theme1ManagedTypographyRegistry.Register(hudBar?.RoomPlayerCountText);
        Theme1ManagedTypographyRegistry.Register(hudBar?.CreditText);
        Theme1ManagedTypographyRegistry.Register(hudBar?.WinningsText);
        Theme1ManagedTypographyRegistry.Register(hudBar?.BetText);

        for (int slotIndex = 0; topperStrip?.Slots != null && slotIndex < topperStrip.Slots.Length; slotIndex++)
        {
            Theme1ManagedTypographyRegistry.Register(topperStrip.Slots[slotIndex]?.PrizeLabel);
        }
    }

    private static bool ValidateText(TextMeshProUGUI target, string label, List<string> errors, bool requireActive)
    {
        return CandyCardViewBindingValidator.ValidateTextTarget(target, label, requireActive, errors);
    }

    private static string ReadText(TMP_Text target)
    {
        return target != null ? (target.text ?? string.Empty) : string.Empty;
    }

    private static bool IsActive(GameObject target)
    {
        return target != null && target.activeSelf;
    }

    private static Theme1PrizeVisualState ResolvePrizeVisualState(Theme1TopperSlotView slot)
    {
        if (slot == null || slot.PrizeLabel == null)
        {
            return Theme1PrizeVisualState.Normal;
        }

        if (slot.PrizeLabel.color == Color.green)
        {
            return Theme1PrizeVisualState.Matched;
        }

        return slot.PrizeLabel.color == slot.DefaultPrizeColor
            ? Theme1PrizeVisualState.Normal
            : Theme1PrizeVisualState.NearWin;
    }
}
