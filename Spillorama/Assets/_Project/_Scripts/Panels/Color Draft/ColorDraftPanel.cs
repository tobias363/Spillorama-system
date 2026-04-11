using BestHTTP.SocketIO;
using I2.Loc;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class ColorDraftPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public bool Can_Click_On_Door;
    public bool isForceReset = true;
    #endregion

    #region PRIVATE_VARIABLES    
    [Header("Images")]
    [SerializeField] private Image imgBackground;

    [Header("Colors")]
    [SerializeField] private Color32 colorDoorNumberText;
    [SerializeField] private Color32 colorPrizeText;

    [Header("Door colours")]
    public Color32 yellow;
    public Color32 green;
    public Color32 red;


    [Header("Prefabs")]
    [SerializeField] private PrefabColorDraft prefabColorDraft;

    [Header("Transform")]
    [SerializeField] private Transform transformContainer;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTimer;
    [SerializeField] private TextMeshProUGUI txtGameName;

    [Header("Button")]
    [SerializeField] private Button btnBackToLobby;
    [SerializeField] private Button btnBack;

    [Header("Game Objects")]
    [SerializeField] private GameObject timerPanel;
    public PanelMiniGameWinners PanelMiniGameWinners;
    private ColorDraftGameData colorDraftGameData;
    private string gameId = "";
    private Socket socket;

    [Header("Serilize Data")]
    [SerializeField] private StartMiniGameBroadcast startMiniGameBroadcast;
    [SerializeField] private PrefabColorDraft[] prefabColorDrafts;

    private bool gamePlayed = false;
    int autoTurnTime = 10;
    private bool autoTurnEventCallPending = false;
    private int turnCount = 1;
    public bool Is_Game_4 = false;

    private float autoTurnWaitingTimeFirstMove = 20; // this time is arived from backend in Game 1
    private float autoTurnWaitingTimeOtherMove = 10; // this time is arived from backend in Game 1

    Coroutine WaitingMessageCoroutine = null;
    Coroutine autoTurnCoroutine = null;
    Coroutine autoBackToLobbyCoroutine = null;
    public bool isPaused = false;
    private bool isGameOver = false;

    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        if (btnBackToLobby)
            btnBackToLobby.gameObject.SetActive(!Utility.Instance.IsSplitScreenSupported);

        //Reset();

        GameSocketManager.OnSocketReconnected += Reconnect;
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;

        // Stop all running coroutines to prevent them from continuing in the background
        StopAllRunningCoroutines();

        socket.Off(Constants.BroadcastName.selectColorDraftIndex);
        socket.Off(Constants.BroadcastName.toggleGameStatus);

#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            socket.Off(Constants.BroadcastName.colordraftGameFinished);
        }
        else
        {
            socket.Off(Constants.BroadcastName.colordraftGameFinishedAdmin);
        }
