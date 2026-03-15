using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
public class UIManager : MonoBehaviour
{
    public static event Action ControlStateChanged;

    public Button playBtn;
    public Button autoPlayBtn;
    
    public Button betUp;
    public Button betDown;
    public Button rerollTicketBtn;

    public Button settingsBtn;
    public GameObject settingsPanel;
    public List<Button> settingsOption;
    public List<Button> autoSpinOptions;
    public List<GameObject> autoSpinBtnHighlighter;

    public List<Sprite> optionSelection;
    public List<Sprite> optionDeSelection;

    public int autoSpinCount = 5;

    private readonly List<Button> realtimeSingleCardRerollButtons = new();
    private bool hasLoggedMissingRealtimeRerollButton;
    private Theme1GameplayViewRoot cachedTheme1ViewRoot;

    private static void NotifyControlStateChanged()
    {
        ControlStateChanged?.Invoke();
    }

    private bool IsRealtimeMode()
    {
        return APIManager.instance != null && APIManager.instance.UseRealtimeBackend;
    }

    private bool HasPlayableConfiguredBet()
    {
        return GameManager.instance == null || GameManager.instance.CanPlayCurrentBet();
    }

    private void RefreshLegacyPlayControlsState()
    {
        if (IsRealtimeMode())
        {
            return;
        }

        bool canPlay = HasPlayableConfiguredBet();
        if (playBtn != null && EventManager.isPlayOver)
        {
            playBtn.interactable = canPlay;
        }

        if (autoPlayBtn != null)
        {
            autoPlayBtn.interactable = canPlay && !IsProductionAutoPlayBlocked();
        }
    }

    private void ApplyPlayButtonLabel()
    {
        if (playBtn == null)
        {
            return;
        }

        TMP_Text label = playBtn.GetComponentInChildren<TMP_Text>(true);
        if (label == null)
        {
            return;
        }

        label.text = IsRealtimeMode() ? "Plasser innsats" : "Play";
    }

    private void ApplyAutoPlayButtonLabel()
    {
        if (autoPlayBtn == null)
        {
            return;
        }

        TMP_Text label = autoPlayBtn.GetComponentInChildren<TMP_Text>(true);
        if (label == null)
        {
            return;
        }

        if (IsRealtimeMode())
        {
            label.text = "Start nå";
        }
    }

    private bool IsProductionAutoPlayBlocked()
    {
        return !Application.isEditor && !Debug.isDebugBuild;
    }

    private void EnsurePlayButtonVisible()
    {
        if (playBtn == null)
        {
            return;
        }

        if (!playBtn.gameObject.activeSelf)
        {
            playBtn.gameObject.SetActive(true);
        }
    }

    private void EnsureRealtimeStartNowButtonVisible()
    {
        if (autoPlayBtn == null)
        {
            return;
        }

        if (!autoPlayBtn.gameObject.activeSelf)
        {
            autoPlayBtn.gameObject.SetActive(true);
        }

        autoPlayBtn.interactable = true;
    }

    private static bool IsValidIndex<T>(List<T> list, int index)
    {
        return list != null && index >= 0 && index < list.Count;
    }

    private void ResetAutoSpinHighlights()
    {
        if (autoSpinBtnHighlighter == null)
        {
            return;
        }

        for (int i = 0; i < autoSpinBtnHighlighter.Count; i++)
        {
            if (autoSpinBtnHighlighter[i] != null)
            {
                autoSpinBtnHighlighter[i].SetActive(false);
            }
        }
    }

    private void OnEnable()
    {
        EventManager.OnAutoSpinOver += ActiveAllButtons;
        GameManager.GameplayControlsStateChanged += HandleControlsStateChanged;
        APIManager.RealtimeControlsStateChanged += HandleControlsStateChanged;
        TryResolveTheme1HudControls();
        EnsurePlayButtonVisible();
        if (settingsPanel != null)
        {
            settingsPanel.SetActive(false);
        }

        if (IsValidIndex(settingsOption, 0) &&
            IsValidIndex(optionSelection, 0) &&
            IsValidIndex(optionDeSelection, 0))
        {
            SelectSettingsOption(0);
        }

        ApplyPlayButtonLabel();
        ApplyAutoPlayButtonLabel();
        ResetAutoSpinHighlights();
        RefreshControlState();
    }

