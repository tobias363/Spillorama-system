using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public partial class Game5GamePlayPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtLastWithdrawNumber;
    [SerializeField] private TextMeshProUGUI txtWithdrawNumberStats;

    [Header("Button")]
    [SerializeField] private Button btnPlay;

    [Header("Game Object")]
    [SerializeField] private GameObject objectDetailPanel;

    [Header("Panels")]
    // [SerializeField] private UtilityMessagePanel messagePopup;
    [SerializeField] private UtilityLoaderPanel loaderPanel;

    [Header("Transform")]
    [SerializeField] private Transform transformPatternContainer;
    [SerializeField] private Transform transformTicketContainer;


    [Header("Prefabs")]
    [SerializeField] private PrefabBingoGame5Ticket3x3 prefabBingoGame5Ticket3X3;
    [SerializeField] private PrefabBingoGame5Pattern prefabBingoGame5Pattern;


    [Header("Ticket colours")]
    public Color32 blue;
    public Color32 green;
    public Color32 red;
    public Color32 purple;

    [Header("Ticket Images")]
    public Sprite spriteBlue;
    public Sprite spriteGreen;
    public Sprite spriteRed;
    public Sprite spritePurple;

    [Header("Mini Games")]
    public Game5FreeSpinJackpot game5FreeSpinJackpot;
    public Game5JackpotRouletteWheel game5JackpotRouletteWheel;


    [Header("Data")]
    [SerializeField] public Game5Data game5Data;
    [SerializeField] public BingoGame5FinishResponse bingoGame5FinishResponse;
    private List<PrefabBingoGame5Ticket3x3> ticketList = new List<PrefabBingoGame5Ticket3x3>();
    private List<PrefabBingoGame5Pattern> patternList = new List<PrefabBingoGame5Pattern>();

    [SerializeField] private ActivateGame5JackpotMiniGameResponse miniGameData;


    private bool _isGamePlayInProcess = false;
    private bool _isTicketOptionEnable = false;


    [Header("Roulette Wheel Controller")]
    public GameObject roulateSpinnerElements;
    [SerializeField] public DrumRotation roulateSpinner;
    public List<GameObject> txtRoulettePlatesSelect;
    public GameObject rouletteWheel;
    public GameObject[] balls;

    [Header("Center Ball Elements")]
    [SerializeField] private SpriteRenderer spriteCenterBall;
    [SerializeField] private TextMesh spriteCenterBallText;

    public bool isMiniGameActivated = false;

    [Header("Co-Routines")]
    Coroutine Co_Routines_OnGameFinished;

    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        UIManager.Instance.isGame5 = true;

        GameSocketManager.OnSocketReconnected += Reconnect;

        EnableBroadcasts();
        CloseMiniGames();
        roulateSpinnerElements.SetActive(UIManager.Instance.Game5ActiveElementAction());
        if (UIManager.Instance.isBreak)
        {
            CallSubscribeRoom();
            UIManager.Instance.breakTimePopup.OpenPanel("null");
        }
        else
        {
            CallSubscribeRoom();
        }
    }

    private void OnDisable()
    {
        SoundManager.Instance.StopNumberAnnouncement();
        UIManager.Instance.isGame5 = false;

        GameSocketManager.OnSocketReconnected -= Reconnect;

        DisableBroadcasts();
        if (Application.isPlaying && game5Data != null && !string.IsNullOrEmpty(game5Data.gameId))
        {
            EventManager.Instance.UnSubscribeGame5Room(UIManager.Instance.game5Panel.game5GamePlayPanel.game5Data.gameId, (socket, packet, args) =>
            {
                Debug.Log("UnSubscribeGame5Room Response: " + packet.ToString());
            });
        }
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void SetData(Game5Data game5data = null)
    {
        this.game5Data = game5data;
        Reset();
        GenerateRoulateBallData();
        GeneratePatterns(game5Data.patternList);
        GenerateTickets(game5Data);
        RefreshwithdrawBalls();
        CallPlayerHallLimitEvent();
    }

    private void RefreshwithdrawBalls()
    {
        foreach (BingoNumberData bingoNumberData in game5Data.withdrawBalls)
        {
            WithdrawBingoBallAction(bingoNumberData);
            HighlightBall(GetTargetPlateIndex(bingoNumberData.number), true);
        }
    }

    /// <summary>
    /// This is a custom UI handling function. Code normalization is remain.
    /// </summary>
    /// <param name="totalActiveGames"></param>
    #endregion

    #region PRIVATE_METHODS

    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER

    public int TotalWithdrawCount
    {
        set
        {
            var locParamsManager = txtWithdrawNumberStats.GetComponent<LocalizationParamsManager>();
            locParamsManager.SetParameterValue("completed", value.ToString());
            locParamsManager.SetParameterValue("total", game5Data.totalWithdrawableBalls.ToString());
        }
    }

    public int LastWithdrawNumber
    {
        set
        {
            txtLastWithdrawNumber.text = value.ToString();
        }
    }

    public bool IsGamePlayInProcess
    {
        set
        {
            _isGamePlayInProcess = value;
            btnPlay.interactable = !value;
            roulateSpinner.IsRotating = value;
        }
        get
        {
            return _isGamePlayInProcess;
        }
    }

    public Color32 PickColor(string colorName)
    {
        switch (colorName.ToLower())
        {
            case "blue":
                return blue;
            case "green":
                return green;
            case "red":
                return red;
            case "purple":
                return purple;
            default:
                Debug.LogWarning($"Unknown color: {colorName}");
                return Color.black; // Default color or handle as needed
        }
    }

    public Sprite PickColorSprite(string spriteName)
    {
        switch (spriteName.ToLower())
        {
            case "blue":
                return spriteBlue;
            case "green":
                return spriteGreen;
            case "red":
                return spriteRed;
            case "purple":
                return spritePurple;
            default:
                Debug.LogWarning($"Unknown Sprite: {spriteName}");
                return spriteBlue;

        }
    }

    #endregion
}
