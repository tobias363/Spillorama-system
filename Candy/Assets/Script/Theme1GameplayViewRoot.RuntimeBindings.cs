using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public sealed partial class Theme1GameplayViewRoot
{
    private void Awake()
    {
        if (Application.isPlaying)
        {
            ApplyRuntimeBindingsFromScene();
        }
    }

    private void Start()
    {
        if (Application.isPlaying)
        {
            ApplyRuntimeBindingsFromScene();
        }
    }

    public void ApplyRuntimeBindingsFromScene()
    {
        NumberGenerator generator = runtimeNumberGenerator;
        GameManager gameManager = runtimeGameManager != null ? runtimeGameManager : GameManager.instance;
        APIManager apiManager = runtimeApiManager != null ? runtimeApiManager : APIManager.instance;
        UIManager uiManager = runtimeUiManager;

        if (!Application.isPlaying)
        {
            generator ??= Object.FindFirstObjectByType<NumberGenerator>(FindObjectsInactive.Include);
            gameManager ??= Object.FindFirstObjectByType<GameManager>(FindObjectsInactive.Include);
            apiManager ??= Object.FindFirstObjectByType<APIManager>(FindObjectsInactive.Include);
            uiManager ??= Object.FindFirstObjectByType<UIManager>(FindObjectsInactive.Include);
        }

        ApplyRuntimeBindings(generator, gameManager, apiManager, uiManager);
    }

    public void ApplyRuntimeBindings(
        NumberGenerator generator,
        GameManager gameManager,
        APIManager apiManager,
        UIManager uiManager)
    {
        ApplyCardBindings(generator, gameManager);
        ApplyHudBindings(gameManager, apiManager);
        ApplyControlBindings(uiManager);
    }

    private void ApplyCardBindings(NumberGenerator generator, GameManager gameManager)
    {
        if (generator?.cardClasses == null || cards == null)
        {
            return;
        }

        List<TextMeshProUGUI> resolvedCardBetLabels = new List<TextMeshProUGUI>(cards.Length);
        List<TextMeshProUGUI> resolvedCardWinLabels = new List<TextMeshProUGUI>(cards.Length);

        for (int cardIndex = 0; cardIndex < cards.Length && cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            Theme1CardGridView cardView = cards[cardIndex];
            CardClass card = generator.cardClasses[cardIndex] ??= new CardClass { cardNo = cardIndex };
            if (cardView == null)
            {
                resolvedCardBetLabels.Add(null);
                resolvedCardWinLabels.Add(null);
                continue;
            }

            card.num_text = CollectCardLabels(cardView, cell => cell?.PreferredRenderLabel);
            card.selectionImg = CollectCardObjects(cardView, cell => cell?.SelectionMarker);
            card.missingPatternImg = CollectCardObjects(cardView, cell => cell?.MissingOverlay);
            card.matchPatternImg = CollectCardObjects(cardView, cell => cell?.MatchedOverlay);
            card.paylineObj = new List<GameObject>(cardView.PaylineObjects ?? System.Array.Empty<GameObject>());
            card.win = cardView.WinLabel;

            EnsureFixedLength(ref card.payLinePattern, Theme1CardCellCount, (byte)0);
            EnsureFixedLength(ref card.paylineindex, Mathf.Max(0, card.paylineObj.Count), false);

            resolvedCardBetLabels.Add(cardView.BetLabel);
            resolvedCardWinLabels.Add(cardView.WinLabel);
        }

        if (gameManager != null)
        {
            gameManager.CardBets = resolvedCardBetLabels;
            gameManager.displayCardWinPoints = resolvedCardWinLabels;
        }
    }

    private void ApplyHudBindings(GameManager gameManager, APIManager apiManager)
    {
        if (hudBar == null)
        {
            return;
        }

        if (gameManager != null)
        {
            gameManager.displayTotalMoney = hudBar.CreditText;
            gameManager.displayCurrentBets = hudBar.BetText;
            gameManager.winAmtText = hudBar.WinningsText;
        }

        apiManager?.ApplyExplicitRealtimeHudBindings(hudBar.CountdownText, hudBar.RoomPlayerCountText);
    }

    private void ApplyControlBindings(UIManager uiManager)
    {
        if (uiManager == null || hudControls == null)
        {
            return;
        }

        if (hudControls.PlaceBetButton != null)
        {
            uiManager.playBtn = hudControls.PlaceBetButton;
        }

        if (hudControls.ShuffleButton != null)
        {
            uiManager.rerollTicketBtn = hudControls.ShuffleButton;
        }

        if (hudControls.BetUpButton != null)
        {
            uiManager.betUp = hudControls.BetUpButton;
        }

        if (hudControls.BetDownButton != null)
        {
            uiManager.betDown = hudControls.BetDownButton;
        }
    }

    private static List<TextMeshProUGUI> CollectCardLabels(
        Theme1CardGridView cardView,
        System.Func<Theme1CardCellView, TextMeshProUGUI> selector)
    {
        List<TextMeshProUGUI> values = new List<TextMeshProUGUI>(Theme1CardCellCount);
        if (cardView?.Cells == null)
        {
            return values;
        }

        for (int cellIndex = 0; cellIndex < cardView.Cells.Length; cellIndex++)
        {
            values.Add(selector(cardView.Cells[cellIndex]));
        }

        return values;
    }

    private static List<GameObject> CollectCardObjects(
        Theme1CardGridView cardView,
        System.Func<Theme1CardCellView, GameObject> selector)
    {
        List<GameObject> values = new List<GameObject>(Theme1CardCellCount);
        if (cardView?.Cells == null)
        {
            return values;
        }

        for (int cellIndex = 0; cellIndex < cardView.Cells.Length; cellIndex++)
        {
            values.Add(selector(cardView.Cells[cellIndex]));
        }

        return values;
    }

    private static void EnsureFixedLength<T>(ref List<T> list, int targetLength, T defaultValue)
    {
        list ??= new List<T>(targetLength);
        while (list.Count < targetLength)
        {
            list.Add(defaultValue);
        }

        while (list.Count > targetLength)
        {
            list.RemoveAt(list.Count - 1);
        }
    }
}
