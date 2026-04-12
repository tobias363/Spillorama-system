using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using I2.Loc;
#if !UNITY_WEBGL
using I2.Loc;
#endif
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public partial class Game2GamePlayPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    [Header("Panels")]
    public ChangeMarkerBackgroundPanel changeMarkerBackgroundPanel;
    public PrefabGame2UpcomingGames prefabGame2UpcomingGames;

    public delegate void ticketNumbersGridLayoutGroupCellSizeUpdate(float value);
    public event ticketNumbersGridLayoutGroupCellSizeUpdate MyEvent;

    private BingoGame2History bingoGame2History;

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtLuckyNumber;
    [SerializeField] private TextMeshProUGUI txtActivePlayers;
    [SerializeField] private TextMeshProUGUI txtTotalWithdrawCount;
    [SerializeField] private TextMeshProUGUI txtTotalBetAmount;

    [Header("Button")]
    [SerializeField] private Button btnBuyMore;


    [Header("Toggle")]
    [SerializeField] private Toggle toggleAutoPlay;

    [Header("Transform")]
    [SerializeField] private Transform transformJackpotContainer;
    [SerializeField] private Transform transformTicketContainerHorizontal;
    [SerializeField] private Transform transformTicketContainerVertical;
    public RectTransform Tickets_Horizontal_ScrollRect_RT, Tickets_Verticle_ScrollRect_RT, Tickets_ScrollRect_RT;
    public RectTransform Number_Of_Moves;
    public RectTransform jackpot;

    [Header("GameObject")]
    [SerializeField] private GameObject objectHorizontalContainer;
    [SerializeField] private GameObject objectVerticalContainer;

    [Header("Layout")]
    public GridLayoutGroup ticketContainerHorizontalGridLayoutGroup;

    [Header("Prefabs")]
    [SerializeField] private PrefabJackpotPanel prefabJackpotPanel;
    [SerializeField] public PrefabBingoGame2Ticket3x3 prefabBingoGame2Ticket3X3;

    [Header("List")]
    [SerializeField] private List<PrefabBingoGame2Ticket3x3> ticketList;

    [Header("Panel")]
    [SerializeField] private BingoBallPanelManager bingoBallPanelManager;
    [SerializeField] private UtilityMessagePanel messagePopup;
    [SerializeField] private UtilityLoaderPanel loaderPanel;

    [Header("Data")]
    [SerializeField] private GameData gameData;

    private Transform transformTicketContainer;
    private TicketMarkerCellData markerData;
    private int _luckyNumber;
    private int maxWithdrawCount = 0;
    private List<PrefabJackpotPanel> jackpotPanelList = new List<PrefabJackpotPanel>();

    public GameObject Game2_Player_Details;

    [Header("Timer")]
    public GameObject Game2Timer_UI;
    public TMP_Text Game2_Timer_Txt;
    public Color Timer_Blink_Color;
    public Color Timer_Normal_Color;

    [Header("Sub Game ID")]
    public string Current_Sub_Game_ID;

    [Header("Chat")]
    [SerializeField] private ChatPanel chatPanel;
    public RectTransform Chat_Panel_RT;
    public int Chat_Panel_State;
    public Transform Chat_Open_Close_Icon;
    public GameObject Chat_Open_Open_Text;
    public GameObject Chat_Open_Close_Text;

    [Header("Upcoming Game")]
    public GameObject Upcoming_Game_UI;
    public GameObject Waiting_For_Next_Game;

    [Header("Lucky Number")]
    public Button Lucky_Number_Btn;
    public SelectLuckyNumberPanel Lucky_Number_Panel;
    internal bool Is_Lucky_Number_Method_Added = false;
    internal int New_Lucky_Number;
    private bool _isGameRunning = false;
    #endregion

    #region UNITY_CALLBACKS

    private void Awake()
    {
        AssignTicketContainer();
        GameMarkerId = PlayerPrefs.GetInt("Game_Marker", 1);
    }

    private void OnEnable()
    {
        UIManager.Instance.isGame2 = true;
        Reset();
        UIManager.Instance.topBarPanel.miniGamePlanPanel.gameObject.SetActive(false);
        Game2Timer_UI.SetActive(false);
        Game2_Player_Details.SetActive(true);
        EnableBroadcasts();
        UIManager.Instance.topBarPanel.MiniGamePlanButtonEnable = true;
        UIManager.Instance.topBarPanel.btnMiniGamePlan.gameObject.SetActive(!Utility.Instance.IsSplitScreenSupported);
        LocalizationManager.OnLocalizeEvent += HandleLanguageChange;
    }

    private void HandleLanguageChange()
    {
        if (bingoGame2History == null) return;
        GenerateTicketList(bingoGame2History.ticketList);
    }

    private void OnDisable()
    {
        SoundManager.Instance.StopNumberAnnouncement();
        UIManager.Instance.isGame2 = false;
        DisableBroadcasts();
        UIManager.Instance.topBarPanel.MiniGamePlanButtonEnable = false;
        UIManager.Instance.withdrawNumberHistoryPanel.Close();

        LocalizationManager.OnLocalizeEvent -= HandleLanguageChange;
    }

    #endregion

    #region PUBLIC_METHODS
    /// <summary>
    /// Save game/room data & open game play panel
    /// </summary>
    /// <param name="gameData"></param>
    public void OpenPanel(GameData gameData, string gameID)
    {
        this.gameData = gameData;
        this.gameData.gameId = gameID;

        changeMarkerBackgroundPanel.Close();
        GameMarkerId = PlayerPrefs.GetInt("Game_Marker", 1);
        if (Lucky_Number_Btn != null)
            Lucky_Number_Btn.targetGraphic.raycastTarget = true;
        this.Open();
        UIManager.Instance.isGame2 = true;
        UIManager.Instance.Current_Game_Number = 2;
        if (!Application.isPlaying)
        {
            return;
        }

        if (UIManager.Instance.game2Panel.game2PlayPanel.gameObject == gameObject)
        {
            Chat_Panel_State = Chat_Panel_RT.anchoredPosition.x == 0f ? 1 : 0;
            switch (Chat_Panel_State)
            {
                case 0: // Closed chat panel
                    Tickets_ScrollRect_RT.offsetMin = new Vector2(30f, Tickets_ScrollRect_RT.offsetMin.y);
                    Tickets_ScrollRect_RT.offsetMax = new Vector2(-30f, Tickets_ScrollRect_RT.offsetMax.y);

                    float x1 = (Tickets_ScrollRect_RT.rect.width - (40 + 30 + 380));
                    x1 /= 5;
                    ticketContainerHorizontalGridLayoutGroup.cellSize = new Vector2(x1, x1);

                    Chat_Open_Open_Text.SetActive(true);
                    Chat_Open_Close_Text.SetActive(false);

                    Number_Of_Moves.localScale = new Vector3(1, 1, 1);
                    jackpot.localScale = new Vector3(1, 1, 1);
                    jackpot.anchoredPosition = new Vector3(856f, -140f);

                    break;
                case 1: // Opened chat panel
                    Tickets_ScrollRect_RT.offsetMin = new Vector2(30f, Tickets_ScrollRect_RT.offsetMin.y);
                    Tickets_ScrollRect_RT.offsetMax = new Vector2(-370f, Tickets_ScrollRect_RT.offsetMax.y);

                    float x2 = (Tickets_ScrollRect_RT.rect.width - (40 + 30 + 380));
                    x2 /= 5;
                    ticketContainerHorizontalGridLayoutGroup.cellSize = new Vector2(x2, x2);

                    Chat_Open_Open_Text.SetActive(false);
                    Chat_Open_Close_Text.SetActive(true);

                    Number_Of_Moves.localScale = new Vector3(0.8f, 0.8f, 0.8f);
                    jackpot.localScale = new Vector3(0.8f, 0.8f, 0.8f);
                    jackpot.anchoredPosition = new Vector3(706f, -140f);


                    break;
            }
        }

        if (UIManager.Instance.isBreak)
        {
            UIManager.Instance.breakTimePopup.OpenPanel("null");
        }
        else
        {
            CallSubscribeRoom();
        }
    }

    public void ClosePanel()
    {
        UIManager.Instance.game2Panel.Close();
        UIManager.Instance.Current_Game_Number = 0;
        if (Utility.Instance.IsSplitScreenSupported)
        {
            UIManager.Instance.splitScreenGameManager.game2Panel.Close();
            UIManager.Instance.splitScreenGameManager.RefreshSplitScreenFunction();
            if (UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() == 0)
                UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
        else
        {
            UIManager.Instance.game2Panel.Close();
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
    }

    public void Reconnect()
    {
        Game2Timer_UI.SetActive(false);
        Game2_Player_Details.SetActive(true);
        CallSubscribeRoom();
    }

    public void OpenChangeMarkerBackgroundPanel()
    {
        changeMarkerBackgroundPanel.Open();
    }

    public void BuyMoreBoardsButtonTap()
    {
        RectTransform rectTransform = prefabGame2UpcomingGames.buyMoreBoardsPopup;
        rectTransform.anchoredPosition = new Vector2(460, 0);
        Show_Upcoming_Game_UI();
    }

    public void AdvancePurchaseForTodaysGame()
    {
        if (prefabGame2UpcomingGames.isActiveAndEnabled)
            prefabGame2UpcomingGames.Close();

        UIManager.Instance.topBarPanel.OnMiniGamePlanPanelButtonTap();
    }

    public UtilityMessagePanel GetUtilityMessagePanel()
    {
        if (loaderPanel && Utility.Instance.IsSplitScreenSupported && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1)
            return messagePopup;
        else
            return UIManager.Instance.messagePopup;
    }

    public void DisplayLoader(bool showLoader)
    {
        if (loaderPanel && Utility.Instance.IsSplitScreenSupported && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1)
        {
            if (showLoader)
                loaderPanel.ShowLoader();
            else
            {
                loaderPanel.HideLoader();
                UIManager.Instance.DisplayLoader(false);
            }
        }
        else
        {
            // UIManager.Instance.DisplayLoader(showLoader);
        }
    }

    public void Chat_Open_Close_Btn()
    {
        switch (Chat_Panel_State)
        {
            case 0: // Open chat panel

                LeanTween.cancel(chatPanel.gameObject);
                LeanTween.move(Chat_Panel_RT, new Vector2(0f, Chat_Panel_RT.anchoredPosition.y), 0.25f);
                LeanTween.cancel(Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(Tickets_ScrollRect_RT.gameObject, Set_Ticket_Scroll_Rect_RT, new Vector2(30f, -30f), new Vector2(30f, -402f), 0.25f).setOnComplete(() =>
                {
                    //float x2 = (contentRect.rect.width - (372 + 60 + 40 + 30));
                    float x2 = (Tickets_ScrollRect_RT.rect.width - (40 + 30 + 380));
                    x2 /= 5;
                    ticketContainerHorizontalGridLayoutGroup.cellSize = new Vector2(x2, x2);

                    MyEvent?.Invoke(x2);
                });

                Number_Of_Moves.localScale = new Vector3(0.8f, 0.8f, 0.8f);
                jackpot.localScale = new Vector3(0.8f, 0.8f, 0.8f);
                jackpot.anchoredPosition = new Vector3(706f, -140f);

                Chat_Open_Open_Text.SetActive(false);
                Chat_Open_Close_Text.SetActive(true);

                Chat_Open_Close_Icon.eulerAngles = new Vector3(0f, 0f, 180f);
                Chat_Panel_State = 1;
                break;
            case 1: // Close chat panel
                LeanTween.cancel(chatPanel.gameObject);
                LeanTween.move(Chat_Panel_RT, new Vector2(Chat_Panel_RT.rect.width * 3f, Chat_Panel_RT.anchoredPosition.y), 0.25f);
                LeanTween.cancel(Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(Tickets_ScrollRect_RT.gameObject, Set_Ticket_Scroll_Rect_RT, new Vector2(30f, -402f), new Vector2(30f, -30f), 0.25f).setOnComplete(() =>
                {
                    float x1 = (Tickets_ScrollRect_RT.rect.width - (40 + 30 + 380));
                    x1 /= 5;
                    ticketContainerHorizontalGridLayoutGroup.cellSize = new Vector2(x1, x1);

                    MyEvent?.Invoke(x1);
                });

                Number_Of_Moves.localScale = new Vector3(1, 1, 1);
                jackpot.localScale = new Vector3(1, 1, 1);
                jackpot.anchoredPosition = new Vector3(856f, -140f);

                Chat_Open_Open_Text.SetActive(true);
                Chat_Open_Close_Text.SetActive(false);

                Chat_Open_Close_Icon.eulerAngles = Vector3.zero;
                Chat_Panel_State = 0;
                break;
        }
    }

    void Set_Ticket_Scroll_Rect_RT(Vector2 size)
    {
        Tickets_ScrollRect_RT.offsetMin = new Vector2(size.x, Tickets_ScrollRect_RT.offsetMin.y);
        Tickets_ScrollRect_RT.offsetMax = new Vector2(size.y, Tickets_ScrollRect_RT.offsetMax.y);
    }

    public void Open_Lucky_Number_Selection_Panel()
    {
        if (Upcoming_Game_UI.activeSelf)
            return;

        Lucky_Number_Panel.GenerateLuckyNumbers();
        if (Lucky_Number_Panel.isLuckyNumbersGenerated)
        {
            if (!Is_Lucky_Number_Method_Added)
            {
                foreach (var btns in Lucky_Number_Panel.listLuckeyNumberBall)
                {
                    btns.btnSelectLuckyNumber.onClick.AddListener(() =>
                    {
                        OnLuckyNumberSelection(btns.Number);
                    });
                }

                Is_Lucky_Number_Method_Added = true;
            }
        }
        Lucky_Number_Panel.SetLuckyNumber(LuckyNumber);
        Lucky_Number_Panel.Open();
    }

    public void OnLuckyNumberSelection(Int32 luckyNumber)
    {
        if (New_Lucky_Number == luckyNumber)
            return;
        int lastLuckyNumber = LuckyNumber;
        DisplayLoader(true);
        // TODO: Replace with Spillorama REST endpoint for Game2 lucky number selection
        Debug.LogWarning("[Game2] OnLuckyNumberSelection: Spillorama endpoint not yet implemented");
        LuckyNumber = luckyNumber;
        New_Lucky_Number = LuckyNumber;
        HighlightLuckyNumber();
        DisplayLoader(false);
    }

    #endregion

    #region PRIVATE_METHODS

    /// <summary>
    /// Remove/Destroy old jackpot list & generate new list
    /// </summary>
    /// <param name="jackpotList"></param>
    private void GenerateJackpotList(List<JackpotData> jackpotList)
    {
        foreach (Transform transform in transformJackpotContainer)
            Destroy(transform.gameObject);

        foreach (JackpotData data in jackpotList)
        {
            PrefabJackpotPanel newJackpotPanel = Instantiate(prefabJackpotPanel, transformJackpotContainer);
            newJackpotPanel.SetData(data);
            this.jackpotPanelList.Add(newJackpotPanel);
        }
    }

    /// <summary>
    /// Remove/Destroy old withdraw number list & genereate new list
    /// </summary>
    /// <param name="withdrawNumberList"></param>
    private void GenerateWithdrawNumberList(List<BingoNumberData> withdrawNumberList)
    {
        foreach (BingoNumberData data in withdrawNumberList)
        {
            MarkWithdrawNumbers(data);
        }

        bingoBallPanelManager.WithdrawList(withdrawNumberList, "Game 2");
    }

    private void RunBestCardFirstAction()
    {
        ticketList.Sort(BingoTicket.ReverseSortBySelectedNumber);

        for (int i = 0; i < ticketList.Count; i++)
            ticketList[i].transform.SetSiblingIndex(i);
    }

    /// <summary>
    /// NewNumberWithdrawEvent will show new withdraw bingo ball with animation
    /// </summary>
    /// <param name="newBingoNumberData"></param>
    private void WithdrawBingoBallAction(BingoNumberData newBingoNumberData)
    {
        bingoBallPanelManager.NewWithdraw(newBingoNumberData, true, "Game 2");
        MarkWithdrawNumbers(newBingoNumberData, true);
    }

    /// <summary>
    /// Mark new withdraw number on all ticket
    /// </summary>
    /// <param name="data"></param>
    private void MarkWithdrawNumbers(BingoNumberData data, bool playSound = false)
    {
        foreach (PrefabBingoGame2Ticket3x3 ticket in ticketList)
        {
            ticket.MarkNewWithdrawNumber(data.number, false, false, playSound);
            ticket.Set_Togo_Txt();
        }
        RunBestCardFirstAction();
    }

    public void HighlightLuckyNumber()
    {
        foreach (PrefabBingoGame2Ticket3x3 ticket in ticketList)
        {
            ticket.HighlightLuckyNumber(LuckyNumber);
        }
    }

    /// <summary>
    /// Remove/Destroy old ticket list & generate new list
    /// </summary>
    /// <param name="ticketDataList"></param>
    private void GenerateTicketList(List<GameTicketData> ticketDataList)
    {
        Clear_Tickets(Current_Sub_Game_ID, false);
        foreach (GameTicketData data in ticketDataList)
        {
            PrefabBingoGame2Ticket3x3 newTicket = Instantiate(prefabBingoGame2Ticket3X3, transformTicketContainer);

            float x1 = (Tickets_ScrollRect_RT.rect.width - (40 + 30 + 380));
            x1 /= 5;
            ticketContainerHorizontalGridLayoutGroup.cellSize = new Vector2(x1, x1);

            newTicket.TicketNumbersGridLayoutGroupCellSizeUpdate(x1);
            newTicket.deleteBtn.gameObject.SetActive(true);
            newTicket.SetData(data, markerData);
            newTicket.Set_Togo_Txt();
            ticketList.Add(newTicket);
        }
        if (ticketList.Count == 0)
        {
            RectTransform rectTransform = prefabGame2UpcomingGames.buyMoreBoardsPopup;
            rectTransform.anchoredPosition = new Vector2(0, 0);

            Show_Upcoming_Game_UI();
        }
    }

    internal void Clear_Tickets(string subgameID, bool showUpcomingGameUI = true)
    {
        if (Current_Sub_Game_ID != subgameID)
            return;
        foreach (Transform transform in transformTicketContainer)
            Destroy(transform.gameObject);
        ticketList.Clear();

        if (showUpcomingGameUI)
        {
            RectTransform rectTransform = prefabGame2UpcomingGames.buyMoreBoardsPopup;
            rectTransform.anchoredPosition = new Vector2(0, 0);

            Show_Upcoming_Game_UI();
        }
    }

    internal void Clear_Luck_Number(string subgameID)
    {
        if (Current_Sub_Game_ID != subgameID)
            return;
        LuckyNumber = 0;
        New_Lucky_Number = 0;
    }

    void Show_Upcoming_Game_UI()
    {
        // TODO: Replace with Spillorama REST endpoint for Game2 upcoming games
        Debug.LogWarning("[Game2] Show_Upcoming_Game_UI: Spillorama endpoint not yet implemented");
    }

    private PrefabBingoGame2Ticket3x3 GetTicketById(string ticketId)
    {
        foreach (PrefabBingoGame2Ticket3x3 ticket in ticketList)
        {
            if (ticket.TicketId == ticketId)
                return ticket;
        }

        return null;
    }

    /// <summary>
    /// Reset/Clear all game data. normally calls on starting game or reconnecting existing game
    /// </summary>
    private void Reset()
    {
        // Clear game history to prevent stale data bleeding into next game
        bingoGame2History = null;
        isTimerReceived = false;
        _isGameRunning = false;

        toggleAutoPlay.isOn = false;
        LuckyNumber = 0;
        New_Lucky_Number = 0;
        TotalRegisteredPlayerCount = 0;
        bingoBallPanelManager.Reset();

        foreach (Transform transform in transformTicketContainer)
            Destroy(transform.gameObject);
        ticketList.Clear();

        jackpotPanelList.Clear();
        foreach (Transform transform in transformJackpotContainer)
            Destroy(transform.gameObject);

        StopAllCoroutines();

        UIManager.Instance.withdrawNumberHistoryPanel.Close();
        UIManager.Instance.withdrawNumberHistoryPanel.Reset();
    }

    private void AssignTicketContainer()
    {
        if (Utility.Instance.IsRunningOniPad() || Utility.Instance.IsSplitScreenSupported)
        {
            transformTicketContainer = transformTicketContainerHorizontal;
            if (objectHorizontalContainer)
                objectHorizontalContainer.Open();
            objectVerticalContainer.Close();
            // Tickets_ScrollRect_RT = Tickets_Horizontal_ScrollRect_RT;

        }
        else
        {
            transformTicketContainer = transformTicketContainerHorizontal;
            if (objectHorizontalContainer)
                objectHorizontalContainer.Open();
            objectVerticalContainer.Close();
            // Tickets_ScrollRect_RT = Tickets_Horizontal_ScrollRect_RT;
        }
    }

    #endregion

    #region GETTER_SETTER
    public int LuckyNumber
    {
        set
        {
            _luckyNumber = value;
            if (value > 0)
                txtLuckyNumber.text = value.ToString();
            else
                txtLuckyNumber.text = "";
        }
        get
        {
            return _luckyNumber;
        }
    }

    public int GameMarkerId
    {
        set
        {
            PlayerPrefs.SetInt("Game_Marker", value);
            markerData = UIManager.Instance.GetMarkerData(value);
            foreach (PrefabBingoGame2Ticket3x3 ticket in ticketList)
            {
                ticket.ModifyMarkerDesign(markerData);
            }
        }
    }

    private int _totalRegisteredPlayerCount;
    public int TotalRegisteredPlayerCount
    {
        get { return _totalRegisteredPlayerCount; }
        set { _totalRegisteredPlayerCount = value; txtActivePlayers.text = value.ToString("00"); }
    }

    public int TotalWithdrawCount
    {
        set
        {
            txtTotalWithdrawCount.text = value.ToString("00") + "/" + maxWithdrawCount.ToString("00");
        }
    }

    public bool IsGameRunning
    {
        set
        {
            _isGameRunning = value;
        }
        get
        {
            return _isGameRunning;
        }
    }

    public int TotalBetAmount
    {
        set
        {
            txtTotalBetAmount.GetComponent<LocalizationParamsManager>().SetParameterValue("TotalBet", value.ToString());
        }
    }
    #endregion
}
