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

public class Game1GamePlayPanel : MonoBehaviour
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

        if (gameData.gameId != null || gameData.gameId != "")
        {
            EventManager.Instance.UnSubscribeRoom(gameData.namespaceString, gameData.gameId, null);
        }

        UIManager.Instance.withdrawNumberHistoryPanel.Close();
        UIManager.Instance.topBarPanel.GameType = "";
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
        UIManager.Instance.topBarPanel.GameType = gameData.gameName;

        //chatPanel.InitiateChatFeature(gameData);
        changeMarkerBackgroundPanel.Close();
        GameMarkerId = PlayerPrefs.GetInt("Game_Marker", 1);
        selectLuckyNumberPanel.Close();
        UIManager.Instance.Current_Game_Number = 1;
        UIManager.Instance.topBarPanel.hallGameListPanel.gameObject.SetActive(false);
        UIManager.Instance.topBarPanel.hallGameListPanel.game1PurchaseTicket.gameObject.SetActive(
            false
        );

        this.Open();
        DisplayLoader(true);

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

    public void Reconnect()
    {
        UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
        // CallSubscribeRoom();
    }

    public void OnLuckeyNumberTap()
    {
        selectLuckyNumberPanel.Open();
    }

    internal void Close_Panels()
    {
        selectLuckyNumberPanel.Close();
        changeMarkerBackgroundPanel.Close();
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
        DisplayLoader(true); // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.SelectLuckyNumberGame1(
            gameData.namespaceString,
            gameData.gameId,
            luckyNumber,
            (socket, packet, args) =>
            {
                Debug.Log("SelectLuckyNumber response: " + packet.ToString());
                DisplayLoader(false); // UIManager.Instance.DisplayLoader(false);
                EventResponse eventResponse = JsonUtility.FromJson<EventResponse>(
                    Utility.Instance.GetPacketString(packet)
                );

                if (eventResponse.status == Constants.EventStatus.SUCCESS)
                {
                    LuckyNumber = luckyNumber;
                    HighlightLuckyNumber();
                    //selectLuckyNumberPanel.SetLuckyNumber(luckyNumber);
                }
                else
                {
                    LuckyNumber = lastLuckyNumber;
                    //selectLuckyNumberPanel.SetLuckyNumber(lastLuckyNumber);
                    GetUtilityMessagePanel().DisplayMessagePopup(eventResponse.message);
                }
            }
        );
    }

    public void OpenWithdrawNumberHistoryPanel()
    {
        UIManager.Instance.withdrawNumberHistoryPanel.Open();
    }

    public UtilityMessagePanel GetUtilityMessagePanel()
    {
        if (
            loaderPanel
            && Utility.Instance.IsSplitScreenSupported
            && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1
        )
            return messagePopup;
        else
            return UIManager.Instance.messagePopup;
    }

    public void DisplayLoader(bool showLoader)
    {
        if (
            loaderPanel
            && Utility.Instance.IsSplitScreenSupported
            && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1
        )
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

    public void Upcoming_Game1_Ticket_Set_Up_Open()
    {
        //BackButton1.gameObject.SetActive(true);
        //BackButton2.gameObject.SetActive(true);

        if (!Is_AnyGame_Running)
            Upcoming_Game1_Ticket_Set_Up(true);
        else
            Upcoming_Game_Purchase_UI.SetActive(false);
        Btn_Upcoming_Game_Buy_Tickets.interactable =
            UIManager.Instance.game1Panel.Game_1_Data.maxPurchaseTicket
            != UIManager.Instance.game1Panel.Game_1_Data.purchasedTickets;
    }

    public void Upcoming_Game1_Ticket_Set_Up_Close()
    {
        //BackButton1.gameObject.SetActive(false);
        //BackButton2.gameObject.SetActive(false);
        Upcoming_Game_Purchase_UI.SetActive(false);
    }

    internal void Upcoming_Game1_Ticket_Set_Up(bool isforce = false)
    {
        if (!isforce)
        {
            EditLuckyNumberEnable = false;
        }
        buyMoreTicket.interactable = true;
        selectLuckyNumberPanel.ClosePanel();
        int length = Upcoming_Game_Tickets.Count;
        if (length > 0)
        {
            for (int i = 0; i < length; i++)
                Destroy(Upcoming_Game_Tickets[i].gameObject);
            Upcoming_Game_Tickets.Clear();
        }

        if (instantiatedObjects.Count > 0)
        {
            for (int i = 0; i < instantiatedObjects.Count; i++)
                Destroy(instantiatedObjects[i].gameObject);
            instantiatedObjects.Clear();
        }

        length = Upcoming_Game_Data.ticketTypes.Count;
        var localManager = Upcoming_Game_Purchased_Ticket_Txt.GetComponent<LocalizationParamsManager>();
        localManager.SetParameterValue("value", Upcoming_Game_Data.purchasedTickets.ToString());

        Upcoming_Game_Name_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("value", Upcoming_Game_Data.gameName);
        // $"Wait until the <b>{Upcoming_Game_Data.gameName}</b> game starts";
        //Upcoming_Game_Purchased_Ticket_Txt.text = $"{Upcoming_Game_Data.purchasedTickets}";
        Upcoming_Game_Purchase_UI.SetActive(true);
        Game1PurchaseTicketData ticket;
        for (int i = 0; i < length; i++)
        {
            ticket = Instantiate(Upcoming_Game_Ticket_Prefab, Vector3.zero, Quaternion.identity, Upcoming_Game_Ticket_Parent);
            Upcoming_Game_Tickets.Add(ticket);
            ticket.Set_Data(Upcoming_Game_Data.ticketTypes[i], Get_Ticket_Weight(Upcoming_Game_Data.gameType, Upcoming_Game_Data.ticketTypes[i].name)); //Upcoming_Game_Data.ticketTypes[i].name.ToLower().Contains("large") ? 3 : 1);

            GameObject newObject = Instantiate(Prefab_Devider, Vector3.zero, Quaternion.identity, Upcoming_Game_Ticket_Parent);
            instantiatedObjects.Add(newObject);
        }

        //To remove the last instantiated GameObject:
        if (instantiatedObjects.Count > 0)
        {
            GameObject lastObject = instantiatedObjects[instantiatedObjects.Count - 1];
            instantiatedObjects.RemoveAt(instantiatedObjects.Count - 1);
            Destroy(lastObject);
        }

        Upcoming_Game_Purchase_UI.SetActive(false);
        Upcoming_Game_CSF.enabled = false;
        Invoke(nameof(Enable_Upcoming_UI), 0.25f);
    }

    int Get_Ticket_Weight(string game_Type, string ticket_name)
    {
        switch (game_Type)
        {
            default:
                return 1;
            case "traffic-light":
                return 3;
            case "elvis":
                return 2;
            case "color":
                if (ticket_name.ToLower().Contains("large"))
                    return 3;
                return 1;
        }
    }

    void Enable_Upcoming_UI()
    {
        buyMoreTicket.interactable = true;
        Upcoming_Game_Purchase_UI.SetActive(true);
        StartCoroutine(Refresh_Upcoming_UI());
    }

    IEnumerator Refresh_Upcoming_UI()
    {
        Upcoming_Game_CSF.enabled = true;
        yield return new WaitForSeconds(0.1f);
        Upcoming_Game_CSF.enabled = false;
        yield return new WaitForSeconds(0.1f);
        Upcoming_Game_CSF.enabled = true;
    }

    public void Chat_Open_Close_Btn()
    {
        switch (Chat_Panel_State)
        {
            case 0: // Open chat panel
                LeanTween.cancel(chatPanel.gameObject);
                LeanTween.move(
                    Chat_Panel_RT,
                    new Vector2(0f, Chat_Panel_RT.anchoredPosition.y),
                    0.25f
                );

                LeanTween.cancel(Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(
                    Tickets_ScrollRect_RT.gameObject,
                    Set_Ticket_Scroll_Rect_RT,
                    new Vector2(200f, -30f),
                    new Vector2(200f, -400f),
                    0.25f
                );
                LeanTween.cancel(Elvis_Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(
                    Elvis_Tickets_ScrollRect_RT.gameObject,
                    Set_Elvis_Ticket_Scroll_Rect_RT,
                    new Vector2(200f, -30f),
                    new Vector2(200f, -400f),
                    0.25f
                );

                Chat_Open_Close_Icon.eulerAngles = new Vector3(0f, 0f, 180f);
                Chat_Open_Open_Text.SetActive(false);
                Chat_Open_Close_Text.SetActive(true);
                Chat_Panel_State = 1;
                if (Upcoming_Game_Purchase_UI.activeSelf)
                {
                    LeanTween.cancel(Upcoming_Game_Purchase_UI);
                    LeanTween.move(
                        Upcoming_Game_Purchase_UI.GetComponent<RectTransform>(),
                        new Vector2(
                            (-Chat_Panel_RT.rect.width / 2f) + 100f,
                            Upcoming_Game_Purchase_UI
                                .GetComponent<RectTransform>()
                                .anchoredPosition.y
                        ),
                        0.25f
                    );
                }

                if (Panel_Game_Header.activeSelf)
                {
                    LeanTween.cancel(Panel_Game_Header);
                    LeanTween
                        .move(
                            Panel_Game_Header.GetComponent<RectTransform>(),
                            new Vector2(
                                Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x
                                    - 80,
                                Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y
                            ),
                            0.25f
                        )
                        .setOnComplete(() =>
                        {
                            // Assuming the script is attached to the GameObject with RectTransform
                            RectTransform rectTransform =
                                Panel_Game_Header.GetComponent<RectTransform>();

                            // Set the left and right values to 0
                            rectTransform.offsetMin = new Vector2(0f, rectTransform.offsetMin.y);
                            rectTransform.offsetMax = new Vector2(0f, rectTransform.offsetMax.y);
                        });
                }
                break;
            case 1: // Close chat panel
                LeanTween.cancel(chatPanel.gameObject);
                LeanTween.move(
                    Chat_Panel_RT,
                    new Vector2(Chat_Panel_RT.rect.width * 3f, Chat_Panel_RT.anchoredPosition.y),
                    0.25f
                );
                LeanTween.cancel(Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(
                    Tickets_ScrollRect_RT.gameObject,
                    Set_Ticket_Scroll_Rect_RT,
                    new Vector2(200f, -400f),
                    new Vector2(200f, -30f),
                    0.25f
                );
                LeanTween.cancel(Elvis_Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(
                    Elvis_Tickets_ScrollRect_RT.gameObject,
                    Set_Elvis_Ticket_Scroll_Rect_RT,
                    new Vector2(200f, -400f),
                    new Vector2(200f, -30f),
                    0.25f
                );
                Chat_Open_Close_Icon.eulerAngles = Vector3.zero;
                Chat_Open_Open_Text.SetActive(true);
                Chat_Open_Close_Text.SetActive(false);
                Chat_Panel_State = 0;
                if (Upcoming_Game_Purchase_UI.activeSelf)
                {
                    LeanTween.cancel(Upcoming_Game_Purchase_UI);
                    LeanTween.move(
                        Upcoming_Game_Purchase_UI.GetComponent<RectTransform>(),
                        new Vector2(
                            100f,
                            Upcoming_Game_Purchase_UI
                                .GetComponent<RectTransform>()
                                .anchoredPosition.y
                        ),
                        0.25f
                    );
                }

                if (Panel_Game_Header.activeSelf)
                {
                    LeanTween.cancel(Panel_Game_Header);
                    LeanTween
                        .move(
                            Panel_Game_Header.GetComponent<RectTransform>(),
                            new Vector2(
                                Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x
                                    + 80f,
                                Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y
                            ),
                            0.25f
                        )
                        .setOnComplete(() => { });
                }

                break;
        }
    }

    void Set_Ticket_Scroll_Rect_RT(Vector2 size)
    {
        Tickets_ScrollRect_RT.offsetMin = new Vector2(size.x, Tickets_ScrollRect_RT.offsetMin.y);
        Tickets_ScrollRect_RT.offsetMax = new Vector2(size.y, Tickets_ScrollRect_RT.offsetMax.y);
    }

    void Set_Elvis_Ticket_Scroll_Rect_RT(Vector2 size)
    {
        Elvis_Tickets_ScrollRect_RT.offsetMin = new Vector2(
            size.x,
            Elvis_Tickets_ScrollRect_RT.offsetMin.y
        );
        Elvis_Tickets_ScrollRect_RT.offsetMax = new Vector2(
            size.y,
            Elvis_Tickets_ScrollRect_RT.offsetMax.y
        );
    }

    #endregion

    #region BROADCAST_HANDLING
    /// <summary>
    /// Enable all required broadcasts, which is usefull for game play
    /// </summary>
    private void EnableBroadcasts()
    {
        //Debug.Log("Game 1 namespace: " + GameSocketManager.SocketGame1.Namespace);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.SubscribeRoom, OnSubscribeRoom);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.UpdatePlayerRegisteredCount, OnUpdatePlayerRegisteredCount);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.countDownToStartTheGame, OnCountDownToStartTheGame);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameStartWaiting, OnGameStartWaiting);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameStart, OnGameStart);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.WithdrawBingoBall, OnWithdrawBingoBall);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.PatternChange, OnPatternChange);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.PatternCompleted, OnPatternCompleted);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameFinish, OnGameFinish);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameTerminate, OnGameTerminate);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.ActivateMiniGame, OnActivateMiniGame);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameRefreshRoom, On_Game_1_Refresh_Room);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.toggleGameStatus, On_Game_1_toggleGameStatus);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.nextGameStartCountDownTime, OnnextGameStartCountDownTime);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.BingoAnnouncement, OnBingoAnnouncement);
    }

    /// <summary>
    /// Disable all broadcasts
    /// </summary>
    private void DisableBroadcasts()
    {
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.SubscribeRoom);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.UpdatePlayerRegisteredCount);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.countDownToStartTheGame);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameStartWaiting);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameStart);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.WithdrawBingoBall);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.PatternChange);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.PatternCompleted);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameFinish);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameTerminate);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.ActivateMiniGame);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameRefreshRoom);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.SelectMysteryBall);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.toggleGameStatus);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.nextGameStartCountDownTime);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.BingoAnnouncement);
    }

    void OnBingoAnnouncement(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnBingoAnnouncement: " + packet.ToString());
        BingoAnnouncementResponse bingoAnnouncementResponse = JsonUtility.FromJson<BingoAnnouncementResponse>(Utility.Instance.GetPacketString(packet));
        // if (bingoAnnouncementResponse != null)
        // {
        SoundManager.Instance.BingoSound(false);
        // AddNewBingoWinningData(data);
        // bingoBallPanelManager.DisplayBigBallOnWin(true, false, false);
        // }
    }

    private void OnnextGameStartCountDownTime(Socket socket, Packet packet, object[] args)
    {
        Debug.LogError("nextGameStartCountDownTime : " + packet.ToString());

        NextGameData data = JsonUtility.FromJson<NextGameData>(
            Utility.Instance.GetPacketString(packet)
        );

        string utcDateTimeStr = data.countDownTime;
        Debug.LogError("Raw UTC DateTime String: " + utcDateTimeStr);
        // Check if the string is null or empty
        if (!string.IsNullOrEmpty(utcDateTimeStr))
        {
            try
            {
                DateTimeOffset utcDateTime;
                if (
                    DateTimeOffset.TryParse(
                        utcDateTimeStr,
                        null,
                        System.Globalization.DateTimeStyles.RoundtripKind,
                        out utcDateTime
                    )
                )
                {
                    Game_1_Timer.SetActive(true);
                    DateTime localDateTime = utcDateTime.LocalDateTime;
                    Debug.LogError(
                        "Local DateTime: " + localDateTime.ToString("yyyy-MM-dd HH:mm:ss")
                    );
                    nextGameTimer = StartCoroutine(StartCountdown(localDateTime));
                }
                else
                {
                    Debug.LogError("Invalid date format: " + utcDateTimeStr);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("Error parsing date: " + ex.Message);
            }
        }
        else
        {
            Debug.LogError("Error: countDownDateTime is null or empty.");
        }
    }

    IEnumerator StartCountdown(DateTime targetTime)
    {
        while (true)
        {
            DateTime currentLocalTime = DateTime.Now;
            TimeSpan timeRemaining = targetTime - currentLocalTime;

            if (timeRemaining.TotalSeconds <= 0)
            {
                Game_1_Timer.SetActive(false);
                //Debug.Log("Countdown finished!");
                Game_1_Timer_Txt.text = "00:00:00";
                yield break;
            }
            //Debug.Log($"Time remaining: {timeRemaining.Hours:D2}:{timeRemaining.Minutes:D2}:{timeRemaining.Seconds:D2}");
            Game_1_Timer_Txt.text = $"{timeRemaining.Minutes:D2}:{timeRemaining.Seconds:D2}";
            yield return new WaitForSeconds(1f);
        }
    }

    private void OnSubscribeRoom(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnSubscribeRoom: " + packet.ToString());

        BingoGame1History BingoGame1HistoryResp = JsonUtility.FromJson<BingoGame1History>(Utility.Instance.GetPacketString(packet));
        this.BingoGame1HistoryData = BingoGame1HistoryResp;
        UIManager.Instance.BingoButtonColor(BingoGame1HistoryData.isGamePaused);
        if (BingoGame1HistoryData.isGamePaused)
        {
            // SoundManager.Instance.BingoSound();
            // GetUtilityMessagePanel().DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
        }

        if (BingoGame1HistoryData.gameId != this.gameData.gameId)
        {
            isTimerRecieved = false;
            SoundManager.Instance.ResetPlayedAnnouncements();
            return;
        }
        CallPlayerHallLimitEvent();
        UIManager.Instance.gameAssetData.PreviousGameId = gameData.gameId;
        Reset();
        EditLuckyNumberEnable = BingoGame1HistoryData.editLuckyNumber;
        LuckyNumber = BingoGame1HistoryData.luckyNumber;
        TotalRegisteredPlayerCount = BingoGame1HistoryData.activePlayers;
        TotalBetAmount = BingoGame1HistoryData.totalBetAmount;
        TotalProfitAmount = BingoGame1HistoryData.totalWon;
        MaxWithdrawCount = BingoGame1HistoryData.maxWithdrawCount;
        TotalWithdrawCount = BingoGame1HistoryData.totalWithdrawCount;
        Replace_Amount = BingoGame1HistoryData.replaceAmount;
        BuyMoreDisableFlagVal = BingoGame1HistoryData.disableBuyAfterBalls;
        isReplaceDisabled = BingoGame1HistoryData.isReplaceDisabled;
        //PanelRowDetails.txtGameName.text = /*Spill 12: Jackpot  */ "Game "+ BingoGame1History.gameCount +": " +BingoGame1History.gameName;
        PanelRowDetails
            .txtGameName.GetComponent<LocalizationParamsManager>()
            .SetParameterValue("gameNumber", BingoGame1HistoryData.gameCount.ToString());
        PanelRowDetails
            .txtGameName.GetComponent<LocalizationParamsManager>()
            .SetParameterValue("gameName", BingoGame1HistoryData.gameName.ToString());
        GenerateTicketList(BingoGame1HistoryData.ticketList);
        jackpotUpdateDataUpdate(BingoGame1HistoryData.jackPotData);

        string utcDateTimeStr = BingoGame1HistoryData.countDownDateTime;
        Debug.LogError("Raw UTC DateTime String: " + utcDateTimeStr);
        // Check if the string is null or empty
        if (!string.IsNullOrEmpty(utcDateTimeStr))
        {
            try
            {
                DateTimeOffset utcDateTime;
                if (
                    DateTimeOffset.TryParse(
                        utcDateTimeStr,
                        null,
                        System.Globalization.DateTimeStyles.RoundtripKind,
                        out utcDateTime
                    )
                )
                {
                    DateTime localDateTime = utcDateTime.LocalDateTime;
                    Debug.LogError(
                        "Local DateTime: " + localDateTime.ToString("yyyy-MM-dd HH:mm:ss")
                    );
                    Game_1_Timer.SetActive(true);
                    nextGameTimer = StartCoroutine(StartCountdown(localDateTime));
                }
                else
                {
                    Debug.LogError("Invalid date format: " + utcDateTimeStr);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("Error parsing date: " + ex.Message);
            }
        }
        else
        {
            Debug.LogError("Error: countDownDateTime is null or empty.");
        }

        for (int i = Patterns.Count - 1; i > -1; i--)
            if (Patterns[i] != null)
                Destroy(Patterns[i].gameObject);
        Patterns.Clear();

        GenerateRowDetails(BingoGame1HistoryData.patternList);
        GeneratePatternList(BingoGame1HistoryData.patternList);
        GenerateWithdrawNumberList(BingoGame1HistoryData.withdrawNumberList);

        selectLuckyNumberPanel.GenerateLuckyNumbers(BingoGame1HistoryData.luckyNumber);
        HighlightLuckyNumber();
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(
            BingoGame1HistoryData.withdrawNumberList
        );
        //chatPanel.InitiateChatFeature(gameData);
        chatPanel.InitiateChatFeatureSubGame(
            UIManager.Instance.game1Panel.Game_1_Data.gameId,
            "Game1"
        );
        GameMarkerId = GameMarkerId;
        DisplayLoader(false); // UIManager.Instance.DisplayLoader(false);

        if (!Is_AnyGame_Running)
        {
            if (BingoGame1HistoryData.ticketList.Count == 0)
            {
                //buyMoreTicket.interactable = false;
                //BackButton1.gameObject.SetActive(false);
                //BackButton2.gameObject.SetActive(false);
                if (BingoGame1HistoryData.isTestGame)
                {
                    Upcoming_Game_Purchase_UI.SetActive(false);
                    buyMoreTicket.interactable = false;
                }
                else
                {
                    Upcoming_Game1_Ticket_Set_Up();
                }
            }
            else
            {
                buyMoreTicket.interactable = true;
                Upcoming_Game_Purchase_UI.SetActive(false);
            }
        }
        else
        {
            buyMoreTicket.interactable = false;
            Upcoming_Game_Purchase_UI.SetActive(false);
        }

        if (BingoGame1HistoryData.gameStatus == "running")
        {
            isTimerRecieved = true;
        }
        else
        {
            isTimerRecieved = false;
        }

        if (BingoGame1HistoryData.gameStatus == "Finished")
        {
            bool isPlayerTurn =
                BingoGame1HistoryData.minigameData.playerId
                == UIManager.Instance.gameAssetData.PlayerId;
            bool isMystery =
                BingoGame1HistoryData.gameName == "Mystery"
                || BingoGame1HistoryData.minigameData.gameName == "Mystery";
            bool isColorDraft =
                BingoGame1HistoryData.gameName == "Color Draft"
                || BingoGame1HistoryData.minigameData.gameName == "Color Draft";

            if (isMystery)
            {
                mysteryGamePanel.isForceReset = false;
                mysteryGamePanel.Can_Click_On_Box = isPlayerTurn;
                CallMysteryGameEvent();
                return;
            }

            if (isColorDraft)
            {
                colorDraftGamePanel.isForceReset = false;
                colorDraftGamePanel.Can_Click_On_Door = isPlayerTurn;
                CallColorDraftGameEvent();
                return;
            }

            if (BingoGame1HistoryData.minigameData.isMinigameActivated)
            {
                string gameName = BingoGame1HistoryData.minigameData.gameName;
                bool isMinigamePlayed = BingoGame1HistoryData.minigameData.isMinigamePlayed;
                bool isMinigameFinished = BingoGame1HistoryData.minigameData.isMinigameFinished;
                int turnTimer = (isMinigamePlayed && !isMinigameFinished) ? 0 : BingoGame1HistoryData.minigameData.turnTimer;
                bool isWofSpinStopped =
                    isMinigamePlayed
                    && isMinigameFinished
                    && BingoGame1HistoryData.minigameData.isWofSpinStopped;

                switch (gameName)
                {
                    case "Wheel of Fortune":
                        // wheelOfFortunePanel.Can_Spin = isPlayerTurn;
                        // wheelOfFortunePanel.ReconnectOpen(GameSocketManager.SocketGame1, gameData.gameId, BingoGame1History.minigameData.prizeList, turnTimer, BingoGame1History.minigameData.wonAmount, BingoGame1History.isGamePaused, BingoGame1History.pauseGameMessage, UIManager.Instance.game1Panel.BackgroundSprite, LocalizationManager.GetTranslation("Game 1"), isWofSpinStopped);
                        // fortuneWheelManager.Can_Spin = isPlayerTurn;
                        // fortuneWheelManager.ReconnectOpen(GameSocketManager.SocketGame1, BingoGame1History, gameData.gameId, BingoGame1History.minigameData.prizeList, turnTimer, BingoGame1History.minigameData.wonAmount, BingoGame1History.isGamePaused, BingoGame1History.pauseGameMessage, UIManager.Instance.game1Panel.BackgroundSprite, LocalizationManager.GetTranslation("Game 1"), isWofSpinStopped);
                        newFortuneWheelManager.Can_Spin = isPlayerTurn;
                        newFortuneWheelManager.ReconnectOpen(GameSocketManager.SocketGame1, BingoGame1HistoryData, gameData.gameId, BingoGame1HistoryData.minigameData.prizeList, turnTimer, BingoGame1HistoryData.minigameData.wonAmount, BingoGame1HistoryData.isGamePaused, BingoGame1HistoryData.pauseGameMessage, UIManager.Instance.game1Panel.BackgroundSprite, LocalizationManager.GetTranslation("Game 1"), BingoGame1HistoryData.minigameData.isWofSpinStopped);
                        break;
                    case "Treasure Chest":
                        treasureChestPanel.Can_Click_On_Box = isPlayerTurn;
                        treasureChestPanel.ReconnectOpen(GameSocketManager.SocketGame1, gameData.gameId, BingoGame1HistoryData.minigameData.prizeList, turnTimer, BingoGame1HistoryData.minigameData.wonAmount, BingoGame1HistoryData.isGamePaused, BingoGame1HistoryData.pauseGameMessage, UIManager.Instance.game1Panel.BackgroundSprite, LocalizationManager.GetTranslation("Game 1"), BingoGame1HistoryData.minigameData.showAutoTurnCount, BingoGame1HistoryData.minigameData.isMinigamePlayed);
                        break;
                    default:
                        return;
                }
            }
        }

    }

    void CallPlayerHallLimitEvent()
    {
        EventManager.Instance.PlayerHallLimit((socket, packet, args) =>
        {
            Debug.Log("PlayerHallLimit: " + packet.ToString());
            EventResponse<PlayerApprovedHallsResponse> response = JsonUtility.FromJson<EventResponse<PlayerApprovedHallsResponse>>(Utility.Instance.GetPacketString(packet));
            if (response.status == Constants.EventStatus.SUCCESS)
            {
                UIManager.Instance.topBarPanel.SetSwitchHallDropdown(response.result.approvedHalls);
            }
            else
            {
                Debug.Log("PlayerHallLimit: " + response.message);
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        });
    }

    private void OnUpdatePlayerRegisteredCount(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"UpdatePlayerRegisteredCount: {packet}");
        PlayerRegisteredCount data = JsonUtility.FromJson<PlayerRegisteredCount>(
            Utility.Instance.GetPacketString(packet)
        );

        TotalRegisteredPlayerCount = data.playerRegisteredCount;
    }

    private void OnGameStartWaiting(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameStartWaiting: " + packet.ToString());
        SoundManager.Instance.ResetPlayedAnnouncements();
    }

    public bool isTimerRecieved = false;

    private void OnCountDownToStartTheGame(Socket socket, Packet packet, object[] args)
    {
        if (nextGameTimer != null)
            StopCoroutine(nextGameTimer);
        Debug.Log("OncountDownToStartTheGame: " + packet.ToString());

        Game1_Timer data = JsonUtility.FromJson<Game1_Timer>(
            Utility.Instance.GetPacketString(packet)
        );

        if (data.gameId != UIManager.Instance.game1Panel.Game_1_Data.gameId)
            return;
        SoundManager.Instance.ResetPlayedAnnouncements();
        isTimerRecieved = true;
        Game_1_Timer_Txt.text = data.count.ToTime();
        Game_1_Timer.SetActive(true);
        Game_1_Timer_LBL.SetActive(true);
        if (data.count == 0)
        {
            LastWithdrawNumber = 0;
            Game_1_Timer.SetActive(false);
            Game_1_Timer_LBL.SetActive(false);
            isWithdraw = false;
        }

        if (UIManager.Instance.game1Panel.Game_1_Data.gameName == "Elvis")
        {
            Tickets_Panel.SetActive(true);
            Elvis_Replace_Tickets_Panel.SetActive(false);
        }
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
        foreach (var cs in Elvis_Tickets)
        {
            Game1ViewPurchaseElvisTicket ticket = cs.GetComponent<Game1ViewPurchaseElvisTicket>();
            ticket.deleteBtn.gameObject.SetActive(false);
        }
    }

    private void OnGameStart(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameStart: " + packet.ToString());
        SoundManager.Instance.ResetPlayedAnnouncements();
        onGameStart = true;
        selectLuckyNumberPanel.ClosePanel();
        EditLuckyNumberEnable = false;
        Upcoming_Game_Purchase_UI.SetActive(false);
        isTimerRecieved = true;
        LastWithdrawNumber = 0;
        Game_1_Timer.SetActive(false);
        Game_1_Timer_LBL.SetActive(false);
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
        if (UIManager.Instance.game1Panel.Game_1_Data.gameName == "Elvis")
        {
            Tickets_Panel.SetActive(true);
            Elvis_Replace_Tickets_Panel.SetActive(false);
        }
        foreach (var cs in Elvis_Tickets)
        {
            Game1ViewPurchaseElvisTicket ticket = cs.GetComponent<Game1ViewPurchaseElvisTicket>();
            ticket.deleteBtn.gameObject.SetActive(false);
        }
    }

    public BingoNumberData bingoNumberData;
    bool isWithdraw = false;

    private void OnWithdrawBingoBall(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnWithdrawBingoBall: " + packet.ToString());

        BingoNumberData bingoNumberData = JsonUtility.FromJson<BingoNumberData>(
            Utility.Instance.GetPacketString(packet)
        );
        this.bingoNumberData = bingoNumberData;
        isWithdraw = true;
        TotalWithdrawCount = bingoNumberData.totalWithdrawCount;
        if (bingoNumberData.isForPlayerApp)
        {
            WithdrawBingoBallAction(bingoNumberData);
            UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(bingoNumberData);
            //SoundManager.Instance.PlayNumberAnnouncement(bingoNumberData.number, true);
            if (UIManager.Instance.gameAssetData.isVoiceOn == 1)
            {
                if (UIManager.Instance.gameAssetData.selectedVoiceLanguage == 0)
                {
                    SoundManager.Instance.Game1PlayNorwegianMaleNumberAnnouncement(bingoNumberData.number, false);
                }
                else if (UIManager.Instance.gameAssetData.selectedVoiceLanguage == 1)
                {
                    SoundManager.Instance.PlayNorwegianFemaleNumberAnnouncement(bingoNumberData.number, false);
                }
                else
                {
                    SoundManager.Instance.PlayNumberAnnouncement(bingoNumberData.number, true);

                }
            }
        }

        // Assuming that withdrawNumberList is accessible from BingoGame1History
        BingoGame1HistoryData.withdrawNumberList.Add(bingoNumberData);

        if (bingoNumberData.totalWithdrawCount == BuyMoreDisableFlagVal)
        {
            buyMoreTicket.interactable = false;
            Upcoming_Game1_Ticket_Set_Up_Close();
        }
        isTimerRecieved = true;

        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
        isWithdraw = false;
    }

    private void OnWithdrawBingoBallReset()
    {
        Debug.LogError("OnWithdrawBingoBallReset");
    }

    private void OnSampleWithdrawBingoBall(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnWithdrawBingoBall: " + packet.ToString());

        BingoNumberData bingoNumberData = JsonUtility.FromJson<BingoNumberData>(
            Utility.Instance.GetPacketString(packet)
        );

        TotalWithdrawCount = bingoNumberData.totalWithdrawCount;
        WithdrawBingoBallAction(bingoNumberData);
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(bingoNumberData);
        SoundManager.Instance.PlayNumberAnnouncement(bingoNumberData.number, true);

        // Assuming that withdrawNumberList is accessible from BingoGame1History
        BingoGame1HistoryData.withdrawNumberList.Add(bingoNumberData);

        if (bingoNumberData.totalWithdrawCount == BuyMoreDisableFlagVal)
        {
            buyMoreTicket.interactable = false;
            Upcoming_Game1_Ticket_Set_Up_Close();
        }
    }

    internal void Change_Profile_Pic(string playerID)
    {
        chatPanel.UpdatePlayerProfile(playerID);
    }

    private void OnPatternChange(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPatternChange: " + packet.ToString());
        PatternChangeResponse patternList = JsonUtility.FromJson<PatternChangeResponse>(
            Utility.Instance.GetPacketString(packet)
        );
        BingoGame1HistoryData.patternList = patternList.patternList;
        GenerateRowDetails(patternList.patternList);
        GeneratePatternList(patternList.patternList);
        jackpotUpdateDataUpdate(patternList.jackPotData);

        foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
        {
            ticket.Stop_Blink();
            foreach (BingoTicketSingleCellData item in ticket.ticketCellList)
            {
                item.Stop_NumberBlink();
            }
        }
    }

    private void jackpotUpdateDataUpdate(JackPotData jackPotData)
    {
        PanelRowDetails.JackpotObject.SetActive(jackPotData.isDisplay);
        PanelRowDetails.txtJackpotDetails.text = jackPotData.isDisplay
            ? $"{jackPotData.draw} Jackpot : {jackPotData.winningAmount} kr"
            : "No Jackpot Data";
    }

    private void OnPatternCompleted(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPatternCompleted: " + packet.ToString());
        PatternCompletedResponse ticketData = JsonUtility.FromJson<PatternCompletedResponse>(
            Utility.Instance.GetPacketString(packet)
        );
        TotalProfitAmount = ticketData.totalWon;

        if (ticketData.gameId != this.gameData.gameId)
            return;
        else if (ticketData.ticketList.Count == 0)
            return;

        foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
        {
            ticket.Stop_Blink();
            foreach (BingoTicketSingleCellData item in ticket.ticketCellList)
            {
                item.Stop_NumberBlink();
            }
        }

        List<PatternCompletedData> fullHouseWonList = new List<PatternCompletedData>();
        List<PatternCompletedData> patternWonList = new List<PatternCompletedData>();

        PrefabBingoGame1Ticket5x5 wonTicket;
        foreach (PatternCompletedData ticketWonData in ticketData.ticketList)
        {
            wonTicket = GetTicketById(ticketWonData.ticketId);
            if (wonTicket == null)
                continue;

            if (ticketWonData.fullHouse)
            {
                fullHouseWonList.Add(ticketWonData);
                wonTicket.TicketCompleted = true;
            }
            else
            {
                wonTicket.PatternWonResult = ticketWonData.patternName;
                //patternWonList.Add(ticketWonData);
            }
            // wonTicket.Start_Blink();
            wonTicket.Togo_Txt.text = ticketWonData.patternName;
        }

        //if (patternWonList.Count > 0)
        //{
        //    string message = "";
        //    int index = 0;
        //    int lastIndex = patternWonList.Count - 1;

        //    foreach (PatternCompletedData ticketPatternWonData in patternWonList)
        //    {
        //        if (index == 0)
        //            message = "You have won ";
        //        else if (index < lastIndex)
        //            message += ", ";
        //        else if (index == lastIndex)
        //            message += " & ";

        //        message += ticketPatternWonData.patternName + " on ticket number " + ticketPatternWonData.ticketNumber;

        //        if (index == lastIndex)
        //            message += ".";

        //        index++;
        //    }
        //    UIManager.Instance.DisplayNotificationUpperTray(message);
        //}

        if (fullHouseWonList.Count > 0)
        {
            string message = "";
            int index = 0;
            int lastIndex = fullHouseWonList.Count - 1;

            foreach (PatternCompletedData ticketFullHouseWonData in fullHouseWonList)
            {
                if (index == 0)
                    message =
                        Constants.LanguageKey.CongratulationsMessage
                        + " "
                        + ticketFullHouseWonData.patternName
                        + " "
                        + Constants.LanguageKey.TicketNumberMessage;
                else if (index < lastIndex)
                    message += ", ";
                else if (index == lastIndex)
                    message += " & ";

                message += ticketFullHouseWonData.ticketNumber;

                if (index == lastIndex)
                    message += ".";

                index++;
            }
            UIManager.Instance.LaunchWinningAnimation();
        }
        else
        {
            UIManager.Instance.LaunchWinningAnimation();
        }
    }

    private void OnGameFinish(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameFinish: " + packet.ToString());
        BingoGameFinishResponse bingoGameFinishResponse =
            JsonUtility.FromJson<BingoGameFinishResponse>(Utility.Instance.GetPacketString(packet));

        if (bingoGameFinishResponse.gameId != this.gameData.gameId)
            return;

        onGameStart = false;
        for (int i = 0; i < ticketList.Count; i++)
        {
            if (ticketList[i].Blink_Tween != null)
                ticketList[i].Stop_Blink();

            foreach (BingoTicketSingleCellData item in ticketList[i].ticketCellList)
            {
                item.Stop_NumberBlink();
            }
        }
        SoundManager.Instance.ResetPlayedAnnouncements();
        isTimerRecieved = false;
        ////if (bingoGameFinishResponse.message != "")
        ////    GetUtilityMessagePanel().DisplayMessagePopup(bingoGameFinishResponse.message);
        BackgroundManager.Instance.PlayerUpdateIntervalCall();
    }

    private void OnGameTerminate(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameTerminate: " + packet.ToString());

        GameTerminateResponse gameTerminateResponse = JsonUtility.FromJson<GameTerminateResponse>(
            Utility.Instance.GetPacketString(packet)
        );

        if (gameTerminateResponse.gameId != this.gameData.gameId)
            return;
        onGameStart = false;
        if (Utility.Instance.IsStandAloneVersion())
            ClosePanel();
        else
            UIManager.Instance.topBarPanel.OnGamesButtonTap();

        ////if (gameTerminateResponse.message.Length > 0)
        ////    GetUtilityMessagePanel().DisplayMessagePopup(gameTerminateResponse.message);
    }

    private void OnActivateMiniGame(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnActivateMiniGame: " + packet.ToString());

        ActivateMiniGameResponse miniGameData = JsonUtility.FromJson<ActivateMiniGameResponse>(
            Utility.Instance.GetPacketString(packet)
        );

        if (miniGameData.gameId != this.gameData.gameId)
            return;

        switch (miniGameData.miniGameType)
        {
            case "wheelOfFortune":
                // wheelOfFortunePanel.isPaused = false;
                // wheelOfFortunePanel.Can_Spin = miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                // fortuneWheelManager.isPaused = false;
                // fortuneWheelManager.Can_Spin = miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                newFortuneWheelManager.isPaused = false;
                newFortuneWheelManager.Can_Spin = miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                CallWheelOfFortuneEvent();
                break;
            case "treasureChest":
                treasureChestPanel.isPaused = false;
                treasureChestPanel.Can_Click_On_Box =
                    miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                CallTreasureChestEvent();
                break;
            case "Mystery":
                mysteryGamePanel.isPaused = false;
                mysteryGamePanel.Can_Click_On_Box =
                    miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                CallMysteryGameEvent();
                break;
            case "Color Draft":
                colorDraftGamePanel.isPaused = false;
                colorDraftGamePanel.Can_Click_On_Door =
                    miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                CallColorDraftGameEvent();
                break;
        }
    }

    void On_Game_1_Refresh_Room(Socket socket, Packet packet, object[] args)
    {
        Debug.LogError(" On_Game_1_Refresh_Room: " + packet.ToString());
        //RefreshRoom res = JsonUtility.FromJson<RefreshRoom>(Utility.Instance.GetPacketString(packet));

        //if (res.gameId != UIManager.Instance.game1Panel.Game_1_Data.gameId)
        //    return;
        isGameRefreshed = true;
        UIManager.Instance.messagePopup.OnCloseButtonTap();
        UIManager.Instance.lobbyPanel.gamePlanPanel.Game1(false);
    }

    void On_Game_1_toggleGameStatus(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("On_Game_1_toggleGameStatus: " + packet.ToString());
        toggleGameStatus res = JsonUtility.FromJson<toggleGameStatus>(
            Utility.Instance.GetPacketString(packet)
        );

        if (res.status.Equals("Pause"))
        {
            if (!res.bySystem && !res.isPauseWithoutAnnouncement)
            {
                UIManager.Instance.BingoButtonColor(true);
                SoundManager.Instance.BingoSound(true);
            }
            newFortuneWheelManager.isPaused = true;
            treasureChestPanel.isPaused = true;
            mysteryGamePanel.isPaused = true;
            colorDraftGamePanel.isPaused = true;
            // SoundManager.Instance.BingoSound(true);
            // GetUtilityMessagePanel().DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
        }
        else if (res.status.Equals("Resume"))
        {
            UIManager.Instance.BingoButtonColor(false);
            newFortuneWheelManager.isPaused = false;
            treasureChestPanel.isPaused = false;
            mysteryGamePanel.isPaused = false;
            colorDraftGamePanel.isPaused = false;
            // GetUtilityMessagePanel().DisplayMessagePopupAutoHide(Constants.LanguageKey.GameResumedByAdminMessage, true);
        }
        else
        {
            newFortuneWheelManager.isPaused = false;
            treasureChestPanel.isPaused = false;
            mysteryGamePanel.isPaused = false;
            colorDraftGamePanel.isPaused = false;
            // GetUtilityMessagePanel().DisplayMessagePopupAutoHide(Constants.LanguageKey.GameResumedByAdminMessage, true);
        }
    }

    #endregion

    #region PRIVATE_METHODS
    /// <summary>
    /// Emit subscribe room event
    /// </summary>
    public void CallSubscribeRoom()
    {
        DisplayLoader(true); // UIManager.Instance.DisplayLoader(true);
        //print($"{UIManager.Instance.game1Panel.Game_1_Data.gameId == null} : gameid");
        //print($"{UIManager.Instance.gameAssetData.PreviousGameId == null} : pre gameid");
        EventManager.Instance.SubscribeRoomGame1(
            UIManager.Instance.game1Panel.Game_1_Data.gameId,
            UIManager.Instance.gameAssetData.PreviousGameId,
            (socket, packet, args) =>
            {
                Debug.Log("SubscribeRoom Emit Response: " + packet.ToString());

                EventResponse response = JsonUtility.FromJson<EventResponse>(
                    Utility.Instance.GetPacketString(packet)
                );
                // CallPlayerHallLimitEvent();
                if (response.status == Constants.EventStatus.FAIL) // && response.messageType == Constants.MessageType.SomethingWentWrong)
                {
                    DisplayLoader(false);
                    GetUtilityMessagePanel().DisplayMessagePopup(response.messageType);
                    UIManager.Instance.topBarPanel.OnGamesButtonTap();
                    return;
                }
                DisableBroadcasts();
                EnableBroadcasts();
            }
        );
    }

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

    void Elvis_Game_Tickets(List<GameTicketData> tickets)
    {
        int length = tickets.Count;
        List<View_Ticket_Data> mini_tickets = new List<View_Ticket_Data>();
        for (int i = 0; i < length; i += 2)
        {
            Elvis_Ticket = Instantiate(View_Elvis_Tickets_Prefab, View_Ticket_Parent);
            mini_tickets.Clear();
            for (int j = 0; j < 2; j++)
                mini_tickets.Add(
                    new View_Ticket_Data(
                        tickets[i + j].id,
                        tickets[i + j].ticketNumber,
                        int.Parse(tickets[i + j].ticketPrice),
                        tickets[i + j].ticketCellNumberList
                    )
                );
            Elvis_Ticket.Set_Data(
                mini_tickets,
                TicketColorManager.Instance.Get_Ticket_Color(tickets[i].ticketColor),
                tickets[i].ticketColor,
                Replace_Amount
            );
            Elvis_Tickets.Add(Elvis_Ticket.gameObject);
        }
    }

    private PrefabBingoGame1Ticket5x5 GetTicketById(string ticketId)
    {
        foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
        {
            if (ticket.TicketId == ticketId)
                return ticket;
        }

        return null;
    }

    //private void CallWheelOfFortuneEvent()
    //{
    //    DisplayLoader(true); // UIManager.Instance.DisplayLoader(true);
    //    EventManager.Instance.WheelOfFortuneData(GameSocketManager.SocketGame1, gameData.gameId, WheelOfFortuneDataResponse);
    //}

    private void CallWheelOfFortuneEvent(BingoGame1History gameHistory = null, bool isForceShow = false)
    {
        if (isForceShow)
        {
            if (gameHistory.minigameData.isDisplayWheel)
            {
                // UIManager.Instance.DisplayLoader(true);
                EventManager.Instance.WheelOfFortuneData(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    WheelOfFortuneDataResponse
                );
            }
            else
            {
                //false: physical player won->show only winning popup
            }
        }
        else
        {
            // UIManager.Instance.DisplayLoader(true);
            EventManager.Instance.WheelOfFortuneData(GameSocketManager.SocketGame1, gameData.gameId, WheelOfFortuneDataResponse);
        }
    }

    private void WheelOfFortuneDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("WheelOfFortuneDataResponse :" + packet.ToString());
        DisplayLoader(false); // UIManager.Instance.DisplayLoader(false);

        EventResponse<WheelOfFortuneData> response = JsonUtility.FromJson<EventResponse<WheelOfFortuneData>>(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (UIManager.Instance.isGameWebGL)
            {
                // wheelOfFortunePanel.Open(GameSocketManager.SocketGame1, gameData.gameId, response.result, 10, UIManager.Instance.game1Panel.BackgroundSprite, LocalizationManager.GetTranslation("Game 1"));
                // fortuneWheelManager.Open(
                //     GameSocketManager.SocketGame1,
                //     gameData.gameId,
                //     response.result,
                //     10,
                //     UIManager.Instance.game1Panel.BackgroundSprite,
                //     LocalizationManager.GetTranslation("Game 1")
                // );
                newFortuneWheelManager.Open(GameSocketManager.SocketGame1, gameData.gameId, response.result, 10, UIManager.Instance.game1Panel.BackgroundSprite, LocalizationManager.GetTranslation("Game 1"));
            }
            else
            {
                // wheelOfFortunePanel.Open(GameSocketManager.SocketGame1, gameData.gameId, response.result, 10, UIManager.Instance.game1Panel.BackgroundSprite, "Game 1");
                // fortuneWheelManager.Open(
                //     GameSocketManager.SocketGame1,
                //     gameData.gameId,
                //     response.result,
                //     10,
                //     UIManager.Instance.game1Panel.BackgroundSprite,
                //     "Game 1"
                // );
                newFortuneWheelManager.Open(GameSocketManager.SocketGame1, gameData.gameId, response.result, 10, UIManager.Instance.game1Panel.BackgroundSprite, "Game 1");
            }
#else
            // wheelOfFortunePanel.Open(GameSocketManager.SocketGame1, gameData.gameId, response.result, 10 , UIManager.Instance.game1Panel.BackgroundSprite, LocalizationManager.GetTranslation("Game 1"));
            // fortuneWheelManager.Open(GameSocketManager.SocketGame1, gameData.gameId, response.result, 10, UIManager.Instance.game1Panel.BackgroundSprite, LocalizationManager.GetTranslation("Game 1"));
            newFortuneWheelManager.Open(GameSocketManager.SocketGame1, gameData.gameId, response.result, 10, UIManager.Instance.game1Panel.BackgroundSprite, LocalizationManager.GetTranslation("Game 1"));
#endif
        }
        else
        {
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
        }
    }

    private void CallTreasureChestEvent()
    {
        DisplayLoader(true); // UIManager.Instance.DisplayLoader(true);

        //#if UNITY_WEBGL
        //        Refresh();
        //#else
        //                UIManager.Instance.DisplayLoader(true);
        //                EventManager.Instance.WheelOfFortuneData(adminSocket, roomId, WheelOfFortuneDataResponse, "Admin");
        //#endif

        EventManager.Instance.TreasureChestData(
            GameSocketManager.SocketGame1,
            gameData.gameId,
            TreasureChestDataResponse
        );
    }

    private void TreasureChestDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("TreasureChestDataResponse :" + packet.ToString());
        DisplayLoader(false); // UIManager.Instance.DisplayLoader(false);

        EventResponse<TreasureChestData> response = JsonUtility.FromJson<
            EventResponse<TreasureChestData>
        >(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                treasureChestPanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    10,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    LocalizationManager.GetTranslation("Game 1")
                );
            }
            else
            {
                treasureChestPanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    10,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    "Game 1"
                );
            }