    private void OnDisable()
    {
        EventManager.OnAutoSpinOver -= ActiveAllButtons;
        GameManager.GameplayControlsStateChanged -= HandleControlsStateChanged;
        APIManager.RealtimeControlsStateChanged -= HandleControlsStateChanged;
        if (rerollTicketBtn != null)
        {
            rerollTicketBtn.onClick.RemoveListener(OnRealtimeRerollClicked);
        }

        for (int i = 0; i < realtimeSingleCardRerollButtons.Count; i++)
        {
            if (realtimeSingleCardRerollButtons[i] != null)
            {
                realtimeSingleCardRerollButtons[i].onClick.RemoveAllListeners();
            }
        }
    }

    private void OnRectTransformDimensionsChange()
    {
        RefreshControlState();
    }

    private void HandleControlsStateChanged()
    {
        RefreshControlState();
    }

    private void RefreshControlState()
    {
        TryResolveTheme1HudControls();
        EnsureRealtimeRerollButton();
        EnsureRealtimeSingleCardRerollButtons();
        RefreshRealtimeRerollButtonState();
        RefreshRealtimeSingleCardRerollButtonsState();
        RefreshRealtimeBetControlsState();
        RefreshLegacyPlayControlsState();

        if (IsRealtimeMode())
        {
            EnsureRealtimeStartNowButtonVisible();
        }

        NotifyControlStateChanged();
    }

    private void TryResolveTheme1HudControls()
    {
        Theme1GameplayViewRoot viewRoot = ResolveTheme1ViewRoot();
        Theme1HudControlsView hudControls = viewRoot != null ? viewRoot.HudControls : null;
        if (hudControls == null)
        {
            return;
        }

        playBtn = playBtn != null ? playBtn : hudControls.PlaceBetButton;
        rerollTicketBtn = rerollTicketBtn != null ? rerollTicketBtn : hudControls.ShuffleButton;
        betUp = betUp != null ? betUp : hudControls.BetUpButton;
        betDown = betDown != null ? betDown : hudControls.BetDownButton;
    }

    private void EnsureRealtimeRerollButton()
    {
        if (!IsRealtimeMode())
        {
            if (rerollTicketBtn != null)
            {
                rerollTicketBtn.gameObject.SetActive(false);
            }
            return;
        }

        TryResolveTheme1HudControls();
        if (rerollTicketBtn == null)
        {
            if (!hasLoggedMissingRealtimeRerollButton)
            {
                Debug.LogWarning("[UIManager] Theme1 realtime reroll-knapp mangler i scenen. Hopper over fallback-oppretting.");
                hasLoggedMissingRealtimeRerollButton = true;
            }

            return;
        }

        if (rerollTicketBtn != null)
        {
            rerollTicketBtn.gameObject.SetActive(true);
            rerollTicketBtn.onClick.RemoveListener(OnRealtimeRerollClicked);
            rerollTicketBtn.onClick.AddListener(OnRealtimeRerollClicked);
        }
    }

    private void RefreshRealtimeRerollButtonState()
    {
        if (rerollTicketBtn == null)
        {
            return;
        }

        APIManager apiManager = APIManager.instance;
        bool shouldShow = IsRealtimeMode() && apiManager != null && apiManager.IsRealtimeRerollWindowOpen;
        if (rerollTicketBtn.gameObject.activeSelf != shouldShow)
        {
            rerollTicketBtn.gameObject.SetActive(shouldShow);
        }

        if (!shouldShow)
        {
            return;
        }

        rerollTicketBtn.interactable = apiManager != null && apiManager.CanRequestRealtimeTicketReroll();
    }

    private void OnRealtimeRerollClicked()
    {
        if (!IsRealtimeMode())
        {
            return;
        }

        APIManager.instance?.RequestRealtimeTicketReroll();
        RefreshRealtimeRerollButtonState();
    }

    private void EnsureRealtimeSingleCardRerollButtons()
    {
        if (!IsRealtimeMode() || Application.isBatchMode)
        {
            SetRealtimeSingleCardRerollButtonsVisible(false);
            return;
        }

        APIManager apiManager = APIManager.instance;
        Theme1GameplayViewRoot viewRoot = ResolveTheme1ViewRoot();
        Theme1CardGridView[] cards = viewRoot?.Cards;
        if (apiManager == null || cards == null || cards.Length == 0)
        {
            return;
        }

        realtimeSingleCardRerollButtons.Clear();

        for (int cardIndex = 0; cardIndex < cards.Length; cardIndex++)
        {
            Button button = cards[cardIndex]?.SingleCardRerollButton;
            realtimeSingleCardRerollButtons.Add(button);
            if (button == null)
            {
                continue;
            }

            button.onClick.RemoveAllListeners();
            int capturedIndex = cardIndex;
            button.onClick.AddListener(() => OnRealtimeSingleCardRerollClicked(capturedIndex));
        }
    }

