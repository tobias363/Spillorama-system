using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using Assets.Plugins.Drop3DEffects.Scripts;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

public static class Extention
{
    public static string ToTime(this float secounds)
    {
        return $"{(secounds / 60):00}:{(secounds % 60):00}";
    }
}

public partial class UIManager : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public static UIManager Instance = null;

    [SerializeField] private Image bingoBtnLoginPanel;
    [SerializeField] private Image bingoBtnTopBarPanel;
    [SerializeField] private Sprite bingoBtnYellow;
    [SerializeField] private Sprite bingoBtnGrey;

    public bool isBreak;
    public bool isGame2 = false;
    public bool isGame3 = false;
    public bool isGame4 = false;
    public bool isGame4Theme1 = false;
    public bool isGame4Theme2 = false;
    public bool isGame4Theme3 = false;
    public bool isGame4Theme4 = false;
    public bool isGame4Theme5 = false;
    public bool isGame5 = false;
    public DateTimeOffset startBreakTime;
    public DateTimeOffset endBreakTime;

    [HideInInspector] public bool isGameWebGL = false;
    [HideInInspector] public string pendingHostGameNumber = "";

    public Canvas canvas;
    public GameAssetData gameAssetData;
    public KeyboardScript keyboardWin;
    public SplashScreenPanel splashScreenPanel;
    public BingoHallDisplay bingoHallDisplayPanel;
    public LoginPanel loginPanel;
    public SignupPanel signupPanel;
    public ForgotPasswordPanel forgotPasswordPanel;
    public TopBarPanel topBarPanel;
    public LobbyPanel lobbyPanel;
    public BreakTimer breakTimePopup;
    public NotificationPanel notificationPanel;
    public ProfilePanel profilePanel;
    public SettingPanel settingPanel;
    public SubSettingPanel subSettingPanel;
    public UtilityMessagePanel messagePopup;
    public UtilityMessagePanel deleteMessagePopup;
    public UtilityLoaderPanel loaderPanel;
    public MultipleSelectionPanel MultiSelectionPanel;
    public SelectPurchaseTypePanel selectPurchaseTypePanel;
    public WithdrawNumberHistoryPanel withdrawNumberHistoryPanel;
    public MultipleGameScreenManager multipleGameScreenManager;
    public SplitScreenGameManager splitScreenGameManager;
    public AdminExtraGameNotifications adminExtraGameNotifications;
    public webViewManager webViewManager;
    public UpdateManager UpdateManager;

    [Header("Bingo Games")]
    public Game1Panel game1Panel;
    public Game2Panel game2Panel;
    public Game3Panel game3Panel;
    public Game4Panel game4Panel;
    public Game5Panel game5Panel;

    [Header("Background Sprites")]
    [SerializeField] private Sprite spriteBackground1;
    [SerializeField] private Sprite spriteBackground2;
    [SerializeField] private Sprite spriteBackground3;
    [SerializeField] private Sprite spriteBackground4;
    [SerializeField] private Sprite spriteBackground5;

    [Header("Ticket Marker Data List")]
    [SerializeField] private TicketMarkerCellData marker1Data;
    [SerializeField] private TicketMarkerCellData marker2Data;
    [SerializeField] private TicketMarkerCellData marker3Data;
    [SerializeField] private TicketMarkerCellData marker4Data;
    [SerializeField] private TicketMarkerCellData marker5Data;
    [SerializeField] private TicketMarkerCellData marker6Data;
    [SerializeField] private TicketMarkerCellData marker7Data;

    [Header("Emoji Sprite")]
    [SerializeField] private List<Sprite> emojiSpriteList;

    [Header("Cursor Sprite")]
    public Texture2D handCursor;
    public Texture2D arrowCursor;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtNotificationUpperTray;
    [SerializeField] private TextMeshProUGUI txtNotificationUpperTray2;

    [Header("Winner Animation Components")]
    [SerializeField] private Animator3D Animations;
    [SerializeField] private Transform Model;

    [Header("Player")]
    [SerializeField] internal string Player_Hall_ID;
    [SerializeField] internal string Player_Hall_Name;
    [SerializeField] internal string selectedLanguage;

    internal int Current_Game_Number;

    [Header("Safe-Area-Border")]
    public RectTransform Left_Safe_Area_Border;
    public RectTransform Right_Safe_Area_Border;

    public Sprite Elvis_Icon;

    [Header("Co Routines")]
    private Coroutine closeNotificationCoroutine;

    [HideInInspector] public MonoBehaviour previouslyActiveGamePanel;
    [HideInInspector] public bool previouslyActiveGame4Theme1;
    [HideInInspector] public bool previouslyActiveGame4Theme2;
    [HideInInspector] public bool previouslyActiveGame4Theme3;
    [HideInInspector] public bool previouslyActiveGame4Theme4;
    [HideInInspector] public bool previouslyActiveGame4Theme5;
    #endregion

    #region UNITY_CALLBACKS
    private void Start()
    {
        Debug.Log("CultureInfo Updated");
        CultureInfo culture = new CultureInfo("en-US");
        System.Threading.Thread.CurrentThread.CurrentCulture = culture;
        System.Threading.Thread.CurrentThread.CurrentUICulture = culture;
        keyboardWin.Close();
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        Debug.Log("Downloading Tray App");
        StartCoroutine(UpdateManager.DownloadAndInstallTrayApp());
#endif
    }

    private void Awake()
    {
        Instance = this;

        CloseAllCanvasChildPanels();
        splashScreenPanel.Open();

#if UNITY_WEBGL
        if (SceneManager.GetActiveScene().name == "Game")
        {
            Debug.LogWarning("its Playing of 'Game' Scene name");
            isGameWebGL = true;
        }
        else
        {
            Debug.LogWarning("its Playing Outside of 'Game' Scene name");
            isGameWebGL = false;
        }
#else
        isGameWebGL = false;
#endif

        Debug.Log($"[Recovery] UIManager.Awake scene='{SceneManager.GetActiveScene().name}' isGameWebGL={isGameWebGL}");
    }

    private void OnDisable()
    {
        UIManager.Instance.gameAssetData.IsLoggedIn = false;
    }
    #endregion

    #region PANEL_STATE
    public void CloseAllSubPanels()
    {
        notificationPanel.Close();
        profilePanel.Close();
        settingPanel.Close();
        subSettingPanel.Close();
        lobbyPanel.Close();
    }

    public void CloseAllGameElements()
    {
        if (UIManager.Instance.game5Panel.isActiveAndEnabled)
        {
            UIManager.Instance.game5Panel.game5GamePlayPanel.rouletteSpinnerElements.SetActive(false);
        }
    }

    public void ActiveAllGameElements()
    {
        Debug.Log("ActiveAllGameElements");
        if (UIManager.Instance.game5Panel.isActiveAndEnabled)
        {
            UIManager.Instance.game5Panel.game5GamePlayPanel.rouletteSpinnerElements.SetActive(true);
        }

        UIManager.Instance.game5Panel.game5GamePlayPanel.rouletteSpinnerElements.SetActive(Game5ActiveElementAction());
    }

    public void CloseAllPanels()
    {
        splashScreenPanel.Close();
        bingoHallDisplayPanel.Close();
        loginPanel.Close();
        signupPanel.Close();
        forgotPasswordPanel.Close();
        lobbyPanel.Close();
        notificationPanel.Close();
        profilePanel.Close();
        settingPanel.Close();
        subSettingPanel.Close();
        selectPurchaseTypePanel.Close();

        if (Utility.Instance.IsStandAloneVersion())
        {
            multipleGameScreenManager.CloseResetPanel();
            splitScreenGameManager.CloseResetPanel();
        }
        else
        {
            multipleGameScreenManager.Close();
            game1Panel.Close();
            game2Panel.Close();
            game3Panel.Close();
            game4Panel.Close();
            game5Panel.Close();
        }

        MultiSelectionPanel.Close();
    }

    private void CloseAllCanvasChildPanels()
    {
        for (int i = 0; i < canvas.transform.childCount; i++)
        {
            canvas.transform.GetChild(i).gameObject.SetActive(false);
        }
    }
    #endregion

    #region GETTER_SETTER
    public int EmojiCount
    {
        get { return emojiSpriteList.Count; }
    }
    #endregion
}

public static class GameId
{
    public const int ID2 = 2;
    public const int ID3 = 3;
    public const int ID4 = 4;
    public const int ID5 = 5;
    public const int ID6 = 6;
}
