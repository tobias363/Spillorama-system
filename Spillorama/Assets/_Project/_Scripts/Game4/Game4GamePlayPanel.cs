using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public partial class Game4GamePlayPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public PrefabGame4ThemeButton themeBtn1;
    public PrefabGame4ThemeButton themeBtn2;
    public PrefabGame4ThemeButton themeBtn3;
    public PrefabGame4ThemeButton themeBtn4;
    public PrefabGame4ThemeButton themeBtn5;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTicketCount;
    [SerializeField] private TextMeshProUGUI txtBetValue;
    [SerializeField] private TextMeshProUGUI txtWonValue;

    [Header("Button")]
    [SerializeField] private Button btnDecreaseBet;
    [SerializeField] private Button btnIncreaseBet;
    [SerializeField] private Button btnPlay;
    [SerializeField] private Button btnTryOtherGame;
    [SerializeField] private Button btnTicketRefreshInScrollViewButton;
    [SerializeField] private Button btnTicketRefreshPhysicalButton;

    [Header("Toggle")]
    [SerializeField] private Toggle toggleAutoPlay;

    [Header("Game Object")]
    [SerializeField] private GameObject objectDetailPanel;

    [Header("Panels")]
    [SerializeField] private UtilityMessagePanel messagePopup;
    [SerializeField] private UtilityLoaderPanel loaderPanel;

    [Header("Images")]
    [SerializeField] private Image imgBallContainerPanel;
    [SerializeField] private Image imgTryOtherGamesPanel;
    [SerializeField] private Image imgTryOtherGameButton;
    [SerializeField] private Image imgSelectTicketHighlight;
    [SerializeField] private Image imgTotalTicketCounterPanel;
    [SerializeField] private Image imgBetPanel;
    [SerializeField] private Image imgWonPanel;
    [SerializeField] private Image imgBackground;
    [SerializeField] private Image imgTicketScrollBar;
    [SerializeField] private Image imgPatternScrollBar;

    [Header("Transform")]
    [SerializeField] private Transform transformPatternContainer;
    [SerializeField] private Transform transformTicketContainer;
    [SerializeField] private Transform transformWithdrawnBallContainer;
    [SerializeField] private Transform transformMiniGameContainer;

    [Header("RectTransform")]
    [SerializeField] private RectTransform rectTransformTicketScrollViewContainer;
    [SerializeField] private RectTransform rectTransformTicketContainer;
    [SerializeField] private RectTransform rectTransformWithdrawBallPanel;
    [SerializeField] private RectTransform rectTransformPatternContainerPanel;

    [Header("GridLayoutGroup")]
    [SerializeField] private GridLayoutGroup gridLayoutGroupTicketContainer;
    [SerializeField] private GridLayoutGroup gridLayoutGroupWithdrawBallContainer;


    [Header("Prefabs")]
    [SerializeField] private PrefabBingoGame4Ticket5x3 prefabBingoGame4Ticket5X3;
    [SerializeField] private PrefabBingoGame4Pattern prefabBingoGame4Pattern;
    [SerializeField] private PrefabBingoBallPanel prefabBingoBall;

    [Header("Theme")]
    [SerializeField] private Game4Theme theme;

    [Header("Mini Games")]
    public WheelOfFortunePanel wheelOfFortunePanel;
    public FortuneWheelManager fortuneWheelManager;
    public TreasureChestPanel treasureChestPanel;
    public MysteryGamePanel mysteryGamePanel;

    [Header("List")]
    [SerializeField] private List<Game4PatternSpriteData> patternSpriteDataList = new List<Game4PatternSpriteData>();

    [Header("Data")]
    [SerializeField] private Game4Data game4Data;

    private List<PrefabBingoGame4Ticket5x3> ticketList = new List<PrefabBingoGame4Ticket5x3>();
    [SerializeField] private List<PrefabBingoGame4Pattern> patternList = new List<PrefabBingoGame4Pattern>();
    private TicketMarkerCellData markerData;

    private int _ticketCount = 0;
    private int ticketPrice = 1;
    private int betMultiplierValue = 1;
    public int betMultiplierIndex = 0;
    private int _betValue = 0;
    public bool _isGamePlayInProcess = false;
    public bool _isBetUpdateAllowed = true;
    public bool _isPatternChangeAllowed = false;
    private bool _isTicketOptionEnable = false;
    private bool isDrewBallSetProgress = false;
    public bool isGameRunningStatus = false;
    [Header("Strings")]
    private string lastPurchaseType = "";
    private string lastVoucherCode = "";
    private string miniGameId = "";

    [Header("Game 4 Play Response")]
    private Game4PlayResponse game4PlayResponseActual;

    [Header("Drew Ball List")]
    public List<int> drewBallList = new List<int>();
    public Coroutine GameTimer;
    public int SampleWebViewInput;
    #endregion

    #region UNITY_CALLBACKS

    private void Awake()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
        transformMiniGameContainer.gameObject.SetActive(true);
        GameMarkerId = 6;

        for (int i = 0; i < transformTicketContainer.childCount; i++)
            Destroy(transformTicketContainer.GetChild(i).gameObject);
    }

    private void OnEnable()
    {
        Debug.Log("OnEnable Game4GamePlayPanel");
        UIManager.Instance.isGame4 = true;
        CloseMiniGames();
    }

    private void OnDisable()
    {
        SoundManager.Instance.StopNumberAnnouncement();
        UIManager.Instance.isGame4 = false;
        UIManager.Instance.isGame4Theme1 = false;
        UIManager.Instance.isGame4Theme2 = false;
        UIManager.Instance.isGame4Theme3 = false;
        UIManager.Instance.isGame4Theme4 = false;
        UIManager.Instance.isGame4Theme5 = false;
        CloseMiniGames();
        imgTryOtherGamesPanel.Close();
        UIManager.Instance.selectPurchaseTypePanel.Close();

        // Clear the drawn ball list
        drewBallList.Clear();
        Reset();
        btnDecreaseBet.Close();
        btnIncreaseBet.Close();
        btnPlay.interactable = false;
    }

    #endregion

    #region DELEGATE_CALLBACKS
    // (reserved for future delegate callbacks)
    #endregion

    #region PUBLIC_METHODS

    public void SetData(Game4Theme theme, Game4Data game4data = null, bool isGameRunning = false)
    {
        try
        {
            Debug.Log("SetData");
            this.theme = theme;
            this.Open();
            isGameRunningStatus = isGameRunning;
            btnDecreaseBet.gameObject.SetActive(!isGameRunningStatus);
            btnIncreaseBet.gameObject.SetActive(!isGameRunningStatus);
            if (isGameRunningStatus)
            {
                btnPlay.interactable = !isGameRunningStatus;
                IsTicketOptionEnable = false;
            }
            CallPlayerHallLimitEvent();
            // Reset();

            //pattern
            prefabBingoGame4Pattern.ApplyTheme(theme.patternThemeData.textColor,
                theme.patternThemeData.backgroundColor,
                theme.patternThemeData.normalCellColor,
                theme.patternThemeData.filledCellColor,
                theme.patternThemeData.extraText,
                theme.patternThemeData.extraOutline);

            //ticket
            prefabBingoGame4Ticket5X3.TicketTheme(theme.ticketThemeData);

            imgBallContainerPanel.sprite = theme.withdrawBallContainerThemeData.spriteBallContainer;

            imgBetPanel.sprite = theme.betPanelTheme.spriteBetPanel;
            imgWonPanel.sprite = theme.betPanelTheme.spriteBetPanel;
            imgTotalTicketCounterPanel.sprite = theme.betPanelTheme.spriteBTicketThumbnailIcon;

            if (imgTicketScrollBar)
                imgTicketScrollBar.color = theme.betPanelTheme.ticketThumbnailOutlineColor;
            if (imgPatternScrollBar)
                imgPatternScrollBar.color = theme.betPanelTheme.ticketThumbnailOutlineColor;

            btnPlay.GetComponent<Image>().sprite = theme.spritePlayButton;
            imgBackground.sprite = theme.spriteBackground;
            Debug.Log("IsGamePlayInProcess = > " + IsGamePlayInProcess);
            Debug.Log("isGameRunning = > " + isGameRunning);
            //if (game4data != null && !IsGamePlayInProcess)
            SaveGameDataResponse(game4data);
            if (UIManager.Instance.isBreak)
            {
                UIManager.Instance.breakTimePopup.OpenPanel("null");
            }

            Debug.Log("isGameRunning = " + isGameRunning);
            if (isGameRunning)
            {
                IsGamePlayInProcess = true;
                StartCoroutine(RunningGameSetData(game4data.response));
            }

        }
        catch (Exception e)
        {
            Debug.LogError("Error in SetData: " + e.Message + "\n" + e.StackTrace);
        }
    }

    #endregion

    #region PRIVATE_METHODS
    // (reserved for future private methods)
    #endregion

    #region COROUTINES
    // (reserved for future coroutines)
    #endregion

    #region GETTER_SETTER
    public int TicketCount
    {
        set
        {
            _ticketCount = value;
            txtTicketCount.text = value.ToString();

            if (!isGameRunningStatus)
            {
                btnPlay.interactable = _ticketCount > 0;
            }
            RefreshBetValue();
        }
        get
        {
            return _ticketCount;
        }
    }

    public int BetValue
    {
        set
        {
            _betValue = value;
            txtBetValue.text = value.ToString();
        }
        get
        {
            return _betValue;
        }
    }

    public long WonValue
    {
        set
        {
            if (value <= 0)
                txtWonValue.text = "";
            else
                txtWonValue.text = value.ToString();
        }
    }

    public int GameMarkerId
    {
        set
        {
            markerData = UIManager.Instance.GetMarkerData(value);
        }
    }

    public bool IsGamePlayInProcess
    {
        set
        {
            _isGamePlayInProcess = value;

            btnDecreaseBet.gameObject.SetActive(!value);
            btnIncreaseBet.gameObject.SetActive(!value);
            btnPlay.interactable = !value;
        }
        get
        {
            return _isGamePlayInProcess;
        }
    }

    public bool IsTicketOptionEnable
    {
        set
        {
            _isTicketOptionEnable = value;

            btnPlay.gameObject.SetActive(!value);

            foreach (PrefabBingoGame4Ticket5x3 ticket in ticketList)
                ticket.TicketPurchaseEnable(value);
        }
        get
        {
            return _isTicketOptionEnable;
        }
    }
    #endregion
}