#endif

        socket.Off(Constants.BroadcastName.colordraftGameFinished);

    }

    private void Reconnect()
    {
        //if (autoTurnEventCallPending)
        //{
        //    AutoTurnSelectChest();
        //}
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void Open(Socket socket, string gameId, ColorDraftGameData colorDraftGameData, Sprite backgroundSprite = null, bool isPaused = false, string pauseGameMessage = "", string gameName = "")
    {
        this.socket = socket;
        this.gameId = gameId;
        this.colorDraftGameData = colorDraftGameData;
        turnCount = 1;
        if (backgroundSprite)
            imgBackground.sprite = backgroundSprite;

        this.Open();
        this.isPaused = isPaused;
        Debug.Log("[ColorDraft] Open - Timer isPaused: " + this.isPaused);
        socket.Off(Constants.BroadcastName.selectColorDraftIndex);
        socket.Off(Constants.BroadcastName.toggleGameStatus);

        socket.On(Constants.BroadcastName.selectColorDraftIndex, Select_ColorDraft);
        socket.On(Constants.BroadcastName.toggleGameStatus, On_ColorDraft_Game_toggleGameStatus);

#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            socket.Off(Constants.BroadcastName.colordraftGameFinished);
            socket.On(Constants.BroadcastName.colordraftGameFinished, ColorDraftGameFinishedResponse);
        }
        else
        {
            socket.Off(Constants.BroadcastName.colordraftGameFinishedAdmin);
            socket.On(Constants.BroadcastName.colordraftGameFinishedAdmin, ColorDraftGameFinishedAdminResponse);
        }
#else
        socket.Off(Constants.BroadcastName.colordraftGameFinished);
        socket.On(Constants.BroadcastName.colordraftGameFinished, ColorDraftGameFinishedResponse);
#endif
        UIManager.Instance.messagePopup.Close();

        btnBack.gameObject.SetActive(false);
#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;
        autoTurnWaitingTimeFirstMove = colorDraftGameData.autoTurnMoveTime;
        autoTurnWaitingTimeOtherMove = colorDraftGameData.autoTurnReconnectMovesTime;

        autoTurnEventCallPending = false;
        txtTimer.text = "";
        gamePlayed = false;
        isGameOver = false;

        InitialColorDraft();

        //Unlock All Doors if Reconnect Player 
        if (colorDraftGameData.miniGameData.history != null && colorDraftGameData.miniGameData.history != null)
        {
            isForceReset = false;
            foreach (ColorDraftHistory historyEntry in colorDraftGameData.miniGameData.history)
            {
                turnCount++;
                prefabColorDrafts[historyEntry.selectedIndex - 1].OpenDoor(historyEntry.amount, historyEntry.color, false);
            }
        }
        else
        {
            Debug.Log("History is null or Count 0");
        }

        StartAutoTurn();

        // if (isPaused)
        // {
        //     // SoundManager.Instance.BingoSound();
        //     // UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
        //     this.isPaused = true;
        //     txtTimer.text = "00:" + autoTurnWaitingTimeOtherMove.ToString("00");
        //     Debug.Log("Paused State in ReconnectOpen");
        // }
        // else
        // {
        //     this.isPaused = false;
        //     txtTimer.text = "00:" + autoTurnWaitingTimeOtherMove.ToString("00");
        //     Debug.Log("Resume State in ReconnectOpen :" + gameObject.name);
        // }
        CloseTimer(colorDraftGameData.showAutoTurnCount);
    }

    public void CloseTimer(bool showAutoTurnCount)
    {
        if (showAutoTurnCount)
        {
            timerPanel.SetActive(true);
        }
        else
        {
            timerPanel.SetActive(false);
        }
    }

    private void ColorDraftGameFinishedAdminResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("ColorDraftGameFinishedAdmin Response: " + packet.ToString());
        //gameFinishEventCallPending = false;
        StartMiniGameBroadcast response = JsonUtility.FromJson<StartMiniGameBroadcast>(Utility.Instance.GetPacketString(packet));
        startMiniGameBroadcast = response;
    }

    private void ColorDraftGameFinishedResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("colordraftGameFinished Response: " + packet.ToString());
        colordraftGameFinished response = JsonUtility.FromJson<colordraftGameFinished>(Utility.Instance.GetPacketString(packet));
        WaitingMessageCoroutine = StartCoroutine(WaitingMessage(response.playerFinalWinningAmount));
    }


    private IEnumerator WaitingMessage(double playerFinalWinningAmount)
    {
        yield return new WaitForSeconds(3);
        UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", playerFinalWinningAmount.ToString()), 5);
        StopCoroutine(WaitingMessageCoroutine);
    }

    public void OnBackButtonTap()
    {
        this.Close();
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            if (Is_Game_4)
                UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame4ButtonTap();
            else
                UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame1ButtonTap();
        }
        else
        {
            PanelMiniGameWinners.Close();
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(false);
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(true);
        }

#else
        if (Is_Game_4)
            UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame4ButtonTap();
        else
            UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame1ButtonTap();