    private void RefreshRealtimeSingleCardRerollButtonsState()
    {
        EnsureRealtimeSingleCardRerollButtons();

        APIManager apiManager = APIManager.instance;
        bool shouldShow = IsRealtimeMode() && apiManager != null && apiManager.IsRealtimeRerollWindowOpen;
        int visibleCardCount = apiManager != null ? apiManager.GetRealtimeVisibleCardCount() : 0;
        for (int i = 0; i < realtimeSingleCardRerollButtons.Count; i++)
        {
            Button button = realtimeSingleCardRerollButtons[i];
            if (button == null)
            {
                continue;
            }

            bool showThisButton = shouldShow && i < visibleCardCount;
            if (button.gameObject.activeSelf != showThisButton)
            {
                button.gameObject.SetActive(showThisButton);
            }

            if (showThisButton)
            {
                button.interactable = apiManager.CanRequestRealtimeTicketRerollForVisibleCard(i);
            }
        }
    }

    private void SetRealtimeSingleCardRerollButtonsVisible(bool visible)
    {
        for (int i = 0; i < realtimeSingleCardRerollButtons.Count; i++)
        {
            if (realtimeSingleCardRerollButtons[i] != null)
            {
                realtimeSingleCardRerollButtons[i].gameObject.SetActive(visible);
            }
        }
    }

    private Theme1GameplayViewRoot ResolveTheme1ViewRoot()
    {
        if (cachedTheme1ViewRoot != null)
        {
            return cachedTheme1ViewRoot;
        }

        cachedTheme1ViewRoot = APIManager.instance != null
            ? APIManager.instance.Theme1GameplayViewRootRef
            : null;
        if (cachedTheme1ViewRoot == null)
        {
            cachedTheme1ViewRoot = FindObjectOfType<Theme1GameplayViewRoot>();
        }

        return cachedTheme1ViewRoot;
    }

    private void OnRealtimeSingleCardRerollClicked(int visibleCardIndex)
    {
        if (!IsRealtimeMode())
        {
            return;
        }

        APIManager.instance?.RequestRealtimeTicketRerollForVisibleCard(visibleCardIndex);
        RefreshRealtimeSingleCardRerollButtonsState();
    }

    private void RefreshRealtimeBetControlsState()
    {
        if (!IsRealtimeMode())
        {
            return;
        }

        EnsurePlayButtonVisible();
        EnsureRealtimeStartNowButtonVisible();
        ApplyPlayButtonLabel();
        ApplyAutoPlayButtonLabel();

        APIManager apiManager = APIManager.instance;
        bool canEditPreRoundSelection = apiManager == null || apiManager.CanEditRealtimePreRoundSelection;
        bool hasPlayableBet = HasPlayableConfiguredBet();
        GameManager gameManager = GameManager.instance;
        bool canIncreaseBet = gameManager == null || gameManager.betlevel < gameManager.totalBets.Count - 1;
        bool canDecreaseBet = gameManager == null || gameManager.betlevel > 0;

        if (betUp != null)
        {
            betUp.interactable = canEditPreRoundSelection && canIncreaseBet;
        }

        if (betDown != null)
        {
            betDown.interactable = canEditPreRoundSelection && canDecreaseBet;
        }

        if (playBtn != null)
        {
            playBtn.interactable = canEditPreRoundSelection && hasPlayableBet;
        }

        if (autoPlayBtn != null)
        {
            autoPlayBtn.interactable = canEditPreRoundSelection;
        }
    }

    public void Play()
    {
        if (!HasPlayableConfiguredBet())
        {
            RefreshLegacyPlayControlsState();
            return;
        }

        if (IsRealtimeMode())
        {
            if (playBtn != null)
            {
                playBtn.interactable = false;
            }

            APIManager.instance?.PlayRealtimeRound();
            Invoke(nameof(ActivePlayBtn), 0.5f);
            NotifyControlStateChanged();
            return;
        }

        if (playBtn != null)
        {
            playBtn.interactable = false;
        }

        NotifyControlStateChanged();

        if (EventManager.isPlayOver)
        {
            //Debug.Log("IsPlay Over : " + EventManager.isPlayOver);
            
            EventManager.AutoSpinStart(1);
            //ActiveAllButtons(false);  
        }
        else
        {
            
            EventManager.StartTimer();           
        }
        Invoke("ActivePlayBtn", 1);
        //EventManager.Play();
    }

