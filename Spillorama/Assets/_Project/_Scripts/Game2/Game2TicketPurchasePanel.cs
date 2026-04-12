using System;
using System.Collections;
using System.Collections.Generic;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class Game2TicketPurchasePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    [Header("Panels")]
    public ChangeMarkerBackgroundPanel changeMarkerBackgroundPanel;
    public PrefabGame2UpcomingGames prefabGame2UpcomingGames;
    public JackpotBroadcast jackpotBroadcast;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtLuckyNumber;
    [SerializeField] private TextMeshProUGUI txtSelectedCards;
    [SerializeField] private TextMeshProUGUI txtCardAmount;
    [SerializeField] private TextMeshProUGUI txtTotalItemPoints;
    [SerializeField] private TextMeshProUGUI txtBoardsSold;

    [Header("Transform")]
    [SerializeField] private Transform transformTicketContainer;
    [SerializeField] private Transform transformJackpotContainer;

    [Header("Prefabs")]
    [SerializeField] private PrefabBingo2TicketPurchase prefabTicket;
    [SerializeField] private PrefabJackpotPanel prefabJackpotPanel;

    [Header("List")]
    [SerializeField] private List<PrefabBingo2TicketPurchase> ticketList;
    [SerializeField] private List<PrefabBingo2TicketPurchase> ticketListUnused;
    [SerializeField] private List<string> selectedTicketIdList = new List<string>();
    public List<PrefabJackpotPanel> jackpotPanelList = new List<PrefabJackpotPanel>();

    [Header("Panel")]
    [SerializeField] private SelectLuckyNumberPanel selectLuckyNumberPanel;
    [SerializeField] private PaginationPanel paginationPanel;

    [Header("Buttons")]
    [SerializeField] private Button btnBuy;
    [SerializeField] private Button btnPickLuckyNumber;

    [Header("Toggle")]
    [SerializeField] private Toggle toggleAutoPlay;

    [Header("Rocket Components")]
    [SerializeField] private Image[] imgRocketTickets;
    private int totalSelectedTickets = 0;
    private int myTotalSelectedTickets = 0;

    [Header("Rocket Graphic Components")]
    [SerializeField] private GameObject gameObjectRocketMainComponent;
    [SerializeField] private Animator animatorRocketLaunch;
    [SerializeField] private Image imgRocketFlame;
    [SerializeField] private Image imgRocketCloudFlame;
    [SerializeField] private Transform transformRocket;
    [SerializeField] private Transform transformRocketFlameCloud;
    private float animationTime = 3.5f;

    private int _luckyNumber;
    private double ticketAmount = 20;
    private float rocketAnimationTime = 3;
    private float rocketAnimationBufferTime = 0.5f;
    private int ticketCountPerPage = 40;

    [SerializeField] private GameData gameData;
    [SerializeField] private Game2TicketForPurchaseResponse game2PurchaseData;

    [SerializeField] internal string Sub_Game_ID = "";

    #endregion

    #region UNITY_CALLBACKS

    private void Awake()
    {
        if (Utility.Instance.IsRunningOniPad())
            ticketCountPerPage = 40;
    }

    private void OnEnable()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
        EnableBroadcasts();
        paginationPanel.Close();

        // Spillorama handles reconnection via SpilloramaSocketManager

        if (Utility.Instance.IsStandAloneVersion())
        {
            Transform transformLobbyPanel = UIManager.Instance.lobbyPanel.transform;
            UIManager.Instance.game2Panel.transform.SetParent(transformLobbyPanel.parent);
            UIManager.Instance.game2Panel.transform.SetSiblingIndex(transformLobbyPanel.GetSiblingIndex() + 1);
            Utility.Instance.StretchAllZero(UIManager.Instance.game2Panel.GetComponent<RectTransform>());
        }

        // Subscribe to the language change event (if supported by I2 Localization)
        LocalizationManager.OnLocalizeEvent += HandleLanguageChange;
    }

    

    private void OnDisable()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
        gameObjectRocketMainComponent.SetActive(false);
        DisableBroadcasts();

        // Spillorama handles reconnection via SpilloramaSocketManager
        LeftRocketRoom();

        LocalizationManager.OnLocalizeEvent -= HandleLanguageChange;
    }

    private void Update()
    {
#if UNITY_EDITOR
        if (Input.GetKeyUp(KeyCode.L))
            RocketLaunchAnimation();
#endif
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void OpenPanel(GameData gameData)
    {
        this.Open();
        this.gameData = gameData;
        HardReset();
        Reset();
        Game2TicketPurchaseDataEvent();
    }

    public void OpenPanel(string sub_Game_ID)
    {
        this.Open();
        HardReset();
        Reset();
        UIManager.Instance.topBarPanel.miniGamePlanPanel.gameObject.SetActive(false);
        UIManager.Instance.game2Panel.game2PlayPanel.prefabGame2UpcomingGames.Close();
        Sub_Game_ID = sub_Game_ID;
        FetchTicketPurchaseData();
    }

    public void OpenPanel()
    {
        this.Open();
        HardReset();
        Reset();
        UIManager.Instance.topBarPanel.miniGamePlanPanel.gameObject.SetActive(false);
        UIManager.Instance.game2Panel.game2PlayPanel.prefabGame2UpcomingGames.Close();
        FetchTicketPurchaseData();
    }

    private void Game2TicketPurchaseDataEvent()
    {
        FetchTicketPurchaseData();
    }

    private void FetchTicketPurchaseData()
    {
        // TODO: Replace with Spillorama REST endpoint for Game2 ticket purchase data
        Debug.LogWarning("[Game2] FetchTicketPurchaseData: Spillorama endpoint not yet implemented");
        UIManager.Instance.DisplayLoader(false);
    }

    public void PaginationUpdateCall()
    {
        Debug.Log("Selected page: " + paginationPanel.selectedPage);
        RefreshTicketListPage(paginationPanel.selectedPage);
    }

    public void Game2TicketPurchaseDataCall()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
        selectedTicketIdList.Clear();
        FetchTicketPurchaseData();
    }

    public void OnLuckyNumberTap()
    {
        selectLuckyNumberPanel.Open();
    }

    public void OnBuyButtonTap()
    {
        if (selectedTicketIdList.Count == 0)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.SelectAtLeastOneTicketMessage);
            return;
        }
        else if (LuckyNumber == 0)
        {
            UIManager.Instance.messagePopup.DisplayConfirmationPopup(Constants.LanguageKey.LuckyNumberNotSelectedMessage, Constants.LanguageKey.ContinueMessage, Constants.LanguageKey.CancelMessage, () =>
            {
                LuckyNumber = UnityEngine.Random.Range(1, 22);
                selectLuckyNumberPanel.SetLuckyNumber(LuckyNumber);
                SelectPurchaseType();
            }, null);
        }
        else
        {
            SelectPurchaseType();
        }
    }

    public void OpenPlayPanel()
    {
        this.Close();
        UIManager.Instance.game2Panel.game2PlayPanel.Open();
        UIManager.Instance.game2Panel.LuckyNumber = LuckyNumber;
    }

    public void AddTicketInWishList(string ticketId)
    {
        if (!selectedTicketIdList.Contains(ticketId))
        {
            selectedTicketIdList.Add(ticketId);
        }
        RefreshPurchaseData();
    }

    public void RemoveTicketFromWishList(string ticketId)
    {
        selectedTicketIdList.Remove(ticketId);
        RefreshPurchaseData();
    }

    public void RefreshRocketTicketStack()
    {
        int purchasedTicketCount = TotalSelectedTickets;

        for (int i = 0; i < purchasedTicketCount; i++)
        {
            imgRocketTickets[imgRocketTickets.Length - 1 - i].Open();
        }

        for (int i = purchasedTicketCount; i < imgRocketTickets.Length; i++)
        {
            imgRocketTickets[imgRocketTickets.Length - 1 - i].Close();
        }
    }

    public void TicketSelected(bool selectedByMe)
    {
        totalSelectedTickets++;
        imgRocketTickets[imgRocketTickets.Length - totalSelectedTickets].Open();

        if (selectedByMe)
        {
            myTotalSelectedTickets++;
            RefreshPurchaseData();
        }
    }

    public void TicketUnSelected(bool selectedByMe)
    {
        imgRocketTickets[imgRocketTickets.Length - totalSelectedTickets].Close();
        totalSelectedTickets--;

        if (selectedByMe)
        {
            myTotalSelectedTickets--;
            RefreshPurchaseData();
        }
    }

    public void OpenChangeMarkerBackgroundPanel()
    {
        changeMarkerBackgroundPanel.Open();
    }

    public void BuyMoreBoardsButtonTap()
    {
        // TODO: Replace with Spillorama REST endpoint for Game2 list
        Debug.LogWarning("[Game2] BuyMoreBoardsButtonTap: Spillorama endpoint not yet implemented");
    }

    public void AdvancePurchaseForTodaysGame()
    {
        RectTransform rectTransform = UIManager.Instance.topBarPanel.miniGamePlanPanel.gamePlanListingPopup;
        UIManager.Instance.topBarPanel.OnMiniGamePlanPanelButtonTap();
    }

    #endregion

    #region PRIVATE_METHODS

    private void EnableBroadcasts()
    {
        // TODO: Spillorama broadcasts via SpilloramaSocketManager
        Debug.Log("[Game2] EnableBroadcasts: handled via Spillorama snapshots");
    }

    private void DisableBroadcasts()
    {
        // TODO: Spillorama broadcasts via SpilloramaSocketManager
        Debug.Log("[Game2] DisableBroadcasts: handled via Spillorama snapshots");
    }

    private void RefreshTicketListPage(int pageNo)
    {
        Reset(false);
        int stIndex = (pageNo - 1) * ticketCountPerPage;
        int recordCount = ticketCountPerPage;

        if ((stIndex + recordCount) > (game2PurchaseData.ticketList.Count - 1))
            recordCount = game2PurchaseData.ticketList.Count - stIndex;

        GenerateTickets(game2PurchaseData.ticketList.GetRange(stIndex, recordCount));
        selectLuckyNumberPanel.GenerateLuckyNumbers(game2PurchaseData.luckyNumber);
        LuckyNumber = LuckyNumber;

        foreach (PrefabBingo2TicketPurchase ticket in ticketList)
        {
            foreach (string selectedTicketId in selectedTicketIdList)
            {
                if (ticket.TicketId == selectedTicketId)
                {
                    ticket.IsSelected = true;
                    break;
                }
            }
        }
    }

    private void SetRocketNormalPosition()
    {
        animatorRocketLaunch.enabled = false;
        imgRocketFlame.Close();
        imgRocketCloudFlame.Close();
        transformRocket.localPosition = Vector3.zero;
        transformRocketFlameCloud.localPosition = new Vector3(0, -250, 0);
    }

    private void RocketLaunchAnimation()
    {
        animatorRocketLaunch.enabled = true;
        StartCoroutine(OpenGamePlayPanel());
    }

    private void RefreshPurchaseData()
    {
        myTotalSelectedTickets = selectedTicketIdList.Count;
        txtSelectedCards.text = myTotalSelectedTickets.ToString();
        txtCardAmount.text = ticketAmount.ToString();
        txtTotalItemPoints.text = (ticketAmount * myTotalSelectedTickets).ToString();
    }

    private void SelectPurchaseType()
    {
        CallBuyTicketEvent("realMoney", "");
    }

    private void CallBuyTicketEvent(string purchaseType, string voucherCode = "")
    {
        // TODO: Replace with Spillorama REST endpoint for Game2 buy tickets
        Debug.LogWarning("[Game2] CallBuyTicketEvent: Spillorama endpoint not yet implemented");
        UIManager.Instance.selectPurchaseTypePanel.Close();
        UIManager.Instance.DisplayLoader(false);
    }

    private void GenerateTickets(List<Game2TicketData> game2TicketList)
    {
        int hirarchyIndex = 0;
        foreach (Game2TicketData ticketData in game2TicketList)
        {
            PrefabBingo2TicketPurchase newTicket = GetTicketObject();
            newTicket.transform.SetSiblingIndex(hirarchyIndex++);
            newTicket.SetData(ticketData);

            if (ticketData.isPurchased)
            {
                newTicket.SoldOutTicket(ticketData.isPurchased, ticketData.playerIdOfPurchaser);
            }
            ticketList.Add(newTicket);
        }
    }

    private PrefabBingo2TicketPurchase GetTicketObject()
    {
        PrefabBingo2TicketPurchase newObject;

        if (ticketListUnused.Count > 0)
        {
            newObject = ticketListUnused[0];
            ticketListUnused.Remove(newObject);
            newObject.Open();
        }
        else
        {
            newObject = Instantiate(prefabTicket, transformTicketContainer);
        }

        return newObject;
    }

    private void Reset(bool hardReset = true)
    {
        foreach (PrefabBingo2TicketPurchase ticket in ticketList)
        {
            ticketListUnused.Add(ticket);
            ticket.Close();
        }
        ticketList.Clear();

        if (hardReset)
        {
            // Clearing the jackpot list.
            jackpotPanelList.Clear();

            foreach (Transform transform in transformJackpotContainer)
                Destroy(transform.gameObject);

            selectLuckyNumberPanel.Close();

            toggleAutoPlay.isOn = false;
            btnBuy.interactable = true;
            gameObjectRocketMainComponent.SetActive(true);

            RefreshPurchaseData();

            totalSelectedTickets = 0;
            myTotalSelectedTickets = 0;

            foreach (Image imgRocketStack in imgRocketTickets)
                imgRocketStack.Close();

            LuckyNumber = 0;
            selectedTicketIdList.Clear();
        }
    }

    private void HardReset()
    {
        paginationPanel.selectedPage = 1;
        SetRocketNormalPosition();
    }

    void Update_Sub_Game_Ticket_List(List<Game2TicketData> tickets)
    {
        foreach (PrefabBingo2TicketPurchase ticket in ticketList)
        {
            ticketListUnused.Add(ticket);
            ticket.Close();
        }
        ticketList.Clear();

        GenerateTickets(tickets);
        LuckyNumber = LuckyNumber;
        selectedTicketIdList.Clear();
        RefreshPurchaseData();
        UIManager.Instance.DisplayLoader(false);
    }

    private void HandleLanguageChange()
    {
        Debug.Log("[Game2] HandleLanguageChange — regenerating jackpot list");
        GenerateJackpotList(jackpotBroadcast.jackpotList);
    }

    #endregion

    #region BROADCAST_RECEIVER

    private void GenerateJackpotList(List<JackpotData> jackpotList)
    {
        foreach (Transform transform in transformJackpotContainer)
            Destroy(transform.gameObject);

        foreach (JackpotData data in jackpotList)
        {
            Debug.Log("Number: " + data.number);
            PrefabJackpotPanel newJackpotPanel = Instantiate(prefabJackpotPanel, transformJackpotContainer);
            newJackpotPanel.SetData(data);
            this.jackpotPanelList.Add(newJackpotPanel);
        }
    }

    public void Back_Btn()
    {
        UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame2ButtonTap();
    }

    internal void LeftRocketRoom()
    {
        // TODO: Replace with Spillorama room leave
        Debug.Log("[Game2] LeftRocketRoom: handled via Spillorama");
    }

    #endregion

    #region COROUTINES

    private IEnumerator OpenGamePlayPanel()
    {
        yield return new WaitForSeconds(rocketAnimationTime);
        // UIManager.Instance.DisplayLoader(true);
        yield return new WaitForSeconds(rocketAnimationBufferTime);
        // Spillorama: namespace handled by SpilloramaSocketManager

        if (Utility.Instance.IsSplitScreenSupported)
        {
            UIManager.Instance.splitScreenGameManager.OpenGamePlay2(gameData, UIManager.Instance.game2Panel.Game_2_Data.gameId);
            UIManager.Instance.game2Panel.Close();
        }
        else
        {
            UIManager.Instance.game2Panel.OpenGamePlayPanel(gameData, UIManager.Instance.game2Panel.Game_2_Data.gameId);
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

            foreach (PrefabBingo2TicketPurchase ticket in ticketList)
                ticket.HighlightLuckyNumber(_luckyNumber);
        }
        get
        {
            return _luckyNumber;
        }
    }

    public int TotalSelectedTickets
    {
        get
        {
            return game2PurchaseData.ownPurchasedTicketCount + selectedTicketIdList.Count;
        }
    }
    #endregion
}
