using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public partial class Game3GamePlayPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Panels")]
    public ChangeMarkerBackgroundPanel changeMarkerBackgroundPanel;

    [Header("Row Details")]
    public PanelRowDetails PanelRowDetails;

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtLuckyNumber;
    [SerializeField] private TextMeshProUGUI txtActivePlayers;
    [SerializeField] private TextMeshProUGUI txtTotalWithdrawCount;
    [SerializeField] private TextMeshProUGUI txtLastWithdrawNumber;
    [SerializeField] private TextMeshProUGUI txtWithdrawNumberStats;
    [SerializeField] private TextMeshProUGUI txtPickLuckyNumber;
    [SerializeField] private TextMeshProUGUI txtTotalBetAmount;
    [SerializeField] private TextMeshProUGUI txtTotalProfitAmount;

    [Header("Button")]
    [SerializeField] private Button btnSelectLuckyNumber;
    [SerializeField] private Button btnBuyMore;

    [Header("Transform")]
    [SerializeField] private Transform transformPatternContainer;
    [SerializeField] private Transform transformTicketContainer;
    [SerializeField] private RectTransform Tickets_ScrollRect_RT;

    [Header("Prefabs")]
    [SerializeField] private PrefabBingoGame3Pattern prefabBingo3PatternPanel;
    [SerializeField] private PrefabBingoGame3Ticket5x5 prefabBingoGame3Ticket5X5;

    [Header("List")]
    [SerializeField] private List<PrefabBingoGame3Ticket5x5> ticketList;

    [Header("Panels")]
    [SerializeField] private SelectLuckyNumberPanel selectLuckyNumberPanel;
    [SerializeField] private BingoBallPanelManager bingoBallPanelManager;
    [SerializeField] private UtilityMessagePanel messagePopup;
    [SerializeField] private UtilityLoaderPanel loaderPanel;

    [Header("Data")]
    [SerializeField] private GameData gameData;

    private TicketMarkerCellData markerData;
    private int _luckeyNumber = 0;
    private int _maxWithdrawCount = 0;
    private int currentPatternRow = 0;

    public BingoGame3History BingoGame3History;

    [Header("Timer")]
    public GameObject Game3Timer_UI;
    public TMP_Text Game3_Timer_Txt;
    public Color Timer_Blink_Color, Timer_Normal_Color;

    [Header("Sub Game ID")]
    public string Current_Sub_Game_ID;

    [Header("Patterns")]
    public List<PrefabBingoGame3Pattern> Patterns;
    private bool CanBeDeleted;

    [Header("Chat")]
    [SerializeField] private ChatPanel chatPanel;
    public RectTransform Chat_Panel_RT;
    public int Chat_Panel_State;
    public Transform Chat_Open_Close_Icon;
    public GameObject Chat_Open_Open_Text;
    public GameObject Chat_Open_Close_Text;


    [Header("Upcoming Game")]
    [SerializeField] private GameObject Upcoming_Game_UI;
    public GameObject Waiting_For_Next_Game;
    float Upcoming_Game_UI_Offset;


    [Header("Header objects")]
    public GameObject Panel_Game_Header;
    #endregion
    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        UIManager.Instance.isGame3 = true;
        Reset();

        EnableBroadcasts();
        Screen.sleepTimeout = SleepTimeout.NeverSleep;
        UIManager.Instance.topBarPanel.MiniGamePlanButtonEnable = true;
        UIManager.Instance.topBarPanel.btnMiniGamePlan.gameObject.SetActive(!Utility.Instance.IsSplitScreenSupported);
        Game3Timer_UI.SetActive(false);
        LocalizationManager.OnLocalizeEvent += HandleLanguageChange;
    }

    private void OnDisable()
    {
        SoundManager.Instance.StopNumberAnnouncement();
        UIManager.Instance.isGame3 = false;

        DisableBroadcasts();
        Screen.sleepTimeout = SleepTimeout.SystemSetting;
        foreach (Transform transform in transformPatternContainer)
            Destroy(transform.gameObject);
        Patterns.Clear();
        UIManager.Instance.topBarPanel.MiniGamePlanButtonEnable = false;
        UIManager.Instance.withdrawNumberHistoryPanel.Close();

        LocalizationManager.OnLocalizeEvent -= HandleLanguageChange;

    }

    private void HandleLanguageChange()
    {
        GenerateRowDetails(BingoGame3History.patternList);
        GeneratePatternList(BingoGame3History.patternList);
        GenerateWithdrawNumberList(BingoGame3History.withdrawNumberList);
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

        foreach (Transform transform in transformPatternContainer)
            Destroy(transform.gameObject);
        Patterns.Clear();

        changeMarkerBackgroundPanel.Close();
        selectLuckyNumberPanel.Close();
        GameMarkerId = PlayerPrefs.GetInt("Game_Marker", 1);

        this.Open();
        UIManager.Instance.isGame3 = true;
        UIManager.Instance.Current_Game_Number = 3;
        if (!Application.isPlaying)
        {
            return;
        }
        if (UIManager.Instance.game3Panel.game3GamePlayPanel.gameObject == gameObject)
        {
            Chat_Panel_State = Chat_Panel_RT.anchoredPosition.x == 0 ? 1 : 0;
            switch (Chat_Panel_State)
            {
                case 0: // Closed chat panel
                    Tickets_ScrollRect_RT.offsetMin = new Vector2(200f, Tickets_ScrollRect_RT.offsetMin.y);
                    Tickets_ScrollRect_RT.offsetMax = new Vector2(-30f, Tickets_ScrollRect_RT.offsetMax.y);

                    LeanTween.cancel(Panel_Game_Header);
                    LeanTween.move(Panel_Game_Header.GetComponent<RectTransform>(), new Vector2(Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x - 80f, Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y), 0.25f)
                        .setOnComplete(() =>
                        {
                            // Your code to be executed when the move is complete
                            Debug.Log("Closed chat panel!");
                        });

                    break;
                case 1: // Opened chat panel
                    Tickets_ScrollRect_RT.offsetMin = new Vector2(200f, Tickets_ScrollRect_RT.offsetMin.y);
                    Tickets_ScrollRect_RT.offsetMax = new Vector2(-400f, Tickets_ScrollRect_RT.offsetMax.y);

                    LeanTween.cancel(Panel_Game_Header);
                    LeanTween.move(Panel_Game_Header.GetComponent<RectTransform>(), new Vector2(Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x + 80f, Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y), 0.25f)
                        .setOnComplete(() =>
                        {
                            // Assuming the script is attached to the GameObject with RectTransform
                            RectTransform rectTransform = Panel_Game_Header.GetComponent<RectTransform>();

                            // Set the left and right values to 0
                            rectTransform.offsetMin = new Vector2(0f, rectTransform.offsetMin.y);
                            rectTransform.offsetMax = new Vector2(0f, rectTransform.offsetMax.y);
                        });
                    break;
            }
        }

        Upcoming_Game_UI_Offset = (bingoBallPanelManager.transform.parent.gameObject.GetComponent<RectTransform>().anchoredPosition.x + ((bingoBallPanelManager.transform.parent.gameObject.GetComponent<RectTransform>().rect.width - bingoBallPanelManager.gameObject.GetComponent<RectTransform>().rect.width) / 2f) + bingoBallPanelManager.gameObject.GetComponent<RectTransform>().rect.width) / 2f;

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
        UIManager.Instance.game3Panel.Close();
        UIManager.Instance.Current_Game_Number = 0;
        if (Utility.Instance.IsSplitScreenSupported)
        {
            UIManager.Instance.splitScreenGameManager.game3Panel.Close();
            UIManager.Instance.splitScreenGameManager.RefreshSplitScreenFunction();
            if (UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() == 0)
                UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
        else
        {
            UIManager.Instance.game3Panel.Close();
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
    }

    public void Reconnect()
    {
        Game3Timer_UI.SetActive(false);
        CallSubscribeRoom();
    }

    public void BuyMoreBoardsButtonTap()
    {
        Show_Upcoming_Game_UI();
    }

    public void BuyMoreBoardsclose()
    {
        Upcoming_Game_UI.SetActive(false);
    }

    public void OnLuckyNumberTap()
    {
        if (ticketList.Count <= 0)
            return;
        selectLuckyNumberPanel.Open();
    }

    public void OpenChangeMarkerBackgroundPanel()
    {
        changeMarkerBackgroundPanel.Open();
    }

    public void OnLuckyNumberSelection(Int32 luckyNumber)
    {
        if (LuckyNumber == luckyNumber)
            return;

        int lastLuckyNumber = LuckyNumber;
        DisplayLoader(true);
        // TODO: Replace with Spillorama REST endpoint for Game3 lucky number selection
        Debug.LogWarning("[Game3] OnLuckyNumberSelection: Spillorama endpoint not yet implemented");
        LuckyNumber = luckyNumber;
        HighlightLuckyNumber();
        DisplayLoader(false);
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
                LeanTween.value(Tickets_ScrollRect_RT.gameObject, Set_Ticket_Scroll_Rect_RT, new Vector2(200f, -30f), new Vector2(200f, -400f), 0.25f);

                Chat_Open_Close_Icon.eulerAngles = new Vector3(0f, 0f, 180f);

                Chat_Open_Open_Text.SetActive(false);
                Chat_Open_Close_Text.SetActive(true);

                Chat_Panel_State = 1;
                if (Upcoming_Game_UI.activeSelf)
                {
                    LeanTween.cancel(Upcoming_Game_UI);
                    LeanTween.move(Upcoming_Game_UI.GetComponent<RectTransform>(), new Vector2((-Chat_Panel_RT.rect.width / 2f) + Upcoming_Game_UI_Offset, Upcoming_Game_UI.GetComponent<RectTransform>().anchoredPosition.y), 0.25f);
                }

                if (Panel_Game_Header.activeSelf)
                {
                    LeanTween.cancel(Panel_Game_Header);
                    LeanTween.move(Panel_Game_Header.GetComponent<RectTransform>(), new Vector2(Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x - 80, Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y), 0.25f)
                        .setOnComplete(() =>
                        {
                            // Assuming the script is attached to the GameObject with RectTransform
                            RectTransform rectTransform = Panel_Game_Header.GetComponent<RectTransform>();

                            // Set the left and right values to 0
                            rectTransform.offsetMin = new Vector2(0f, rectTransform.offsetMin.y);
                            rectTransform.offsetMax = new Vector2(0f, rectTransform.offsetMax.y);

                        });
                }


                break;
            case 1: // Close chat panel
                LeanTween.cancel(chatPanel.gameObject);
                LeanTween.move(Chat_Panel_RT, new Vector2(Chat_Panel_RT.rect.width * 3f, Chat_Panel_RT.anchoredPosition.y), 0.25f);
                LeanTween.cancel(Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(Tickets_ScrollRect_RT.gameObject, Set_Ticket_Scroll_Rect_RT, new Vector2(200f, -400f), new Vector2(200f, -30f), 0.25f);

                Chat_Open_Close_Icon.eulerAngles = Vector3.zero;

                Chat_Open_Open_Text.SetActive(true);
                Chat_Open_Close_Text.SetActive(false);

                Chat_Panel_State = 0;
                if (Upcoming_Game_UI.activeSelf)
                {
                    LeanTween.cancel(Upcoming_Game_UI);
                    LeanTween.move(Upcoming_Game_UI.GetComponent<RectTransform>(), new Vector2(Upcoming_Game_UI_Offset, Upcoming_Game_UI.GetComponent<RectTransform>().anchoredPosition.y), 0.25f);
                }
                if (Panel_Game_Header.activeSelf)
                {
                    LeanTween.cancel(Panel_Game_Header);
                    LeanTween.move(Panel_Game_Header.GetComponent<RectTransform>(), new Vector2(Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x + 80f, Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y), 0.25f);
                }

                break;
        }
    }

    void Set_Ticket_Scroll_Rect_RT(Vector2 size)
    {
        Tickets_ScrollRect_RT.offsetMin = new Vector2(size.x, Tickets_ScrollRect_RT.offsetMin.y);
        Tickets_ScrollRect_RT.offsetMax = new Vector2(size.y, Tickets_ScrollRect_RT.offsetMax.y);
    }

    #endregion

    #region PRIVATE_METHODS

    private void GenerateRowDetails(List<PatternData> patternList)
    {
        for (int i = 0; i < PanelRowDetails.Rows.Length; i++)
            PanelRowDetails.Rows[i].gameObject.SetActive(false);

        for (int i = 0; i < PanelRowDetails.RowsDevider.Length; i++)
            PanelRowDetails.RowsDevider[i].gameObject.SetActive(false);

        for (int i = 0; i < patternList.Count; i++)
        {
            if (i > 0)
                PanelRowDetails.RowsDevider[i - 1].gameObject.SetActive(true);
        }

        currentPatternRow = 0;

        for (int i = 0; i < patternList.Count; i++)
        {
            if (patternList[i].isWon)
            {
                currentPatternRow = i + 1;
            }

            FormatRowText(patternList[i], i);
            PanelRowDetails.Rows[i].GetComponent<TextMeshProUGUI>().color =
                patternList[i].isWon ? PanelRowDetails.ActiveColour : PanelRowDetails.DeActiveColour;
        }
    }

    private void FormatRowText(PatternData pattern, int index)
    {
        string text;
        int displayIndex = index + 1;

        if (pattern.name == "Picture")
        {
            text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubPicture")
                + " - " + pattern.amount + " kr";
        }
        else if (pattern.name == "Frame")
        {
            text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubFrame")
                + " - " + pattern.amount + " kr";
        }
        else if (pattern.name == "Full House")
        {
            text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow")
                + " 5 - " + pattern.amount + " kr";
        }
        else
        {
            text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow")
                + " " + displayIndex + " - " + pattern.amount + " kr";
        }

        PanelRowDetails.Rows[index].text = text;
        PanelRowDetails.Rows[index].gameObject.SetActive(true);
    }

    /// <summary>
    /// Remove/Destroy old jackpot list & generate new list
    /// </summary>
    /// <param name="jackpotList"></param>
    private void GeneratePatternList(List<PatternData> patternList)
    {
        // Destroy all children of transformPatternContainer
        foreach (Transform child in transformPatternContainer)
        {
            Destroy(child.gameObject);
        }
        // Clear the Patterns list
        Patterns.Clear();


        for (int i = Patterns.Count - 1; i > -1; i--)
        {
            CanBeDeleted = true;
            for (int j = 0; j < patternList.Count; j++)
            {
                if (Patterns[i].Pattern_ID == patternList[j]._id)
                {
                    CanBeDeleted = false;
                    Patterns[i].Pattern_Prize = patternList[j].amount;
                    Patterns[i].Prize_Txt.text = $"{patternList[j].amount} kr";
                    patternList.RemoveAt(j);
                    break;
                }
            }
            if (CanBeDeleted)
            {
                Destroy(Patterns[i].gameObject);
                Patterns.RemoveAt(i);
            }
        }


        if (patternList.Count > 0)
        {
            for (int i = 0; i < patternList.Count; i++)
            {
                if (i == currentPatternRow)
                {
                    PrefabBingoGame3Pattern newPatternPanel = Instantiate(prefabBingo3PatternPanel, transformPatternContainer);
                    newPatternPanel.SetData(patternList[i], i + 1);
                    Patterns.Add(newPatternPanel);
                }
            }

            for (int i = 1; i < Patterns.Count; i++)
                if (Patterns[i].Ball_Number <= Patterns[0].Ball_Number)
                    Patterns[i].transform.SetAsFirstSibling();
            for (int j = 4; j > 0; j--)
                for (int i = 0; i < Patterns.Count; i++)
                    if (Patterns[i].Pattern_Design == j)
                        Patterns[i].transform.SetAsFirstSibling();
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

        if (withdrawNumberList.Count > 0)
            LastWithdrawNumber = withdrawNumberList[withdrawNumberList.Count - 1].number;

        bingoBallPanelManager.WithdrawList(withdrawNumberList, "Game 3");
    }

    private void RunBestCardFirstAction()
    {
        // Sort tickets by the fewest remaining pattern cells (best card first)
        ticketList = ticketList.OrderBy(t => t.Pattern_Remaining_Cell_Count).ToList();

        // Update sibling order in the UI hierarchy
        for (int i = 0; i < ticketList.Count; i++)
        {
            ticketList[i].transform.SetSiblingIndex(i);
        }

        // Force the layout to refresh
        Canvas.ForceUpdateCanvases();
        if (ticketList.Count > 0)
        {
            LayoutRebuilder.ForceRebuildLayoutImmediate(ticketList[0].transform.parent as RectTransform);
        }
    }

    /// <summary>
    /// NewNumberWithdrawEvent will show new withdraw bingo ball with animation
    /// </summary>
    /// <param name="newBingoNumberData"></param>
    private void WithdrawBingoBallAction(BingoNumberData newBingoNumberData)
    {
        bingoBallPanelManager.NewWithdraw(newBingoNumberData, true, "Game 3");
        MarkWithdrawNumbers(newBingoNumberData, true);
        LastWithdrawNumber = newBingoNumberData.number;
    }

    /// <summary>
    /// Mark new withdraw number on all ticket
    /// </summary>
    /// <param name="data"></param>
    private void MarkWithdrawNumbers(BingoNumberData data, bool playSound = false)
    {
        foreach (PrefabBingoGame3Ticket5x5 ticket in ticketList)
        {
            ticket.MarkNewWithdrawNumber(data.number, false, false, playSound);
            ticket.Match_Pattern_And_Set_Togo_Txt();
        }
        RunBestCardFirstAction();
    }

    public void HighlightLuckyNumber()
    {
        foreach (PrefabBingoGame3Ticket5x5 ticket in ticketList)
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
            PrefabBingoGame3Ticket5x5 newTicket = Instantiate(prefabBingoGame3Ticket5X5, transformTicketContainer);
            newTicket.SetData(data, markerData);
            if (BingoGame3History.disableCancelButton)
            {
                newTicket.deleteBtn.gameObject.SetActive(false);
            }
            else
            {
                newTicket.deleteBtn.gameObject.SetActive(true);
            }
            ticketList.Add(newTicket);
        }
        if (ticketList.Count == 0)
            Show_Upcoming_Game_UI();
    }

    internal void Clear_Tickets(string subgameID, bool showUpcomingGameUI = true)
    {
        if (Current_Sub_Game_ID != subgameID)
            return;
        foreach (Transform transform in transformTicketContainer)
            Destroy(transform.gameObject);
        ticketList.Clear();
        if (showUpcomingGameUI)
            Show_Upcoming_Game_UI();
    }

    void Show_Upcoming_Game_UI()
    {
        // TODO: Replace with Spillorama REST endpoint for Game3 upcoming games
        Debug.LogWarning("[Game3] Show_Upcoming_Game_UI: Spillorama endpoint not yet implemented");
    }

    internal void Clear_Luck_Number(string subgameID)
    {
        if (Current_Sub_Game_ID != subgameID)
            return;

        LuckyNumber = 0;
    }

    internal void Clear_total_Bet_Amount(string subgameID)
    {
        if (Current_Sub_Game_ID != subgameID)
            return;

        totalBetAmount = 0;
    }

    private PrefabBingoGame3Ticket5x5 GetTicketById(string ticketId)
    {
        foreach (PrefabBingoGame3Ticket5x5 ticket in ticketList)
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
        LastWithdrawNumber = 0;
        LuckyNumber = 0;
        TotalRegisteredPlayerCount = 0;

        bingoBallPanelManager.Reset();
        ticketList.Clear();

        foreach (Transform transform in transformPatternContainer)
            Destroy(transform.gameObject);
        Patterns.Clear();

        foreach (Transform transform in transformTicketContainer)
            Destroy(transform.gameObject);

        UIManager.Instance.withdrawNumberHistoryPanel.Close();
        UIManager.Instance.withdrawNumberHistoryPanel.Reset();
    }
    #endregion

    #region GETTER_SETTER
    public int LuckyNumber
    {
        set
        {
            _luckeyNumber = value;

            txtLuckyNumber.text = (value > 0) ? value.ToString() : "";
        }
        get
        {
            return _luckeyNumber;
        }
    }

    public int GameMarkerId
    {
        set
        {
            PlayerPrefs.SetInt("Game_Marker", value);
            markerData = UIManager.Instance.GetMarkerData(value);
            foreach (PrefabBingoGame3Ticket5x5 ticket in ticketList)
            {
                if (ticket != null)
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
            txtWithdrawNumberStats.text = value.ToString("00") + "/" + MaxWithdrawCount;
        }
    }

    public bool EditLuckyNumberEnable
    {
        set
        {
            txtPickLuckyNumber.gameObject.SetActive(value);
            btnSelectLuckyNumber.enabled = value;
        }
    }

    public int totalBetAmount
    {
        set
        {
            txtTotalBetAmount.GetComponent<LocalizationParamsManager>().SetParameterValue("TotalBet", value.ToString());
        }
    }

    public int TotalProfitAmount
    {
        set
        {
            txtTotalProfitAmount.GetComponent<LocalizationParamsManager>().SetParameterValue("TotalProfit", value.ToString());
        }
    }

    public int MaxWithdrawCount
    {
        set
        {
            _maxWithdrawCount = value;
        }
        get
        {
            return _maxWithdrawCount;
        }
    }

    public int LastWithdrawNumber
    {
        set
        {
            txtLastWithdrawNumber.text = value.ToString("00");
        }
    }
    #endregion
}