    public void AutoSpin()
    {
        if (IsRealtimeMode())
        {
            StartNow();
            return;
        }

        if (!HasPlayableConfiguredBet())
        {
            RefreshLegacyPlayControlsState();
            return;
        }

        if (settingsPanel != null)
        {
            settingsPanel.SetActive(false);
        }

        if (IsValidIndex(settingsOption, 0) &&
            IsValidIndex(optionSelection, 0) &&
            IsValidIndex(optionDeSelection, 0))
        {
            SelectSettingsOption(0);
        }
    }

    public void StartAutoSpin()
    {
        if (IsProductionAutoPlayBlocked() && autoSpinCount > 1)
        {
            Debug.LogWarning("[UIManager] AutoSpin > 1 er deaktivert i production build.");
            return;
        }

        if (IsRealtimeMode())
        {
            APIManager.instance?.RequestRealtimeState();
            return;
        }

        if (!HasPlayableConfiguredBet())
        {
            RefreshLegacyPlayControlsState();
            return;
        }

        EventManager.isAutoSpinStart = true;
        EventManager.AutoSpinStart(autoSpinCount);
        Debug.Log(autoSpinCount);
        //ActiveAllButtons(false);
    }

    public void Settings()
    {
        if (settingsPanel != null)
        {
            settingsPanel.SetActive(true);
        }
    }

    public void StartNow()
    {
        if (!IsRealtimeMode())
        {
            return;
        }

        if (settingsPanel != null)
        {
            settingsPanel.SetActive(false);
        }

        APIManager.instance?.StartRealtimeRoundNow();
    }

    public void SelectSettingsOption(int index)
    {
        if (!IsValidIndex(settingsOption, index) ||
            !IsValidIndex(optionSelection, index) ||
            settingsOption[index] == null)
        {
            return;
        }

        Image selectedImage = settingsOption[index].GetComponent<Image>();
        if (selectedImage != null)
        {
            selectedImage.sprite = optionSelection[index];
        }

        for (int i = 0; i < settingsOption.Count; i++)
        {
            if (i != index &&
                IsValidIndex(optionDeSelection, i) &&
                settingsOption[i] != null)
            {
                Image image = settingsOption[i].GetComponent<Image>();
                if (image != null)
                {
                    image.sprite = optionDeSelection[i];
                }
            }
        }
    }

    public void ActivePlayBtn()
    {
        if (IsRealtimeMode())
        {
            RefreshRealtimeBetControlsState();
            NotifyControlStateChanged();
            return;
        }

        if (playBtn != null)
        {
            playBtn.interactable = true;
        }

        RefreshLegacyPlayControlsState();
        NotifyControlStateChanged();
    }

    public void AutoSpinOptionSelection(int index)
    {
        if (IsValidIndex(autoSpinBtnHighlighter, index) && autoSpinBtnHighlighter[index] != null)
        {
            autoSpinBtnHighlighter[index].SetActive(true);
            if (IsValidIndex(autoSpinOptions, index) && autoSpinOptions[index] != null)
            {
                Transform optionLabel = autoSpinOptions[index].transform.childCount > 0
                    ? autoSpinOptions[index].transform.GetChild(0)
                    : null;
                TextMeshProUGUI optionText = optionLabel != null ? optionLabel.GetComponent<TextMeshProUGUI>() : null;
                if (optionText != null && int.TryParse(optionText.text, out int parsedCount))
                {
                    autoSpinCount = parsedCount;
                }
            }
        }

        if (autoSpinOptions != null)
        {
            for (int i = 0; i < autoSpinOptions.Count; i++)
            {
                if (i != index && IsValidIndex(autoSpinBtnHighlighter, i) && autoSpinBtnHighlighter[i] != null)
                {
                    autoSpinBtnHighlighter[i].SetActive(false);
                }
            }
        }

        StartAutoSpin();
        if (settingsPanel != null)
        {
            Invoke(nameof(ClosePanel), 0.5f);
        }
    }

    public void ClosePanel()
    {
        if (settingsPanel != null)
        {
            settingsPanel.SetActive(false);
        }
    }


    public void ActiveAllButtons(bool isOver)
    {
        //playBtn.interactable = isOver;
        //autoPlayBtn.interactable = isOver;
        //settingsBtn.interactable = isOver;
        if (IsRealtimeMode())
        {
            RefreshRealtimeBetControlsState();
            NotifyControlStateChanged();
            return;
        }

        if (isOver)
        {
            GameManager.instance?.RefreshBetControls();
        }
        else
        {
            if (betUp != null)
            {
                betUp.interactable = false;
            }

            if (betDown != null)
            {
                betDown.interactable = false;
            }
        }

        if (rerollTicketBtn != null)
        {
            rerollTicketBtn.interactable = isOver;
        }

        RefreshLegacyPlayControlsState();
        NotifyControlStateChanged();
    }
    
}