#else
            treasureChestPanel.Open(
                GameSocketManager.SocketGame1,
                gameData.gameId,
                response.result,
                10,
                UIManager.Instance.game1Panel.BackgroundSprite,
                LocalizationManager.GetTranslation("Game 1")
            );
#endif
        }
        else
        {
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
        }
    }

    private void CallMysteryGameEvent()
    {
        DisplayLoader(true); // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.MysteryGameData(
            GameSocketManager.SocketGame1,
            gameData.gameId,
            MysteryGameDataResponse,
            "Real"
        );
    }

    private void MysteryGameDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("MysteryGameDataResponse :" + packet.ToString());
        DisplayLoader(false); // UIManager.Instance.DisplayLoader(false);

        EventResponse<MysteryGameData> response = JsonUtility.FromJson<EventResponse<MysteryGameData>>(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                mysteryGamePanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    response.result.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    LocalizationManager.GetTranslation("Game 1"),
                    "Game 1"
                );
            }
            else
            {
                mysteryGamePanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    response.result.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    "Game 1",
                    "Game 1"
                );
            }
#else
            mysteryGamePanel.Open(
                GameSocketManager.SocketGame1,
                gameData.gameId,
                response.result,
                UIManager.Instance.game1Panel.BackgroundSprite,
                response.result.isGamePaused,
                BingoGame1HistoryData.pauseGameMessage,
                LocalizationManager.GetTranslation("Game 1"),
                "Game 1"
            );