#endif
    }

    public void OnBackToLobbyButtonTap()
    {
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
        else
        {
            this.Close();
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(false);
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(true);
        }
#else
        UIManager.Instance.topBarPanel.OnGamesButtonTap();
#endif
    }

    void InitialColorDraft()
    {
        // Init Doors when Game Open
        for (int i = 0; i <= 11; i++)
        {
            prefabColorDrafts[i].SetData(this, i + 1);
        }
    }

    public void ColorDraftOpenFunction(PrefabColorDraft prefabColorDraft, int doorNo)
    {
        Debug.Log("ispaused return..... " + "isPaused -> " + isPaused + " Can_Click_On_Door ->" + Can_Click_On_Door + " isGameOver ->" + isGameOver);

        // Don't allow clicks if game is over
        if (isGameOver)
            return;

        if (isPaused)
            return;

        Debug.Log("Can_Click_On_Door return..... " + "isPaused -> " + isPaused + " Can_Click_On_Door ->" + Can_Click_On_Door);

        if (!Can_Click_On_Door)
            return;

#if UNITY_WEBGL
        string playerType = "Admin";
        if (UIManager.Instance.isGameWebGL)
        {
            playerType = "Real";
        }
        else
        {
            playerType = "Admin";
        }
#else
            string playerType = "Real";
#endif
        //if (gamePlayed)
        //    return;
        Debug.Log("ColorDraftOpenFunction: " + prefabColorDraft.gameObject.name + " " + doorNo + "isPaused -> " + isPaused + " Can_Click_On_Door ->" + Can_Click_On_Door + "playerType ->" + playerType);

        EventManager.Instance.SelectColorDraft(socket, gameId, playerType, turnCount, doorNo, (socket, packet, args) =>
        {
            Debug.Log("SelectColorDraft response: " + packet.ToString());
            //UIManager.Instance.DisplayLoader(false);
            this.prefabColorDraft = prefabColorDraft;
            EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            if (response.status == Constants.EventStatus.SUCCESS)
            {
                Debug.Log("SelectColorDraft Success");
            }
            else
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        });
    }
    #endregion

    #region PRIVATE_METHODS
    private void StartAutoTurn()
    {
        // Don't start timer if game is already over
        // if (isGameOver)
        // {
        //     Debug.LogWarning("[ColorDraft] StartAutoTurn blocked - game is already over");
        //     return;
        // }

        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
        }

        Debug.Log($"[ColorDraft] StartAutoTurn - Starting timer with {(isForceReset ? autoTurnWaitingTimeFirstMove : autoTurnWaitingTimeOtherMove)} seconds");
        autoTurnCoroutine = StartCoroutine(AutoTurn());
    }

    private void StopTimer()
    {
        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
            autoTurnCoroutine = null;
        }
        txtTimer.text = "";
    }

    private void StopAllRunningCoroutines()
    {
        // Stop timer coroutine
        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
            autoTurnCoroutine = null;
        }

        // Stop auto back to lobby coroutine
        if (autoBackToLobbyCoroutine != null)
        {
            StopCoroutine(autoBackToLobbyCoroutine);
            autoBackToLobbyCoroutine = null;
        }

        // Stop waiting message coroutine
        if (WaitingMessageCoroutine != null)
        {
            StopCoroutine(WaitingMessageCoroutine);
            WaitingMessageCoroutine = null;
        }

        txtTimer.text = "";
    }


    void On_ColorDraft_Game_toggleGameStatus(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("On_ColorDraft_Game_toggleGameStatus: " + packet.ToString());
        toggleGameStatus res = JsonUtility.FromJson<toggleGameStatus>(Utility.Instance.GetPacketString(packet));
        if (res.status.Equals("Pause"))
        {
            // SoundManager.Instance.BingoSound(true);
            // UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
            isPaused = true;
        }
        else if (res.status.Equals("Resume"))
        {
            // UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(Constants.LanguageKey.GameResumedByAdminMessage, true);
            isPaused = false;
        }
        else
        {
            // UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(Constants.LanguageKey.GameResumedByAdminMessage, true);
            isPaused = false;
        }
    }


    private void Select_ColorDraft(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("selectColorDraftIndex response: " + packet.ToString());
        SelectColorDraftIndex response = JsonUtility.FromJson<SelectColorDraftIndex>(Utility.Instance.GetPacketString(packet));
        turnCount = response.turnCount + 1;
        prefabColorDrafts[response.selectedIndex - 1].OpenDoor(response.amount, response.color);
        Debug.LogError("is GmeOver :" + response.isGameOver);

        if (response.isGameOver)
        {
            isGameOver = true;
            StopTimer();
            Can_Click_On_Door = false;
            if (autoBackToLobbyCoroutine != null)
            {
                StopCoroutine(autoBackToLobbyCoroutine);
            }
            autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
        }
        else
        {
            // Only restart timer if game is not over
            if (!isGameOver)
            {
                if (autoTurnCoroutine != null)
                {
                    StopCoroutine(autoTurnCoroutine);
                }
                autoTurnCoroutine = StartCoroutine(AutoTurn());
            }
        }
    }

    IEnumerator Auto_Back_To_Lobby()
    {
        yield return new WaitForSeconds(5f);

#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            // PanelMiniGameWinners.OpenData(startMiniGameBroadcast.winningTicketNumbers);
            UIManager.Instance.bingoHallDisplayPanel.OpenResultPanel(startMiniGameBroadcast);
        }
