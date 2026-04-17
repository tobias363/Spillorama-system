using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
#if !UNITY_WEBGL
using I2.Loc;
#endif

public partial class Game1GamePlayPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    [Header("Panels")]
    public ChangeMarkerBackgroundPanel changeMarkerBackgroundPanel;

    [Header("Row Details")]
    public PanelRowDetails PanelRowDetails;
    private int curruntPatternRow = 0;

    [Header("Patterns")]
    public List<PrefabBingoGame1Pattern> Patterns;
    bool CanBeDeleted;

    [Header("Game 1 Timer")]
    public GameObject Game_1_Timer;
    public GameObject Game_1_Timer_LBL;
    public TMP_Text Game_1_Timer_Txt;

    public Game1ViewPurchaseElvisTicket View_Elvis_Tickets_Prefab;
    public Transform View_Ticket_Parent;
    public RectTransform Elvis_Tickets_ScrollRect_RT;
    Game1ViewPurchaseElvisTicket Elvis_Ticket;
    public List<GameObject> Elvis_Tickets;

    [Header("Replace Elvis Tickets")]
    public int Replace_Amount;
    public string Elvis_Replace_Ticket_Id1,
        Elvis_Replace_Ticket_Id2;

    public GameObject Tickets_Panel,
        Elvis_Replace_Tickets_Panel;

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField]
    private TextMeshProUGUI txtLuckeyNumber;

    [SerializeField]
    private TextMeshProUGUI txtActivePlayers;

    [SerializeField]
    private TextMeshProUGUI txtTotalBetAmount;

    [SerializeField]
    private TextMeshProUGUI txtTotalProfitAmount;

    [SerializeField]
    private TextMeshProUGUI txtLastWithdrawNumber;

    [SerializeField]
    private TextMeshProUGUI txtWithdrawNumberStats;

    [SerializeField]
    private TextMeshProUGUI txtPickLuckyNumber;

    [Header("Button")]
    [SerializeField]
    private Button btnSelectLuckyNumber;

    [SerializeField]
    private Button miniGamePlan;

    [SerializeField]
    private Button buyMoreTicket;

    [Header("Transform")]
    [SerializeField]
    private Transform transformPatternContainer;

    [SerializeField]
    private Transform transformTicketContainer;

    [SerializeField]
    private Transform transformMiniGameContainer;
    public RectTransform Tickets_ScrollRect_RT;

    [Header("Prefabs")]
    [SerializeField]
    private PrefabBingoGame1Pattern prefabBingo1PatternPanel;

    [SerializeField]
    private PrefabBingoGame1Ticket5x5 prefabBingoGame1Ticket5X5;

    [SerializeField]
    private PrefabBingoGame1LargeTicket5x5 prefabBingoGame1LargeTicket5X5;

    [Header("List")]
    /*[SerializeField]*/
    public List<PrefabBingoGame1Ticket5x5> ticketList;

    [SerializeField]
    private List<PrefabBingoGame1LargeTicket5x5> ticketLargeList;

    [Header("Panels")]
    [SerializeField]
    private SelectLuckyNumberPanel selectLuckyNumberPanel;

    [SerializeField]
    private BingoBallPanelManager bingoBallPanelManager;

    [SerializeField]
    private UtilityMessagePanel messagePopup;

    [SerializeField]
    private UtilityLoaderPanel loaderPanel;

    [Header("Mini Games")]
    public WheelOfFortunePanel wheelOfFortunePanel;
    public FortuneWheelManager fortuneWheelManager;
    public NewFortuneWheelManager newFortuneWheelManager;
    public TreasureChestPanel treasureChestPanel;
    public MysteryGamePanel mysteryGamePanel;
    public ColorDraftPanel colorDraftGamePanel;

    [Header("Data")]
    [SerializeField]
    private GameData gameData;

    private TicketMarkerCellData markerData;
    private int _luckeyNumber = 0;
    private int _maxWithdrawCount = 0;
    int _gameMarkerId = 0;

    [Header("Upcoming Game")]
    public GameObject Upcoming_Game_Purchase_UI;
    public Transform Upcoming_Game_Ticket_Parent;
    public ContentSizeFitter Upcoming_Game_CSF;
    public Game1PurchaseTicketData Upcoming_Game_Ticket_Prefab;
    public TMP_Text Upcoming_Game_Name_Txt,
        Upcoming_Game_Purchased_Ticket_Txt,
        Upcoming_Game_Buy_Ticket_Txt;
    public Button Btn_Upcoming_Game_Buy_Tickets;
    public List<Game1PurchaseTicketData> Upcoming_Game_Tickets;
    public int Purchased_Tickets,
        Max_Purcahse_Ticket;
    internal Game1 Upcoming_Game_Data;
    internal bool Is_AnyGame_Running;

    [Header("Elves")]
    private bool isReplaceDisabled;

    [Header("Chat")]
    [SerializeField]
    private ChatPanel chatPanel;
    public RectTransform Chat_Panel_RT;
    public int Chat_Panel_State;
    public Transform Chat_Open_Close_Icon;
    public GameObject Chat_Open_Open_Text;
    public GameObject Chat_Open_Close_Text;

    [Header("Extras")]
    public GameObject Prefab_Devider;
    public List<GameObject> instantiatedObjects;
    private int BuyMoreDisableFlagVal;

    public bool onGameStart = false;
    public bool isGameRefreshed = false;

    public BingoGame1History BingoGame1HistoryData;

    [Header("Header objects")]
    public GameObject Panel_Game_Header;

    private Coroutine nextGameTimer;
    #endregion
    #region UNITY_CALLBACKS
    private void Awake()
    {
        GameMarkerId = PlayerPrefs.GetInt("Game_Marker", 1);
        transformMiniGameContainer.gameObject.SetActive(true);
    }

    private void OnEnable()
    {
        isGameRefreshed = false;
        Reset();
        CloseMiniGames();

        GameSocketManager.OnSocketReconnected += Reconnect;
        EnableBroadcasts();
        UIManager.Instance.topBarPanel.HallGameListButton = false;
        UIManager.Instance.topBarPanel.btnMiniGamePlan.gameObject.SetActive(
            !Utility.Instance.IsSplitScreenSupported
        );
        LocalizationManager.OnLocalizeEvent += HandleLanguageChange;
    }

    private void OnDisable()
    {
        SoundManager.Instance.StopNumberAnnouncement();
        GameSocketManager.OnSocketReconnected -= Reconnect;
        DisableBroadcasts();
        UIManager.Instance.topBarPanel.MiniGamePlanButtonEnable = false;
        UIManager.Instance.topBarPanel.HallGameListButton = false;

        if (Application.isPlaying && !string.IsNullOrEmpty(gameData.gameId))
        {
            EventManager.Instance.UnSubscribeRoom(gameData.namespaceString, gameData.gameId, null);
        }

        UIManager.Instance.withdrawNumberHistoryPanel.Close();
        if (UIManager.Instance.topBarPanel != null)
        {
            UIManager.Instance.topBarPanel.GameType = "";
        }
        CloseMiniGames();

        LocalizationManager.OnLocalizeEvent -= HandleLanguageChange;
    }

    #endregion

    #region DELEGATE_CALLBACKS
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
        TopBarPanel topBarPanel = UIManager.Instance.topBarPanel;
        if (topBarPanel != null)
        {
            topBarPanel.GameType = gameData.gameName;
        }

        //chatPanel.InitiateChatFeature(gameData);
        changeMarkerBackgroundPanel.Close();
        GameMarkerId = PlayerPrefs.GetInt("Game_Marker", 1);
        selectLuckyNumberPanel.Close();
        UIManager.Instance.Current_Game_Number = 1;
        if (topBarPanel != null && topBarPanel.hallGameListPanel != null)
        {
            topBarPanel.hallGameListPanel.gameObject.SetActive(false);
            if (topBarPanel.hallGameListPanel.game1PurchaseTicket != null)
            {
                topBarPanel.hallGameListPanel.game1PurchaseTicket.gameObject.SetActive(
                    false
                );
            }
        }

        this.Open();
        DisplayLoader(true);
        if (!Application.isPlaying)
        {
            DisplayLoader(false);
            return;
        }

        //Invoke("CallSubscribeRoom", 0.1f);
        CallSubscribeRoom();

        if (UIManager.Instance.game1Panel.game1GamePlayPanel.gameObject == gameObject)
        {
            Chat_Panel_State = Chat_Panel_RT.anchoredPosition.x == 0f ? 1 : 0;
            switch (Chat_Panel_State)
            {
                case 0: // Closed chat panel
                    Tickets_ScrollRect_RT.offsetMin = new Vector2(
                        200f,
                        Tickets_ScrollRect_RT.offsetMin.y
                    );
                    Tickets_ScrollRect_RT.offsetMax = new Vector2(
                        -30f,
                        Tickets_ScrollRect_RT.offsetMax.y
                    );
                    Elvis_Tickets_ScrollRect_RT.offsetMin = new Vector2(
                        200f,
                        Tickets_ScrollRect_RT.offsetMin.y
                    );
                    Elvis_Tickets_ScrollRect_RT.offsetMax = new Vector2(
                        -30f,
                        Tickets_ScrollRect_RT.offsetMax.y
                    );

                    //LeanTween.cancel(Panel_Game_Header);
                    //LeanTween.move(Panel_Game_Header.GetComponent<RectTransform>(), new Vector2(Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x - 80f, Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y), 0.25f)
                    //    .setOnComplete(() =>
                    //    {
                    //        // Your code to be executed when the move is complete
                    //        Debug.Log("Closed chat panel!");
                    //    });

                    break;
                case 1: // Opened chat panel
                    Tickets_ScrollRect_RT.offsetMin = new Vector2(
                        200f,
                        Tickets_ScrollRect_RT.offsetMin.y
                    );
                    Tickets_ScrollRect_RT.offsetMax = new Vector2(
                        -400f,
                        Tickets_ScrollRect_RT.offsetMax.y
                    );
                    Elvis_Tickets_ScrollRect_RT.offsetMin = new Vector2(
                        200f,
                        Tickets_ScrollRect_RT.offsetMin.y
                    );
                    Elvis_Tickets_ScrollRect_RT.offsetMax = new Vector2(
                        -400f,
                        Tickets_ScrollRect_RT.offsetMax.y
                    );

                    //LeanTween.cancel(Panel_Game_Header);
                    //LeanTween.move(Panel_Game_Header.GetComponent<RectTransform>(), new Vector2(Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x + 80f, Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y), 0.25f)
                    //    .setOnComplete(() =>
                    //    {
                    //        // Assuming the script is attached to the GameObject with RectTransform
                    //        RectTransform rectTransform = Panel_Game_Header.GetComponent<RectTransform>();

                    //        // Set the left and right values to 0
                    //        rectTransform.offsetMin = new Vector2(0f, rectTransform.offsetMin.y);
                    //        rectTransform.offsetMax = new Vector2(0f, rectTransform.offsetMax.y);
                    //    });

                    break;
            }
        }
    }

    public void ClosePanel()
    {
        UIManager.Instance.game1Panel.Close();
        //if (!UIManager.Instance.multipleGameScreenManager.AnyGameActive())
        //    UIManager.Instance.topBarPanel.OnGamesButtonTap();
        //UIManager.Instance.multipleGameScreenManager.RefreshGridLayoutSize();
        UIManager.Instance.Current_Game_Number = 0;
        /////
        if (Utility.Instance.IsSplitScreenSupported)
        {
            UIManager.Instance.splitScreenGameManager.game1Panel.Close();
            UIManager.Instance.splitScreenGameManager.RefreshSplitScreenFunction();
            if (UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() == 0)
                UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
        else
        {
            UIManager.Instance.game1Panel.Close();
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
    }

    #endregion

    #region PRIVATE_METHODS
    private void HandleLanguageChange()
    {
        GenerateRowDetails(BingoGame1HistoryData.patternList);
        GeneratePatternList(BingoGame1HistoryData.patternList);
        GenerateTicketList(BingoGame1HistoryData.ticketList);
        GenerateWithdrawNumberList(BingoGame1HistoryData.withdrawNumberList);
    }

    private void GenerateRowDetails(List<PatternData> patternList)
    {
        //Row 1
        //Row 2
        //Row 3
        //Row 4
        //Picture
        //Frame
        //Full House

        for (int i = 0; i < PanelRowDetails.Rows.Length; i++)
        {
            PanelRowDetails.Rows[i].gameObject.SetActive(false);
        }
        for (int i = 0; i < PanelRowDetails.RowsDevider.Length; i++)
        {
            PanelRowDetails.RowsDevider[i].gameObject.SetActive(false);
        }

        //Active Devider
        for (int i = 0; i < patternList.Count; i++)
        {
            if (i > 0)
            {
                PanelRowDetails.RowsDevider[i - 1].gameObject.SetActive(true);
            }
        }

        curruntPatternRow = 0;

        if (patternList.Count > 0)
        {
            for (int i = 0; i < patternList.Count; i++)
            {
                int incrementedI = i + 1; // Create a new variable to store the incremented value

                if (patternList[i].isWon)
                {
                    curruntPatternRow = i;
                    curruntPatternRow++;

                    if (
                        patternList[i].name == "Row 1"
                        || patternList[i].name == "Row 2"
                        || patternList[i].name == "Row 3"
                        || patternList[i].name == "Row 4"
                    )
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow")
                            + " "
                            + incrementedI
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }
                    else if (patternList[i].name == "Picture")
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubPicture")
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }
                    else if (patternList[i].name == "Frame")
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubFrame")
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }
                    else if (patternList[i].name == "Full House")
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow")
                            + " 5"
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }
                    else
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow")
                            + " "
                            + incrementedI
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }

                    PanelRowDetails.Rows[i].GetComponent<TextMeshProUGUI>().color =
                        PanelRowDetails.ActiveColour;
                }
                else
                {
                    if (
                        patternList[i].name == "Row 1"
                        || patternList[i].name == "Row 2"
                        || patternList[i].name == "Row 3"
                        || patternList[i].name == "Row 4"
                    )
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow")
                            + " "
                            + incrementedI
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }
                    else if (patternList[i].name == "Picture")
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubPicture")
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }
                    else if (patternList[i].name == "Frame")
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubFrame")
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }
                    else if (patternList[i].name == "Full House")
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow")
                            + " 5"
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }
                    else
                    {
                        PanelRowDetails.Rows[i].text =
                            I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow")
                            + " "
                            + incrementedI
                            + " - "
                            + patternList[i].amount
                            + " kr";
                        PanelRowDetails.Rows[i].gameObject.SetActive(true);
                    }

                    PanelRowDetails.Rows[i].GetComponent<TextMeshProUGUI>().color =
                        PanelRowDetails.DeActiveColour;
                }
            }
        }
        else
        {
            //PanelRowDetails.Close();
        }
    }

    /// <summary>
    /// Remove/Destroy old jackpot list & generate new list
    /// </summary>
    /// <param name="jackpotList"></param>
    private void GeneratePatternList(List<PatternData> patternList)
    {
        //foreach (Transform transform in transformPatternContainer)
        //    Destroy(transform.gameObject);


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
                if (Patterns[i].Pattern_Name == patternList[j].name)
                {
                    CanBeDeleted = false;
                    Patterns[i].Update_Pattern_Amount(patternList[j].amount);
                    patternList.RemoveAt(j);
                    break;
                }
            }
            if (CanBeDeleted)
            {
                if (Patterns[i].gameObject != null)
                    Destroy(Patterns[i].gameObject);
                Patterns.RemoveAt(i);
            }
        }

        if (patternList.Count > 0)
        {
            for (int i = 0; i < patternList.Count; i++)
            {
                if (i == curruntPatternRow)
                {
                    PrefabBingoGame1Pattern newPatternPanel = Instantiate(
                        prefabBingo1PatternPanel,
                        transformPatternContainer
                    );
                    newPatternPanel.SetData(patternList[i], i);
                    Patterns.Add(newPatternPanel);
                }
            }

            for (int i = 1; i < Patterns.Count; i++)
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

        bingoBallPanelManager.WithdrawList(withdrawNumberList, "Game 1");
    }

    private void RunBestCardFirstAction()
    {
        //ticketList.Sort(BingoTicket.ReverseSortBySelectedNumber);

        //for (int i = 0; i < ticketList.Count; i++)
        //    ticketList[i].transform.SetSiblingIndex(i);

        // PrefabBingoGame1Ticket5x5 ticket;
        // for (int i = 1; i < ticketList.Count; i++)
        //     for (int j = 0; j < i; j++)
        //         if (
        //             ticketList[j].Pattern_Remaining_Cell_Count
        //             > ticketList[i].Pattern_Remaining_Cell_Count
        //         )
        //         {
        //             ticketList[j].transform.SetSiblingIndex(i);
        //             ticketList[i].transform.SetSiblingIndex(j);
        //             ticket = ticketList[j];
        //             ticketList[j] = ticketList[i];
        //             ticketList[i] = ticket;
        //         }

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
        bingoBallPanelManager.NewWithdraw(newBingoNumberData, true, "Game 1");
        MarkWithdrawNumbers(newBingoNumberData, true);
        LastWithdrawNumber = newBingoNumberData.number;
    }

    /// <summary>
    /// Mark new withdraw number on all ticket
    /// </summary>
    /// <param name="data"></param>
    private void MarkWithdrawNumbers(BingoNumberData data, bool playSound = false)
    {
        foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
        {
            ticket.MarkNewWithdrawNumber(data.number, true, false, playSound);
            ticket.Set_Togo_Txt_Game1();
        }
        foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
        {
            if (ticket.Pattern_Remaining_Cell_Count == 0)
            {
                foreach (PrefabBingoGame1Ticket5x5 t in ticketList)
                {
                    t.Stop_Blink();
                }
            }
        }
        RunBestCardFirstAction();
    }

    public void HighlightLuckyNumber()
    {
        foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
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
        //Debug.Log("GenerateTicketList : " + ticketDataList.Count);
        foreach (Transform transform in transformTicketContainer)
            Destroy(transform.gameObject);
        ticketList.Clear();
        ticketLargeList.Clear();
        int largeTicketCount = 0;
        var isElvis = UIManager.Instance.game1Panel.Game_1_Data.gameName == "Elvis";
        List<GameTicketData> currentBatch = new List<GameTicketData>();
        List<PrefabBingoGame1Ticket5x5> largeTicketPrefabs = new List<PrefabBingoGame1Ticket5x5>();

        foreach (GameTicketData data in ticketDataList)
        {
            PrefabBingoGame1Ticket5x5 newTicket = Instantiate(
                prefabBingoGame1Ticket5X5,
                transformTicketContainer
            );
            newTicket.SetData(data, markerData);
            newTicket.Game_1_12();
            if (isElvis)
                newTicket.Ticket_Name_Txt.text = data.ticketColor;
            newTicket.Set_Ticket_Color();
            ticketList.Add(newTicket);
            if (newTicket.gameTicketData.IsLargeTicket())
            {
                currentBatch.Add(data);
                largeTicketPrefabs.Add(newTicket);

                if (currentBatch.Count == 3)
                {
                    PrefabBingoGame1Ticket5x5 lastLargeTicket = largeTicketPrefabs[
                        largeTicketPrefabs.Count - 1
                    ];
                    lastLargeTicket.deleteBtn.gameObject.SetActive(
                        !BingoGame1HistoryData.gameStatus.Equals("running")
                    );
                    currentBatch.Clear();
                }
                largeTicketCount++;
            }
            // Handle small tickets
            else if (
                newTicket.gameTicketData.IsSmallTicket()
                && !BingoGame1HistoryData.gameName.Equals("Traffic Light")
            )
            {
                newTicket.deleteBtn.gameObject.SetActive(
                    !BingoGame1HistoryData.gameStatus.Equals("running")
                );
            }
            // Handle traffic light tickets
            else if (BingoGame1HistoryData.gameName.Equals("Traffic Light"))
            {
                currentBatch.Add(data);
                largeTicketPrefabs.Add(newTicket);

                if (currentBatch.Count == 3)
                {
                    PrefabBingoGame1Ticket5x5 lastLargeTicket = largeTicketPrefabs[
                        largeTicketPrefabs.Count - 1
                    ];
                    lastLargeTicket.deleteBtn.gameObject.SetActive(true);
                    currentBatch.Clear();
                }
                largeTicketCount++;
            }
        }
        Upcoming_Game_Purchase_UI.SetActive(ticketList.Count == 0);
        Tickets_Panel.SetActive(true);
        Elvis_Replace_Tickets_Panel.SetActive(false);
        int length = Elvis_Tickets.Count;
        for (int i = 0; i < length; i++)
            Destroy(Elvis_Tickets[i]);
        Elvis_Tickets.Clear();
        if (ticketDataList.Count > 0)
        {
            if (UIManager.Instance.game1Panel.Game_1_Data.gameName == "Elvis")
            {
                Elvis_Game_Tickets(ticketDataList);
                if (UIManager.Instance.game1Panel.Is_Upcoming_Game && !isReplaceDisabled)
                {
                    Tickets_Panel.SetActive(false);
                    Elvis_Replace_Tickets_Panel.SetActive(true);
                    UIManager
                        .Instance
                        .topBarPanel
                        .hallGameListPanel
                        .game1ViewPurchaseTicket
                        .Game_ID = UIManager.Instance.game1Panel.Game_1_Data.gameId;
                    UIManager
                        .Instance
                        .topBarPanel
                        .hallGameListPanel
                        .game1ViewPurchaseTicket
                        .Replace_Amount = Replace_Amount;
                }
                else
                {
                    Elvis_Replace_Tickets_Panel.SetActive(false);
                }
            }
        }
    }

    /// <summary>
     /// Reset/Clear all game data. normally calls on starting game or reconnecting existing game
     /// </summary>
    private void Reset()
    {
        LastWithdrawNumber = 0;
        LuckyNumber = 0;
        TotalRegisteredPlayerCount = 0;

        Game_1_Timer.SetActive(false);
        Game_1_Timer_LBL.SetActive(false);
        bingoBallPanelManager.Reset();
        ticketList.Clear();
        ticketLargeList.Clear();

        Tickets_Panel.SetActive(false);
        Elvis_Replace_Tickets_Panel.SetActive(false);

        foreach (Transform transform in transformPatternContainer)
            Destroy(transform.gameObject);

        foreach (Transform transform in transformTicketContainer)
            Destroy(transform.gameObject);

        UIManager.Instance.withdrawNumberHistoryPanel.Close();
        UIManager.Instance.withdrawNumberHistoryPanel.Reset();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public int LuckyNumber
    {
        set
        {
            _luckeyNumber = value;

            if (value > 0)
                txtLuckeyNumber.text = value.ToString();
            else
                txtLuckeyNumber.text = "";
        }
        get { return _luckeyNumber; }
    }

    public int GameMarkerId
    {
        set
        {
            PlayerPrefs.SetInt("Game_Marker", value);
            _gameMarkerId = value;
            markerData = UIManager.Instance.GetMarkerData(value);
            foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
                ticket.ModifyMarkerDesign(markerData, true);
        }
        get { return _gameMarkerId; }
    }

    public int TotalRegisteredPlayerCount
    {
        set { txtActivePlayers.text = value.ToString("00"); }
    }

    public int TotalBetAmount
    {
        set
        {
            txtTotalBetAmount
                .GetComponent<LocalizationParamsManager>()
                .SetParameterValue("TotalBet", value.ToString());
        }
    }

    public int TotalProfitAmount
    {
        set
        {
            txtTotalProfitAmount
                .GetComponent<LocalizationParamsManager>()
                .SetParameterValue("TotalProfit", value.ToString());
        }
    }

    public int TotalWithdrawCount
    {
        set { txtWithdrawNumberStats.text = value.ToString("00") + "/" + MaxWithdrawCount; }
    }

    public bool EditLuckyNumberEnable
    {
        set
        {
            //Debug.LogError("txtPickLuckyNumber : " + value);
            txtPickLuckyNumber.gameObject.SetActive(value);
            btnSelectLuckyNumber.enabled = value;
        }
    }

    public int MaxWithdrawCount
    {
        set { _maxWithdrawCount = value; }
        get { return _maxWithdrawCount; }
    }

    public int LastWithdrawNumber
    {
        set { txtLastWithdrawNumber.text = value.ToString("00"); }
    }
    #endregion
}
