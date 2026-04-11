using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class BingoTicket : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public TMP_Text Togo_Txt;
    public TMP_Text Ticket_Name_Txt;

    public bool Is_Blinked_On_1 = false;
    public Color Blink_On_1_Color;
    public Color Bingo_Box_Color;
    internal Color Current_Color;
    public string help = "help";
    public GameObject Bingo;

    public Image Bingo_BG;
    public Button deleteBtn;

    #endregion

    #region PRIVATE_VARIABLES
    [Header("GameObjects")]
    [SerializeField]
    protected GameObject gameObjectTicketData;

    [SerializeField]
    private GameObject gameObjectDetails;

    [Header("Panels")]
    [SerializeField]
    private BingoResultPanel bingoResultPanel;

    [Header("Buttons")]
    [SerializeField]
    private Button btnViewDetails;

    [Header("Images")]
    [SerializeField]
    public Image imgTicket;
    public Image Ticket_Icon;

    [Header("Text")]
    public TextMeshProUGUI txtWonAmount;
    [SerializeField]
    private TextMeshProUGUI txtTicketNumber;

    [SerializeField]
    private TextMeshProUGUI txtTicketPrice;

    [SerializeField]
    private TextMeshProUGUI txtHallLabel;

    [SerializeField]
    private TextMeshProUGUI txtHallName;

    [SerializeField]
    private TextMeshProUGUI txtSupplierLabel;

    [SerializeField]
    private TextMeshProUGUI txtSupplierName;

    [SerializeField]
    private TextMeshProUGUI txtDeveloperLabel;

    [SerializeField]
    private TextMeshProUGUI txtDeveloperName;
    [SerializeField]
    private TextMeshProUGUI txtDeveloperName1;

    [Header("Colors")]
    [SerializeField]
    private Color32 colorTextLabels;

    [SerializeField]
    private Color32 colorTicket;

    [SerializeField]
    private Color32 colorGrid;

    [SerializeField]
    private Color32 colorGridMarker;

    [SerializeField]
    private Color32 colorNormalText;

    [SerializeField]
    private Color32 colorMarkerText;

    [SerializeField]
    private Color32 colorLuckyNumberText;

    [Header("Bingo Ticket Cell List")]
    [SerializeField]
    public List<BingoTicketSingleCellData> ticketCellList;

    [Header("Data")]
    [SerializeField]
    public GameTicketData gameTicketData;

    private float ticketRotationTime = 0.5f;
    private float ticketDetailPageTime = 3f;
    private bool isFlipAnimationRunning = false;
    public TicketMarkerCellData markerData;
    private TicketColorData ticketColorData = null;

    internal LTDescr Blink_Tween;

    [SerializeField]
    internal int Pattern_Remaining_Cell_Count;

    [SerializeField]
    internal bool Pattern_Completed;
    int length,
        Cell_Lenght,
        tmp_Pattern_Remaining_Cell_Count,
        tmp;

    [Header("Complete Pattern Indices")]
    public int[] yourArray;

    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        transform.localEulerAngles = Vector3.zero;
        gameObjectTicketData.SetActive(true);
        if (gameObjectDetails)
            gameObjectDetails.SetActive(false);
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    internal void Set_Ticket_Color()
    {
        Tickets_Color color = TicketColorManager.Instance.Get_Ticket_Color(
            gameTicketData.ticketColor
        );
        imgTicket.color = color.BG_Color;
        int length = ticketCellList.Count;
        for (int i = 0; i < length; i++)
            ticketCellList[i].imgCell.color = color.Block_Color;
        Bingo_BG.color = Current_Color = imgTicket.color;
        if (color.name.Contains("Elvis"))
            Ticket_Icon.sprite = UIManager.Instance.Elvis_Icon;
    }

    #region Data
    public void DeleteBtnTap()
    {
        // Debug.LogError("tap...");
        if (UIManager.Instance.game1Panel.gameObject.activeSelf)
        {
            UIManager.Instance.deleteMessagePopup.grid.cellSize = new Vector2(250f, 250f);
        }
        if (UIManager.Instance.game3Panel.gameObject.activeSelf)
        {
            UIManager.Instance.deleteMessagePopup.grid.cellSize = new Vector2(250f, 250f);
        }
        // Debug.LogError("abc..");
        if (gameTicketData.IsLargeTicket() || UIManager.Instance.game1Panel.Game_1_Data.gameName.Equals("Traffic Light"))
        {
            // Debug.LogError("abc..");
            var ticketList = UIManager.Instance.game1Panel.game1GamePlayPanel.ticketList;
            int currentIndex = -1;

            for (int i = 0; i < ticketList.Count; i++)
            {
                if (this.gameTicketData.ticketNumber == ticketList[i].gameTicketData.ticketNumber)
                {
                    currentIndex = i;
                    break;
                }
            }
            ticketList[currentIndex].deleteBtn.gameObject.SetActive(false);
            if (currentIndex != -1)
            {
                List<GameObject> previousTickets = new List<GameObject>();
                List<PrefabBingoGame1Ticket5x5> ticket = new List<PrefabBingoGame1Ticket5x5>();
                if (currentIndex - 2 >= 0)
                {
                    previousTickets.Add(ticketList[currentIndex - 2].gameObject);
                }
                if (currentIndex - 1 >= 0)
                {
                    previousTickets.Add(ticketList[currentIndex - 1].gameObject);
                }
                previousTickets.Add(ticketList[currentIndex].gameObject);
                UIManager.Instance.deleteMessagePopup.DisplayDeleteConfirmationPopup(
                    Constants.LanguageKey.DeleteTicketsConfirmationMessage,
                    (result) =>
                    {
                        if (result)
                        {
                            string i1 = "";
                            string i2 = "";
                            string i3 = "";
                            foreach (var tc in previousTickets)
                            {
                                PrefabBingoGame1Ticket5x5 x5 =
                                    tc.GetComponent<PrefabBingoGame1Ticket5x5>();
                                ticket.Add(x5);
                            }
                            if (ticket.Count > 0)
                                i1 = ticket[0].gameTicketData.id;
                            if (ticket.Count > 1)
                                i2 = ticket[1].gameTicketData.id;
                            if (ticket.Count > 2)
                                i3 = ticket[2].gameTicketData.id;
                            if (UIManager.Instance.game1Panel.gameObject.activeSelf)
                            {
                                EventManager.Instance.CancelTicketGame1(
                                    UIManager.Instance.game1Panel.Game_1_Data.gameId,
                                    i1,
                                    i2,
                                    i3,
                                    (socket, packet, args) =>
                                    {
                                        Debug.Log($"CancelTicketGame1 Response : {packet}");
                                        UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                                        previousTickets.Clear();
                                        ticket.Clear();
                                    }
                                );
                            }
                            Debug.Log("Tickets Deleted.");
                        }
                    },
                    (result) =>
                    {
                        if (result)
                        {
                            ticketList[currentIndex].deleteBtn.gameObject.SetActive(true);
                            previousTickets.Clear();
                            ticket.Clear();
                        }
                    },
                    null,
                    previousTickets
                );
            }
            else
            {
                Debug.LogWarning("Current ticket not found in the list.");
            }
        }
        else if (gameTicketData.IsSmallTicket() && !UIManager.Instance.game1Panel.Game_1_Data.gameName.Equals("Traffic Light"))
        {
            Debug.LogError("abc..");
            this.deleteBtn.gameObject.SetActive(false);
            UIManager.Instance.deleteMessagePopup.DisplayDeleteConfirmationPopup(
                Constants.LanguageKey.DeleteTicketConfirmationMessage,
                (result) =>
                {
                    if (result)
                    {
                        if (UIManager.Instance.game1Panel.gameObject.activeSelf)
                        {
                            EventManager.Instance.CancelTicketGame1(
                                UIManager.Instance.game1Panel.Game_1_Data.gameId,
                                this.gameTicketData.id,
                                "",
                                "",
                                (socket, packet, args) =>
                                {
                                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                                }
                            );
                        }
                        if (UIManager.Instance.game2Panel.gameObject.activeSelf)
                        {
                            EventManager.Instance.CancelTicketGame2(
                                UIManager.Instance.game2Panel.game2PlayPanel.Current_Sub_Game_ID,
                                this.gameTicketData.id,
                                (socket, packet, args) =>
                                {
                                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame2ButtonTap();
                                }
                            );
                        }
                        if (UIManager.Instance.game3Panel.gameObject.activeSelf)
                        {
                            EventManager.Instance.CancelTicketGame3(
                                UIManager
                                    .Instance
                                    .game3Panel
                                    .game3GamePlayPanel
                                    .Current_Sub_Game_ID,
                                this.gameTicketData.id,
                                (socket, packet, args) =>
                                {
                                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame3ButtonTap();
                                }
                            );
                        }
                        Debug.Log("Ticket Deleted.");
                    }
                },
                (result) =>
                {
                    if (result)
                    {
                        this.deleteBtn.gameObject.SetActive(true);
                    }
                },
                this.gameObject,
                null
            );
        }
        else
        {
            Debug.LogError("abc..");
            this.deleteBtn.gameObject.SetActive(false);
            UIManager.Instance.deleteMessagePopup.DisplayDeleteConfirmationPopup(
                Constants.LanguageKey.DeleteTicketConfirmationMessage,
                (result) =>
                {
                    if (result)
                    {
                        if (UIManager.Instance.game2Panel.gameObject.activeSelf)
                        {
                            EventManager.Instance.CancelTicketGame2(
                                UIManager.Instance.game2Panel.game2PlayPanel.Current_Sub_Game_ID,
                                this.gameTicketData.id,
                                (socket, packet, args) =>
                                {
                                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame2ButtonTap();
                                }
                            );
                        }
                        if (UIManager.Instance.game3Panel.gameObject.activeSelf)
                        {
                            EventManager.Instance.CancelTicketGame3(
                                UIManager
                                    .Instance
                                    .game3Panel
                                    .game3GamePlayPanel
                                    .Current_Sub_Game_ID,
                                this.gameTicketData.id,
                                (socket, packet, args) =>
                                {
                                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame3ButtonTap();
                                }
                            );
                        }
                        Debug.Log("Ticket Deleted.");
                    }
                },
                (result) =>
                {
                    if (result)
                    {
                        this.deleteBtn.gameObject.SetActive(true);
                    }
                },
                this.gameObject,
                null
            );
        }
    }

    public void SetData(GameTicketData gameTicketData, TicketMarkerCellData markerData)
    {
        this.gameTicketData = gameTicketData;
        this.markerData = markerData;

        if (txtTicketNumber)
        {
            txtTicketNumber.text = gameTicketData.ticketNumber;
            if (gameTicketData.ticketName.Length > 0)
                txtTicketNumber.text += "-" + gameTicketData.ticketName;
        }
        if (txtTicketPrice)
            txtTicketPrice.text = gameTicketData.ticketPrice + Constants.StringClass.currencySymbol;

        if (txtHallName)
            txtHallName.text = UIManager.Instance.Player_Hall_Name;
        //txtHallName.text = gameTicketData.hallName;

        if (txtSupplierName)
            txtSupplierName.text = gameTicketData.supplierName;

        if (txtDeveloperName)
            txtDeveloperName.text = gameTicketData.developerName;

        if (txtDeveloperName1)
            txtDeveloperName1.text = gameTicketData.developerName;

        if (gameTicketData.ticketColor != "")
            SetTicketColor(gameTicketData.ticketColor);

        Current_Color = imgTicket.color;

        for (int i = 0; i < gameTicketData.ticketCellNumberList.Count; i++)
        {
            ticketCellList[i]
                .CellNumber(
                    gameTicketData.ticketCellNumberList[i].ToString(),
                    colorNormalText,
                    colorMarkerText,
                    colorLuckyNumberText
                );
        }

        TicketCompleted = gameTicketData.ticketCompleted;
        if (TicketCompleted)
        {
            if (Bingo != null)
            {
                Pattern_Completed = true;
                Pattern_Remaining_Cell_Count = 0;
                Togo_Txt.text = Constants.LanguageKey.PatternCompletedMessage;
            }
        }
        WonAmount = gameTicketData.winningAmount.ToString();

        ResetYourArray();

    }

    public void ResetYourArray()
    {
        yourArray = new int[ticketCellList.Count];
        for (int i = 0; i < ticketCellList.Count; i++)
        {
            yourArray[i] = 0;
        }
    }

    public void Game_1_12()
    {
        ticketCellList[12].isNumberSelected = true;
    }

    public void Set_Togo_Txt_Game1()
    {
        if (Pattern_Completed)
            return;

        Pattern_Remaining_Cell_Count = ticketCellList.Count;
        length = UIManager.Instance.game1Panel.game1GamePlayPanel.Patterns.Count;

        for (int i = 0; i < length; i++)
        {
            switch (UIManager.Instance.game1Panel.game1GamePlayPanel.Patterns[i].Pattern_Design)
            {
                case 0:
                    Cell_Lenght = tmp_Pattern_Remaining_Cell_Count = UIManager
                        .Instance
                        .game1Panel
                        .game1GamePlayPanel
                        .Patterns[i]
                        .Pattern_Indexes
                        .Count;
                    for (int j = 0; j < Cell_Lenght; j++)
                        if (
                            ticketCellList[
                                UIManager
                                    .Instance
                                    .game1Panel
                                    .game1GamePlayPanel
                                    .Patterns[i]
                                    .Pattern_Indexes[j]
                            ].isNumberSelected
                        )
                            tmp_Pattern_Remaining_Cell_Count--;

                    if (tmp_Pattern_Remaining_Cell_Count.Equals(1))
                    {
                        for (int j = 0; j < Cell_Lenght; j++)
                            if (
                                !ticketCellList[
                                    UIManager
                                        .Instance
                                        .game1Panel
                                        .game1GamePlayPanel
                                        .Patterns[i]
                                        .Pattern_Indexes[j]
                                ].isNumberSelected
                            )
                            {
                                if (
                                    ticketCellList[
                                        UIManager
                                            .Instance
                                            .game1Panel
                                            .game1GamePlayPanel
                                            .Patterns[i]
                                            .Pattern_Indexes[j]
                                    ].isNumberBlink
                                )
                                    ticketCellList[
                                        UIManager
                                            .Instance
                                            .game1Panel
                                            .game1GamePlayPanel
                                            .Patterns[i]
                                            .Pattern_Indexes[j]
                                    ]
                                        .Stop_NumberBlink();
                                ticketCellList[
                                    UIManager
                                        .Instance
                                        .game1Panel
                                        .game1GamePlayPanel
                                        .Patterns[i]
                                        .Pattern_Indexes[j]
                                ]
                                    .Start_NumberBlink();
                            }
                    }
                    break;
                case 1:
                    tmp_Pattern_Remaining_Cell_Count = 5;
                    for (int j = 0; j < 5; j++)
                    {
                        tmp = 5;
                        for (int k = 0; k < 5; k++)
                            if (ticketCellList[(j * 5) + k].isNumberSelected)
                                tmp--;
                        if (tmp < 5)
                            if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                tmp_Pattern_Remaining_Cell_Count = tmp;

                        if (tmp.Equals(1))
                        {
                            for (int k = 0; k < 5; k++)
                                if (!ticketCellList[(j * 5) + k].isNumberSelected)
                                {
                                    if (ticketCellList[(j * 5) + k].isNumberBlink)
                                        ticketCellList[(j * 5) + k].Stop_NumberBlink();
                                    ticketCellList[(j * 5) + k].Start_NumberBlink();
                                }
                        }
                    }
                    for (int j = 0; j < 5; j++)
                    {
                        tmp = 5;
                        for (int k = 0; k < 5; k++)
                            if (ticketCellList[(k * 5) + j].isNumberSelected)
                                tmp--;
                        if (tmp < 5)
                            if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                tmp_Pattern_Remaining_Cell_Count = tmp;

                        if (tmp.Equals(1))
                        {
                            for (int k = 0; k < 5; k++)
                                if (!ticketCellList[(k * 5) + j].isNumberSelected)
                                {
                                    if (ticketCellList[(k * 5) + j].isNumberBlink)
                                        ticketCellList[(k * 5) + j].Stop_NumberBlink();
                                    ticketCellList[(k * 5) + j].Start_NumberBlink();
                                }
                        }
                    }
                    //Debug.Log("(case 1)tmp_Pattern_Remaining_Cell_Count" + tmp_Pattern_Remaining_Cell_Count);
                    break;
                case 2:
                    tmp_Pattern_Remaining_Cell_Count = 10;
                    for (int j = 0; j < 4; j++)
                        for (int k = j + 1; k < 5; k++)
                        {
                            tmp = 10;
                            for (int l = 0; l < 5; l++)
                                for (int m = 0; m < 5; m++)
                                    if (l == j || l == k)
                                        if (ticketCellList[5 * l + m].isNumberSelected)
                                            tmp--;
                            if (tmp < 10)
                                if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                    tmp_Pattern_Remaining_Cell_Count = tmp;

                            if (tmp.Equals(1))
                            {
                                for (int l = 0; l < 5; l++)
                                    for (int m = 0; m < 5; m++)
                                        if (l == j || l == k)
                                            if (!ticketCellList[5 * l + m].isNumberSelected)
                                            {
                                                if (ticketCellList[5 * l + m].isNumberBlink)
                                                    ticketCellList[5 * l + m].Stop_NumberBlink();
                                                ticketCellList[5 * l + m].Start_NumberBlink();
                                            }
                            }
                        }
                    //Debug.Log("(case 2)tmp_Pattern_Remaining_Cell_Count" + tmp_Pattern_Remaining_Cell_Count);
                    break;
                case 3:
                    tmp_Pattern_Remaining_Cell_Count = 15;
                    for (int j = 0; j < 3; j++)
                        for (int k = j + 1; k < 4; k++)
                            for (int l = k + 1; l < 5; l++)
                            {
                                tmp = 15;
                                for (int m = 0; m < 5; m++)
                                    for (int n = 0; n < 5; n++)
                                        if (m == j || m == k || m == l)
                                            if (ticketCellList[5 * m + n].isNumberSelected)
                                                tmp--;
                                if (tmp < 15)
                                    if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                        tmp_Pattern_Remaining_Cell_Count = tmp;

                                if (tmp.Equals(1))
                                {
                                    for (int m = 0; m < 5; m++)
                                        for (int n = 0; n < 5; n++)
                                            if (m == j || m == k || m == l)
                                                if (!ticketCellList[5 * m + n].isNumberSelected)
                                                {
                                                    if (ticketCellList[5 * m + n].isNumberBlink)
                                                        ticketCellList[5 * m + n].Stop_NumberBlink();
                                                    ticketCellList[5 * m + n].Start_NumberBlink();
                                                }
                                }
                            }
                    break;
                case 4:
                    tmp_Pattern_Remaining_Cell_Count = 20;
                    for (int j = 4; j > -1; j--)
                    {
                        tmp = 20;
                        for (int k = 0; k < 25; k++)
                            if ((j * 5) + (k % 5) != k)
                                if (ticketCellList[k].isNumberSelected)
                                    tmp--;
                        if (tmp < 20)
                            if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                tmp_Pattern_Remaining_Cell_Count = tmp;

                        if (tmp.Equals(1))
                        {
                            for (int k = 0; k < 25; k++)
                                if ((j * 5) + (k % 5) != k)
                                    if (!ticketCellList[k].isNumberSelected)
                                    {
                                        if (ticketCellList[k].isNumberBlink)
                                            ticketCellList[k].Stop_NumberBlink();
                                        ticketCellList[k].Start_NumberBlink();
                                    }
                        }
                    }
                    break;
            }
            switch (UIManager.Instance.game1Panel.game1GamePlayPanel.Patterns[i].Pattern_Design)
            {
                case 0:
                    if (
                        tmp_Pattern_Remaining_Cell_Count
                        < UIManager
                            .Instance
                            .game1Panel
                            .game1GamePlayPanel
                            .Patterns[i]
                            .Pattern_Indexes
                            .Count
                    )
                    {
                        if (Pattern_Remaining_Cell_Count > tmp_Pattern_Remaining_Cell_Count)
                        {
                            //Debug.LogError("(1)Pattern_Remaining_Cell_Count +" + Pattern_Remaining_Cell_Count);
                            Pattern_Remaining_Cell_Count = tmp_Pattern_Remaining_Cell_Count;
                        }
                    }

                    break;
                default:
                    if (
                        tmp_Pattern_Remaining_Cell_Count
                        < 5
                            * UIManager
                                .Instance
                                .game1Panel
                                .game1GamePlayPanel
                                .Patterns[i]
                                .Pattern_Design
                    )
                        if (Pattern_Remaining_Cell_Count > tmp_Pattern_Remaining_Cell_Count)
                            Pattern_Remaining_Cell_Count = tmp_Pattern_Remaining_Cell_Count;
                    break;
            }
        }
        if (Pattern_Remaining_Cell_Count == ticketCellList.Count)
            for (int i = 0; i < ticketCellList.Count; i++)
                if (ticketCellList[i].isNumberSelected)
                    Pattern_Remaining_Cell_Count--;

        if (Pattern_Remaining_Cell_Count == 0)
        {
            //TicketCompleted = true;
            //Pattern_Completed = true;
            Stop_Blink();
            Togo_Txt.text = Constants.LanguageKey.FullHouseCompletedMessage;
        }
        else
        {
            bingoResultPanel.Close();
            if (Pattern_Remaining_Cell_Count == 1)
            {
                if (WithdrawNumberCount.Equals(ticketCellList.Count - 2))
                {
                    foreach (BingoTicketSingleCellData item in ticketCellList)
                    {
                        item.Stop_NumberBlink();
                    }

                    if (Is_Blinked_On_1)
                        Stop_Blink();
                    Is_Blinked_On_1 = true;
                    Start_Blink();
                }
                //Debug.LogError("Start Blinking " +TicketNumber);
            }
            else if (Pattern_Remaining_Cell_Count > 1 && Is_Blinked_On_1)
            {
                Is_Blinked_On_1 = false;
                Stop_Blink();
            }
            Togo_Txt.text = $"{Pattern_Remaining_Cell_Count} ToGo";
        }
    }

    public void Set_Togo_Txt()
    {
        int count = 0;
        for (int i = 0; i < ticketCellList.Count; i++)
        {
            if (!ticketCellList[i].isNumberSelected)
                count++;
        }
        if (count == 1)
        {
            if (Is_Blinked_On_1)
                Stop_Blink();
            Is_Blinked_On_1 = true;
            //Debug.Log("Set_Togo_Txt");
            Blink_Tween = LeanTween
                .value(
                    imgTicket.gameObject,
                    Set_Color_Callback,
                    Current_Color,
                    Blink_On_1_Color,
                    0.5f
                )
                .setOnComplete(() =>
                {
                    LeanTween.value(
                        imgTicket.gameObject,
                        Set_Color_Callback,
                        Blink_On_1_Color,
                        Current_Color,
                        0.5f
                    );
                })
                .setLoopCount(-1);
        }
        if (count == 0)
        {
            Togo_Txt.text = "BINGO!";
            StartCoroutine(Bingo_Highlight_Anim());
        }
        else
        {
            Togo_Txt.text = $"{count} ToGo";
        }
    }

    /// <summary> Set Togo Txt Based On Closest Pattern </summary>
    public void Match_Pattern_And_Set_Togo_Txt()
    {
        if (Pattern_Completed)
            return;
        Pattern_Remaining_Cell_Count = ticketCellList.Count;
        length = UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns.Count;
        for (int i = 0; i < length; i++)
        {
            switch (UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Design)
            {
                case 0:
                    Cell_Lenght = tmp_Pattern_Remaining_Cell_Count = UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Indexes.Count;
                    for (int j = 0; j < Cell_Lenght; j++)
                        if (ticketCellList[UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Indexes[j]].isNumberSelected)
                            tmp_Pattern_Remaining_Cell_Count--;
                    if (tmp_Pattern_Remaining_Cell_Count.Equals(1))
                    {
                        for (int j = 0; j < Cell_Lenght; j++)
                            if (!ticketCellList[UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Indexes[j]].isNumberSelected)
                            {
                                if (ticketCellList[UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Indexes[j]].isNumberBlink)
                                    ticketCellList[UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Indexes[j]].Stop_NumberBlink();
                                ticketCellList[UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Indexes[j]].Start_NumberBlink();
                            }
                    }
                    break;
                case 1:
                    tmp_Pattern_Remaining_Cell_Count = 5;
                    for (int j = 0; j < 5; j++)
                    {
                        tmp = 5;
                        for (int k = 0; k < 5; k++)
                            if (ticketCellList[(j * 5) + k].isNumberSelected)
                                tmp--;
                        if (tmp < 5)
                            if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                tmp_Pattern_Remaining_Cell_Count = tmp;

                        if (tmp.Equals(1))
                        {
                            for (int k = 0; k < 5; k++)
                                if (!ticketCellList[(j * 5) + k].isNumberSelected)
                                {
                                    if (ticketCellList[(j * 5) + k].isNumberBlink)
                                        ticketCellList[(j * 5) + k].Stop_NumberBlink();
                                    ticketCellList[(j * 5) + k].Start_NumberBlink();
                                }
                        }
                    }
                    for (int j = 0; j < 5; j++)
                    {
                        tmp = 5;
                        for (int k = 0; k < 5; k++)
                            if (ticketCellList[(k * 5) + j].isNumberSelected)
                                tmp--;
                        if (tmp < 5)
                            if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                tmp_Pattern_Remaining_Cell_Count = tmp;

                        if (tmp.Equals(1))
                        {
                            for (int k = 0; k < 5; k++)
                                if (!ticketCellList[(k * 5) + j].isNumberSelected)
                                {
                                    if (ticketCellList[(k * 5) + j].isNumberBlink)
                                        ticketCellList[(k * 5) + j].Stop_NumberBlink();
                                    ticketCellList[(k * 5) + j].Start_NumberBlink();
                                }
                        }
                    }
                    break;
                case 2:
                    tmp_Pattern_Remaining_Cell_Count = 10;
                    for (int j = 0; j < 4; j++)
                        for (int k = j + 1; k < 5; k++)
                        {
                            tmp = 10;
                            for (int l = 0; l < 5; l++)
                                for (int m = 0; m < 5; m++)
                                    if (l == j || l == k)
                                        if (ticketCellList[5 * l + m].isNumberSelected)
                                            tmp--;
                            if (tmp < 10)
                                if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                    tmp_Pattern_Remaining_Cell_Count = tmp;

                            if (tmp.Equals(1))
                            {
                                for (int l = 0; l < 5; l++)
                                    for (int m = 0; m < 5; m++)
                                        if (l == j || l == k)
                                            if (!ticketCellList[5 * l + m].isNumberSelected)
                                            {
                                                if (ticketCellList[5 * l + m].isNumberBlink)
                                                    ticketCellList[5 * l + m].Stop_NumberBlink();
                                                ticketCellList[5 * l + m].Start_NumberBlink();
                                            }
                            }
                        }
                    break;
                case 3:
                    tmp_Pattern_Remaining_Cell_Count = 15;
                    for (int j = 0; j < 3; j++)
                        for (int k = j + 1; k < 4; k++)
                            for (int l = k + 1; l < 5; l++)
                            {
                                tmp = 15;
                                for (int m = 0; m < 5; m++)
                                    for (int n = 0; n < 5; n++)
                                        if (m == j || m == k || m == l)
                                            if (ticketCellList[5 * m + n].isNumberSelected)
                                                tmp--;
                                if (tmp < 15)
                                    if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                        tmp_Pattern_Remaining_Cell_Count = tmp;

                                if (tmp.Equals(1))
                                {
                                    for (int m = 0; m < 5; m++)
                                        for (int n = 0; n < 5; n++)
                                            if (m == j || m == k || m == l)
                                                if (!ticketCellList[5 * m + n].isNumberSelected)
                                                {
                                                    if (ticketCellList[5 * m + n].isNumberBlink)
                                                        ticketCellList[5 * m + n].Stop_NumberBlink();
                                                    ticketCellList[5 * m + n].Start_NumberBlink();
                                                }
                                }
                            }
                    break;
                case 4:
                    tmp_Pattern_Remaining_Cell_Count = 20;
                    for (int j = 4; j > -1; j--)
                    {
                        tmp = 20;
                        for (int k = 0; k < 25; k++)
                            if ((j * 5) + (k % 5) != k)
                                if (ticketCellList[k].isNumberSelected)
                                    tmp--;
                        if (tmp < 20)
                            if (tmp < tmp_Pattern_Remaining_Cell_Count)
                                tmp_Pattern_Remaining_Cell_Count = tmp;

                        if (tmp.Equals(1))
                        {
                            for (int k = 0; k < 25; k++)
                                if ((j * 5) + (k % 5) != k)
                                    if (!ticketCellList[k].isNumberSelected)
                                    {
                                        if (ticketCellList[k].isNumberBlink)
                                            ticketCellList[k].Stop_NumberBlink();
                                        ticketCellList[k].Start_NumberBlink();
                                    }
                        }
                    }
                    break;
            }
            switch (UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Design)
            {
                case 0:
                    if (tmp_Pattern_Remaining_Cell_Count < UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Indexes.Count)
                        if (Pattern_Remaining_Cell_Count > tmp_Pattern_Remaining_Cell_Count)
                            Pattern_Remaining_Cell_Count = tmp_Pattern_Remaining_Cell_Count;
                    break;
                default:
                    if (tmp_Pattern_Remaining_Cell_Count < 5 * UIManager.Instance.game3Panel.game3GamePlayPanel.Patterns[i].Pattern_Design)
                    {
                        if (Pattern_Remaining_Cell_Count > tmp_Pattern_Remaining_Cell_Count)
                            Pattern_Remaining_Cell_Count = tmp_Pattern_Remaining_Cell_Count;
                    }
                    break;
            }
        }
        if (Pattern_Remaining_Cell_Count == ticketCellList.Count)
        {
            for (int i = 0; i < ticketCellList.Count; i++)
                if (ticketCellList[i].isNumberSelected)
                    Pattern_Remaining_Cell_Count--;
        }
        if (Pattern_Remaining_Cell_Count == 0)
        {
            //TicketCompleted = true;
            //Pattern_Completed = true;
            Stop_Blink();
        }
        else
        {
            if (Pattern_Remaining_Cell_Count == 1)
            {
                if (WithdrawNumberCount.Equals(ticketCellList.Count - 1))
                {
                    foreach (BingoTicketSingleCellData item in ticketCellList)
                    {
                        item.Stop_NumberBlink();
                    }

                    if (Is_Blinked_On_1)
                        Stop_Blink();
                    Is_Blinked_On_1 = true;

                    Blink_Tween = LeanTween.value(imgTicket.gameObject, Set_Color_Callback, Current_Color, Blink_On_1_Color, 0.5f).setOnComplete(() =>
                        {
                            LeanTween.value(imgTicket.gameObject, Set_Color_Callback, Blink_On_1_Color, Current_Color, 0.5f);
                        }).setLoopCount(-1);
                }

                // Print missing numbers if only one cell is remaining
                //PrintMissingNumbers();
            }
            else if (Pattern_Remaining_Cell_Count > 1 && Is_Blinked_On_1)
            {
                Is_Blinked_On_1 = false;
                Stop_Blink();
            }
            Togo_Txt.text = Pattern_Remaining_Cell_Count < 4 ? $"{Pattern_Remaining_Cell_Count} ToGo" : ""; //nicola change
        }
    }

    // Function to print missing numbers
    void PrintMissingNumbers()
    {
        Debug.Log("Ticket Numbrt : " + TicketNumber);
        // Iterate through all cells and print missing numbers
        for (int i = 0; i < ticketCellList.Count; i++)
        {
            if (!ticketCellList[i].isNumberSelected)
            {
                // Print or use the missing number as needed
                Debug.Log($"Missing Number: {ticketCellList[i]}");
            }
        }
    }

    internal void Stop_Blink()
    {
        LeanTween.cancel(gameObject);
        imgTicket.color = Current_Color;
        Blink_Tween = null;
    }

    internal void Start_Blink()
    {
        Blink_Tween = LeanTween
            .value(imgTicket.gameObject, Set_Color_Callback, Current_Color, Blink_On_1_Color, 0.5f)
            .setOnComplete(() =>
            {
                LeanTween.value(
                    imgTicket.gameObject,
                    Set_Color_Callback,
                    Blink_On_1_Color,
                    Current_Color,
                    0.5f
                );
            })
            .setLoopCount(-1);
    }

    IEnumerator Bingo_Highlight_Anim()
    {
        if (Bingo == null)
            yield break;

        int callback = 0;
        Bingo.SetActive(true);
    there:
        ;
        LeanTween
            .scale(gameObject, Vector3.one * 0.85f, 0.25f)
            .setOnComplete(() =>
            {
                LeanTween.scale(gameObject, Vector3.one * 1.05f, 0.25f);
            });
        yield return new WaitForSeconds(0.5f);
        if (callback < 5)
        {
            callback++;
            goto there;
        }
    }

    void Set_Color_Callback(Color c)
    {
        c.a = 1f;
        imgTicket.color = c;
    }

    public void ShowTicketDetails()
    {
        if (!isFlipAnimationRunning)
        {
            if (gameObjectTicketData.activeSelf)
                StartCoroutine(ShowTicketDetailsAnimation());
            else
                StartCoroutine(HideTicketDetailsAnimation());
        }
    }

    public void ModifyMarkerDesign(TicketMarkerCellData markerData, bool ignoreMarkerColor = false)
    {
        this.markerData = markerData;
        foreach (BingoTicketSingleCellData cellData in ticketCellList)
        {
            if (cellData.isNumberSelected)
            {
                cellData.ApplyNormalMarkerTheme(markerData, ignoreMarkerColor);
            }
        }
    }

    public int WithdrawNumberCount = 0;

    public void MarkNewWithdrawNumber(int newWithdrawNumber, bool ignoreMarker = false, bool isLuckyNumber = false, bool playSound = false)
    {
        //WithdrawNumberCount = 0;

        int index = 0;

        foreach (BingoTicketSingleCellData cellData in ticketCellList)
        {
            if (newWithdrawNumber == cellData.Number)
            {
                WithdrawNumberCount++;
                cellData.HighlightNormalNumber(true, markerData, ignoreMarker);
                cellData.isNumberSelected = true;
                cellData.Stop_NumberBlink();
                if (playSound)
                    SoundManager.Instance.TicketNumberSelection();

                // Set the corresponding index in the array to 1
                if (index >= 0 && index < yourArray.Length)
                {
                    //Debug.Log("-------");
                    yourArray[index] = 1;
                }
            }

            index++;
        }
    }

    public void HighlightLuckyNumber(int luckyNumber)
    {
        foreach (BingoTicketSingleCellData cellData in ticketCellList)
        {
            if (luckyNumber == cellData.Number)
            {
                cellData.HighlightLuckyNumber(true);
                cellData.isLuckyNumberSelected = true;
            }
            else
            {
                cellData.HighlightLuckyNumber(false);
                cellData.isLuckyNumberSelected = false;
            }
        }
    }

    public static int ReverseSortBySelectedNumber(BingoTicket b1, BingoTicket b2)
    {
        //return b2.Pattern_Remaining_Cell_Count.CompareTo(b1.Pattern_Remaining_Cell_Count);
        return b2.SelectedNumberCount.CompareTo(b1.SelectedNumberCount);
    }
    #endregion

    #region PRIVATE_METHODS
    private void SetTicketColor(string color)
    {
        ticketColorData = Utility.Instance.GetTicketColorData(color);

        colorTextLabels = ticketColorData.colorTextLabels;
        colorTicket = ticketColorData.colorTicket;
        colorGrid = ticketColorData.colorGrid;
        colorGridMarker = ticketColorData.colorGridMarker;
        colorNormalText = ticketColorData.colorNormalText;
        colorMarkerText = ticketColorData.colorMarkerText;
        colorLuckyNumberText = ticketColorData.colorLuckyNumberText;

        imgTicket.color = colorTicket;

        txtTicketNumber.color = colorTextLabels;
        txtTicketPrice.color = colorTextLabels;

        txtHallLabel.color = colorTextLabels;
        txtHallName.color = colorTextLabels;
        txtSupplierLabel.color = colorTextLabels;
        txtSupplierName.color = colorTextLabels;
        txtDeveloperLabel.color = colorTextLabels;
        txtDeveloperName.color = colorTextLabels;
        txtDeveloperName1.color = colorTextLabels;

        foreach (BingoTicketSingleCellData cell in ticketCellList)
            cell.ModifyGridAndTextColor(
                colorGrid,
                colorNormalText,
                colorMarkerText,
                colorLuckyNumberText,
                colorGridMarker
            );
    }
    #endregion

    #region COROUTINES
    IEnumerator ShowTicketDetailsAnimation()
    {
        isFlipAnimationRunning = true;

        Utility.Instance.RotateObject(
            this.transform,
            new Vector3(0, 0, 0),
            new Vector3(0, 90, 0),
            ticketRotationTime
        );
        yield return new WaitForSeconds(ticketRotationTime);

        gameObjectTicketData.SetActive(false);
        deleteBtn.gameObject.SetActive(false);
        gameObjectDetails.SetActive(true);

        Utility.Instance.RotateObject(
            this.transform,
            new Vector3(0, 90, 0),
            new Vector3(0, 0, 0),
            ticketRotationTime
        );
        yield return new WaitForSeconds(ticketRotationTime);

        isFlipAnimationRunning = false;

        yield return new WaitForSeconds(ticketDetailPageTime - ticketRotationTime);

        StartCoroutine(HideTicketDetailsAnimation());
    }

    IEnumerator HideTicketDetailsAnimation()
    {
        isFlipAnimationRunning = true;

        Utility.Instance.RotateObject(
            this.transform,
            new Vector3(0, 0, 0),
            new Vector3(0, 90, 0),
            ticketRotationTime
        );
        yield return new WaitForSeconds(ticketRotationTime);

        gameObjectTicketData.SetActive(true);
        if (UIManager.Instance.game1Panel.gameObject.activeSelf || UIManager.Instance.game2Panel.gameObject.activeSelf || UIManager.Instance.game3Panel.gameObject.activeSelf)
        {
            if (UIManager.Instance.game1Panel.game1GamePlayPanel.isTimerRecieved || UIManager.Instance.game2Panel.game2PlayPanel.isTimerRecieved || UIManager.Instance.game3Panel.game3GamePlayPanel.isTimerRecieved)
            {
                Debug.Log("deleteBtn.gameObject.SetActive(false)");
                deleteBtn.gameObject.SetActive(false);
            }
            else
            {
                // For large tickets and traffic light tickets, only show delete button on the last ticket of the group
                if (UIManager.Instance.game1Panel.gameObject.activeSelf &&
                    (gameTicketData.IsLargeTicket() || UIManager.Instance.game1Panel.Game_1_Data.gameName.Equals("Traffic Light")))
                {
                    var ticketList = UIManager.Instance.game1Panel.game1GamePlayPanel.ticketList;
                    int currentIndex = -1;

                    // Find current ticket index
                    for (int i = 0; i < ticketList.Count; i++)
                    {
                        if (this.gameTicketData.ticketNumber == ticketList[i].gameTicketData.ticketNumber)
                        {
                            currentIndex = i;
                            break;
                        }
                    }

                    // Only show delete button if this is the last ticket in the group (index % 3 == 2)
                    if (currentIndex != -1 && currentIndex % 3 == 2)
                    {
                        Debug.Log("deleteBtn.gameObject.SetActive(true) - Last ticket in group");
                        deleteBtn.gameObject.SetActive(true);
                    }
                    else
                    {
                        Debug.Log("deleteBtn.gameObject.SetActive(false) - Not last ticket in group");
                        deleteBtn.gameObject.SetActive(false);
                    }
                }
                else
                {
                    Debug.Log("deleteBtn.gameObject.SetActive(true)");
                    deleteBtn.gameObject.SetActive(true);
                }
            }
        }

        gameObjectDetails.SetActive(false);
        if (bingoResultPanel.gameObject.activeSelf)
        {
            bingoResultPanel.Close();
        }

        Utility.Instance.RotateObject(this.transform, new Vector3(0, 90, 0), new Vector3(0, 0, 0), ticketRotationTime);
        yield return new WaitForSeconds(ticketRotationTime);

        isFlipAnimationRunning = false;
    }
    #endregion

    #region GETTER_SETTER
    public string TicketId
    {
        get { return gameTicketData.id; }
        set { gameTicketData.id = value; }
    }

    public string TicketNumber
    {
        get { return gameTicketData.ticketNumber; }
    }

    public int SelectedNumberCount
    {
        get
        {
            int count = 0;
            foreach (BingoTicketSingleCellData cellData in ticketCellList)
            {
                if (cellData.isNumberSelected)
                    count++;
            }
            return count;
        }
    }

    public List<int> TicketCellNumberList
    {
        get
        {
            List<int> markerDataList = new List<int>();
            foreach (BingoTicketSingleCellData data in ticketCellList)
                markerDataList.Add(data.isNumberSelected == true ? 1 : 0);

            return markerDataList;
        }
    }
    public bool TicketCompleted
    {
        set
        {
            gameTicketData.ticketCompleted = value;
            if (bingoResultPanel && value)
            {
                if (this.gameObject.activeSelf)
                    bingoResultPanel.TicketCompleteAction();
                bingoResultPanel.WonAmount = WonAmount;
            }
        }
        get { return gameTicketData.ticketCompleted; }
    }

    public string PatternWonResult
    {
        set
        {
            if (bingoResultPanel)
            {
                bingoResultPanel.PatternWinningAction(value);
                if (txtWonAmount != null)
                {
                    bingoResultPanel.WonAmount = WonAmount;
                }
            }
        }
    }

    public string WonAmount
    {
        get { if (txtWonAmount != null) return txtWonAmount.text.ToString(); else return ""; }
        set { if (txtWonAmount != null) txtWonAmount.text = Constants.LanguageKey.WonMessage + " : " + value + " Kr"; }
    }
    #endregion
}
