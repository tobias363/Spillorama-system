using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public partial class Game5GamePlayPanel : MonoBehaviour
{
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
    [SerializeField] private Color32 blue;
    [SerializeField] private Color32 green;
    [SerializeField] private Color32 red;
    [SerializeField] private Color32 purple;

    [Header("Ticket Images")]
    [SerializeField] private Sprite spriteBlue;
    [SerializeField] private Sprite spriteGreen;
    [SerializeField] private Sprite spriteRed;
    [SerializeField] private Sprite spritePurple;

    [Header("Mini Games")]
    public Game5FreeSpinJackpot game5FreeSpinJackpot;
    public Game5JackpotRouletteWheel game5JackpotRouletteWheel;


    [Header("Data")]
    [SerializeField] public Game5Data game5Data;
    [SerializeField] private BingoGame5FinishResponse bingoGame5FinishResponse;
    private List<PrefabBingoGame5Ticket3x3> ticketList = new List<PrefabBingoGame5Ticket3x3>();
    private List<PrefabBingoGame5Pattern> patternList = new List<PrefabBingoGame5Pattern>();

    [SerializeField] private ActivateGame5JackpotMiniGameResponse miniGameData;


    private bool _isGamePlayInProcess = false;
    private bool _isTicketOptionEnable = false;


    [Header("Roulette Wheel Controller")]
    public GameObject rouletteSpinnerElements;
    [SerializeField] public DrumRotation rouletteSpinner;
    [SerializeField] private List<GameObject> txtRoulettePlatesSelect;
    public GameObject rouletteWheel;
    public GameObject[] balls;

    [Header("Center Ball Elements")]
    [SerializeField] private SpriteRenderer spriteCenterBall;
    [SerializeField] private TextMesh spriteCenterBallText;

    private bool isMiniGameActivated = false;

    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        UIManager.Instance.isGame5 = true;

        EnableBroadcasts();
        CloseMiniGames();
        rouletteSpinnerElements.SetActive(UIManager.Instance.Game5ActiveElementAction());
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

        DisableBroadcasts();
    }

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
            rouletteSpinner.IsRotating = value;
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