#endif

        float time = 12f;
        Debug.LogError("Before 12 OnBackButtonTap");
        while (time > 0f)
        {
            time -= Time.deltaTime;
            yield return new WaitForEndOfFrame();
        }
        if (gameObject.activeSelf)
        {
            Debug.LogError("After OnBackButtonTap");
            OnBackButtonTap();
        }
    }

    #endregion

    #region COROUTINES


    IEnumerator AutoTurn()
    {
        autoTurnTime = isForceReset ? (int)autoTurnWaitingTimeFirstMove : (int)autoTurnWaitingTimeOtherMove;

        if (!isForceReset)
            isForceReset = true;

        Debug.Log($"[ColorDraft] AutoTurn coroutine started with {autoTurnTime} seconds");

        for (int i = autoTurnTime; i >= 0; i--)
        {
            // Check if game is over and exit coroutine immediately
            if (isGameOver)
            {
                Debug.Log("[ColorDraft] AutoTurn - Game over detected, stopping timer");
                txtTimer.text = "";
                yield break;
            }

            txtTimer.text = "00:" + i.ToString("00");
            Debug.Log("[ColorDraft] AutoTurn - Waiting for 1 second :" + isPaused);
            // Check if the game is paused and wait until it resumes
            while (isPaused)
            {
                Debug.Log("[ColorDraft] AutoTurn - Paused, waiting for resume" + isPaused);
                // Also check for game over while paused
                if (isGameOver)
                {
                    Debug.Log("[ColorDraft] AutoTurn - Game over detected while paused");
                    txtTimer.text = "";
                    yield break;
                }
                yield return null; // Pause the coroutine
            }

            // Check the condition and pause if needed
            while (!GameSocketManager.SocketConnected)
            {
                Debug.Log("[ColorDraft] AutoTurn - Socket not connected, waiting for connection" + GameSocketManager.SocketConnected);
                // Also check for game over while disconnected
                if (isGameOver)
                {
                    Debug.Log("[ColorDraft] AutoTurn - Game over detected while disconnected");
                    txtTimer.text = "";
                    yield break;
                }
                yield return null; // Pause the coroutine
            }

            yield return new WaitForSeconds(1);
        }

        Debug.Log("[ColorDraft] AutoTurn - Timer completed");
        txtTimer.text = "";

        // Add your additional logic here if needed
    }

    //IEnumerator AutoTurn()
    //{
    //    autoTurnTime = (int)autoTurnWaitingTimeFirstMove;

    //    autoTurnTime = isForceReset ? (int)autoTurnWaitingTimeFirstMove : (int)autoTurnWaitingTimeOtherMove;

    //    if (!isForceReset)
    //        isForceReset = true;

    //    for (int i = autoTurnTime; i >= 0; i--)
    //    {
    //        txtTimer.text = "00:" + i.ToString("00");

    //        // Check the condition and pause if needed
    //        while (!GameSocketManager.SocketConnected)
    //        {
    //            yield return null; // Pause the coroutine
    //        }

    //        yield return new WaitForSeconds(1);
    //    }
    //    txtTimer.text = "";

    //    //if (Can_Click_On_Door && Is_Game_4)
    //}

    public Color32 getcolor(string colorName)
    {
        switch (colorName.ToLower())
        {
            case "yellow":
                return yellow;
            case "green":
                return green;
            case "red":
                return red;
            default:
                Debug.LogWarning($"Unknown color: {colorName}");
                return Color.black; // Default color or handle as needed
        }
    }

    #endregion

    #region GETTER_SETTER
    #endregion
}