#endif
        }
        else
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
    }

    private void CallColorDraftGameEvent()
    {
        DisplayLoader(true);
        EventManager.Instance.ColorDraftGameData(
            GameSocketManager.SocketGame1,
            gameData.gameId,
            ColorDraftGameDataResponse,
            "Real"
        );
    }

    private void ColorDraftGameDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("ColorDraftGameDataResponse :" + packet.ToString());
        DisplayLoader(false); // UIManager.Instance.DisplayLoader(false);

        EventResponse<ColorDraftGameData> response = JsonUtility.FromJson<
            EventResponse<ColorDraftGameData>
        >(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                colorDraftGamePanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    response.result.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    LocalizationManager.GetTranslation("Game 1")
                );
            }
            else
            {
                colorDraftGamePanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    response.result.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    "Game 1"
                );
            }
#else
            colorDraftGamePanel.Open(
                GameSocketManager.SocketGame1,
                gameData.gameId,
                response.result,
                UIManager.Instance.game1Panel.BackgroundSprite,
                response.result.isGamePaused,
                BingoGame1HistoryData.pauseGameMessage,
                LocalizationManager.GetTranslation("Game 1")
            );
#endif
        }
        else
        {
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
        }
    }

    private void CloseMiniGames()
    {
        // wheelOfFortunePanel.Close();
        fortuneWheelManager.Close();
        newFortuneWheelManager.Close();
        treasureChestPanel.Close();
        mysteryGamePanel.Close();
        colorDraftGamePanel.Close();
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
