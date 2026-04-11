using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class TreasureChestPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public bool Can_Click_On_Box;
    public PrefabTreasureChest OpenChest;
    #endregion

    #region PRIVATE_VARIABLES    
    [Header("Images")]
    [SerializeField] private Image imgBackground;

    [Header("Sprites")]
    [SerializeField] private Sprite spriteCloseChest;
    [SerializeField] private Sprite spriteOpenChest;
    [SerializeField] private Sprite spriteBackground;

    [Header("Colors")]
    [SerializeField] private Color32 colorChestNumberText;
    [SerializeField] private Color32 colorPrizeText;

    [Header("Prefabs")]
    [SerializeField] private PrefabTreasureChest prefabTreasureChest;

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

    private List<PrefabTreasureChest> treasureChestList = new List<PrefabTreasureChest>();
    [SerializeField] private TreasureChestData treasureChestData;
    private string gameId = "";
    private Socket socket;

    private bool gamePlayed = false;
    int autoTurnTime = 10;
    private bool autoTurnEventCallPending = false;
    private PrefabTreasureChest previouseTreasureChest = null;
    [SerializeField] private StartMiniGameBroadcast startMiniGameBroadcast;

    //Curruntly Used this in WebGL
    [Header("TreasureChestWinning Area")]
    private long treasureChestWinningAmount;

    public bool Is_Game_4 = false;
    public bool isPaused = false;
    private bool isGameOver = false;

    Coroutine autoTurnCoroutine;
    Coroutine autoBackToLobbyCoroutine;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        if (btnBackToLobby)
            btnBackToLobby.gameObject.SetActive(!Utility.Instance.IsSplitScreenSupported);

        GameSocketManager.OnSocketReconnected += Reconnect;
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;
        socket.Off(Constants.BroadcastName.OpenTreasureChest);
        socket.Off(Constants.BroadcastName.toggleGameStatus);
    }

    private void Reconnect()
    {
        if (autoTurnEventCallPending)
        {
            AutoTurnSelectChest();
        }
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void Open(Socket socket, string gameId, TreasureChestData treasureChestData, int turnTimer = 10, Sprite backgroundSprite = null, string gameName = "")
    {
        this.socket = socket;
        this.gameId = gameId;
        this.treasureChestData = treasureChestData;

        InitialTreasureChest(treasureChestData.prizeList.Count);

        if (backgroundSprite)
            imgBackground.sprite = backgroundSprite;

        this.Open();
        this.isPaused = treasureChestData.isGamePaused;
        isGameOver = false;
        socket.On(Constants.BroadcastName.OpenTreasureChest, Open_Treasure_Chest);
        socket.On(Constants.BroadcastName.toggleGameStatus, On_Treasure_Game_toggleGameStatus);
        UIManager.Instance.messagePopup.Close();
        // Is_Game_4 = btnBack.interactable = btnBackToLobby.interactable = false;
        btnBack.gameObject.SetActive(false);
#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;

        previouseTreasureChest = null;
        OpenChest = null;
        autoTurnEventCallPending = false;
        txtTimer.text = "";
        gamePlayed = false;
        isGameOver = false; // Ensure timer can start

        autoTurnTime = turnTimer;
        StartAutoTurn();

        if (this.isPaused)
        {
            txtTimer.text = "00:" + autoTurnTime.ToString("00");
        }
        CloseTimer(treasureChestData.showAutoTurnCount);
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

    public void ReconnectOpen(Socket socket, string gameId, List<long> prizeList, int turnTimer, float amount, bool isPaused = false, string pauseGameMessage = "", Sprite backgroundSprite = null, string gameName = "", bool showAutoTurnCount = false, bool isMinigamePlayed = false)
    {
        this.socket = socket;
        this.gameId = gameId;

        InitialTreasureChest(prizeList.Count);
        treasureChestData.prizeList = prizeList;
        if (backgroundSprite)
            imgBackground.sprite = backgroundSprite;

        this.Open();
        this.isPaused = isPaused;

        socket.On(Constants.BroadcastName.OpenTreasureChest, Open_Treasure_Chest);
        socket.On(Constants.BroadcastName.toggleGameStatus, On_Treasure_Game_toggleGameStatus);
        if (turnTimer > 0)
        {
            autoTurnTime = turnTimer;
            StartAutoTurn();
        }
        else if (!isMinigamePlayed)
        {
            // Minigame not played yet, start fresh
            Debug.Log("ReconnectOpen - Minigame not played");
            List<long> prizeListShuffled = treasureChestData.prizeList.OrderBy(i => Guid.NewGuid()).ToList();
            autoTurnEventCallPending = false;
            gamePlayed = false;
            isGameOver = false;
            autoTurnTime = turnTimer;
            StartAutoTurn();
        }
        else
        {
            // Game already finished, show results
            List<long> prizeListShuffled = treasureChestData.prizeList.OrderBy(i => Guid.NewGuid()).ToList();
            autoTurnEventCallPending = false;
            gamePlayed = true;
            isGameOver = true;
            StopTimer();

            for (int i = 0; i < treasureChestList.Count; i++)
            { 
                treasureChestList[i].OpenChest(prizeListShuffled[i], prizeListShuffled[i] == amount);
            }

#if !UNITY_WEBGL
            BackgroundManager.Instance.PlayerUpdateIntervalCall();
#endif
            if (autoBackToLobbyCoroutine != null)
            {
                StopCoroutine(autoBackToLobbyCoroutine);
            }
            autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
        }

        UIManager.Instance.messagePopup.Close();
        // Is_Game_4 = btnBack.interactable = btnBackToLobby.interactable = false;
        btnBack.gameObject.SetActive(false);
#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;

        previouseTreasureChest = null;
        OpenChest = null;
        autoTurnEventCallPending = false;
        txtTimer.text = "";
        gamePlayed = false;
        isGameOver = false;
        autoTurnTime = turnTimer;
        StartAutoTurn();

        // if (isPaused)
        // {
        //     // SoundManager.Instance.BingoSound();
        //     // UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
        //     this.isPaused = true;
        //     txtTimer.text = "00:" + autoTurnTime.ToString("00");
        //     Debug.Log("Paused State in ReconnectOpen : " + gameObject.name);
        // }
        // else
        // {
        //     this.isPaused = false;
        //     txtTimer.text = "00:" + autoTurnTime.ToString("00");
        //     Debug.Log("Resume State in ReconnectOpen :" + gameObject.name);
        // }
        CloseTimer(showAutoTurnCount);
    }

    public void OnBackButtonTap()
    {
        isGameOver = true;

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
        this.Close();
    }

    public void OnBackToLobbyButtonTap()
    {
        isGameOver = true;
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

    public void TreasureChestOpenFunction(PrefabTreasureChest openedChest)
    {
        previouseTreasureChest = openedChest;

        OpenChest = openedChest;

        if (gamePlayed)
            return;

        if (!Can_Click_On_Box)
            return;

        string playerType = "";
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            playerType = "Real";
        }
        else
        {
            playerType = "Admin";
        }
#else
        playerType = "Real";
#endif
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.SelectTreasureChest(socket, gameId, (socket, packet, args) =>
        {
            Debug.Log("SelectTreasureChest response: " + packet.ToString());
            UIManager.Instance.DisplayLoader(false);

            EventResponse<SelectTreasureChestResponse> response = JsonUtility.FromJson<EventResponse<SelectTreasureChestResponse>>(Utility.Instance.GetPacketString(packet));
            if (response.status == Constants.EventStatus.SUCCESS)
            {
                print("SelectTreasureChest Success");

                //if (Is_Game_4)
                //{
                if (response.result.isWinningInPoints)
                {
#if UNITY_WEBGL
                    if (UIManager.Instance.isGameWebGL)
                    {
                        UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", response.result.winningPrize.ToString()), 5);
                    }
                    else
                    {
                        // UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {response.result.winningPrize} Kr", 5);
                    }
#else
                    UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", response.result.winningPrize.ToString()), 5);
#endif
                }
                else
                {
#if UNITY_WEBGL
                    if (UIManager.Instance.isGameWebGL)
                    {
                        UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", response.result.winningPrize.ToString()), 5);
                    }
                    else
                    {
                        // UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {response.result.winningPrize} Kr", 5);
                    }
#else
                    UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", response.result.winningPrize.ToString()), 5);
#endif
                }

                List<long> prizeListShuffled = treasureChestData.prizeList.OrderBy(i => Guid.NewGuid()).ToList();
                autoTurnEventCallPending = false;
                gamePlayed = true;
                isGameOver = true;
                StopTimer();
                bool winningPrizeFound = false;

                foreach (PrefabTreasureChest chest in treasureChestList)
                {
                    if (chest == openedChest)
                    {
#if UNITY_WEBGL
                        if (UIManager.Instance.isGameWebGL)
                        {
                            chest.OpenChest(response.result.actualTChestWinningPrize, true);
                        }
                        else
                        {
                            chest.OpenChest(treasureChestWinningAmount, true);
                        }
#else
                        chest.OpenChest(response.result.actualTChestWinningPrize, true);
#endif
                    }
                    else
                    {
                        if (prizeListShuffled[0] == response.result.winningPrize && !winningPrizeFound)
                        {
                            prizeListShuffled.RemoveAt(0);
                            winningPrizeFound = true;
                        }

                        chest.OpenChest(prizeListShuffled[0], false);
                        prizeListShuffled.RemoveAt(0);
                    }
                }

                //#if !UNITY_WEBGL
                //UIManager.Instance.gameAssetData.Points = response.result.points;
                //UIManager.Instance.gameAssetData.RealMoney = response.result.realMoney;
                //UIManager.Instance.gameAssetData.TodaysBalance = response.result.realMoney;
                //#endif

                if (autoBackToLobbyCoroutine != null)
                {
                    StopCoroutine(autoBackToLobbyCoroutine);
                }
                autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
                btnBack.interactable = btnBackToLobby.interactable = true;
                //}
            }
            else
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        }, playerType);
    }
    #endregion

    #region PRIVATE_METHODS
    private void InitialTreasureChest(int treasureCount)
    {
        foreach (PrefabTreasureChest chest in treasureChestList)
            Destroy(chest.gameObject);
        treasureChestList.Clear();

        for (int i = 0; i < treasureCount; i++)
        {
            PrefabTreasureChest newChest = Instantiate(prefabTreasureChest, transformContainer);
            newChest.SetData(this, (i + 1), 0, spriteCloseChest, spriteOpenChest, colorChestNumberText, Can_Click_On_Box);
            treasureChestList.Add(newChest);
        }
    }

    private void StartAutoTurn()
    {
        // Don't start timer if game is already over
        // if (isGameOver)
        // {
        //     Debug.LogWarning("[TreasureChest] StartAutoTurn blocked - game is already over");
        //     return;
        // }

        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
        }

        Debug.Log($"[TreasureChest] StartAutoTurn - Starting timer with {autoTurnTime} seconds");
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

        txtTimer.text = "";
    }

    private void AutoTurnSelectChest()
    {
        autoTurnEventCallPending = true;
        if (Application.internetReachability != NetworkReachability.NotReachable)
        {
            PrefabTreasureChest treasureChestObject = previouseTreasureChest;

            if (treasureChestObject == null)
                treasureChestObject = treasureChestList[UnityEngine.Random.Range(0, treasureChestList.Count)];

            //int chestIndex = UnityEngine.Random.Range(0, treasureChestList.Count);
            //TreasureChestOpenFunction(treasureChestList[chestIndex]);
            TreasureChestOpenFunction(treasureChestObject);
        }
    }

    private void Open_Treasure_Chest(Socket socket, Packet packet, object[] args)
    {
        btnBack.interactable = btnBackToLobby.interactable = true;
        StartMiniGameBroadcast response = JsonUtility.FromJson<StartMiniGameBroadcast>(Utility.Instance.GetPacketString(packet));
        startMiniGameBroadcast = response;
        treasureChestWinningAmount = response.amount;
        if (Can_Click_On_Box)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", response.playerFinalWinningAmount.ToString()), 5);
            }
            else
            {
                //UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {response.playerFinalWinningAmount} Kr", 5);
            }
#else
            UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", response.playerFinalWinningAmount.ToString()), 5);
#endif
        }
        //else
        //{
        //    foreach (PrefabTreasureChest chest in treasureChestList)
        //        if (chest.prize == response.amount)
        //        {
        //            OpenChest = chest;
        //            print("Chest Found");
        //            break;
        //        }
        //}

        List<long> prizeListShuffled = treasureChestData.prizeList.OrderBy(i => Guid.NewGuid()).ToList();
        autoTurnEventCallPending = false;
        gamePlayed = true;
        isGameOver = true;
        StopTimer();

        for (int i = 0; i < treasureChestList.Count; i++)
            treasureChestList[i].OpenChest(prizeListShuffled[i], prizeListShuffled[i] == response.amount);

        /*
        bool winningPrizeFound = false;
        foreach (PrefabTreasureChest chest in treasureChestList)
        {
            if (chest == OpenChest)
            {
                chest.OpenChest(response.amount, true);
            }
            else
            {
                if (prizeListShuffled[0] == response.amount && !winningPrizeFound)
                {
                    prizeListShuffled.RemoveAt(0);
                    winningPrizeFound = true;
                }

                chest.OpenChest(prizeListShuffled[0], false);
                prizeListShuffled.RemoveAt(0);
            }
            print($"Prize : {chest.prize}");
        }
        */
#if !UNITY_WEBGL
        BackgroundManager.Instance.PlayerUpdateIntervalCall();
#endif
        if (autoBackToLobbyCoroutine != null)
        {
            StopCoroutine(autoBackToLobbyCoroutine);
        }
        autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
    }

    void On_Treasure_Game_toggleGameStatus(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("On_Treasure_Game_toggleGameStatus: " + packet.ToString());
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


    IEnumerator Auto_Back_To_Lobby()
    {
        yield return new WaitForSeconds(4f);

#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            // PanelMiniGameWinners.OpenData(startMiniGameBroadcast.winningTicketNumbers);
            UIManager.Instance.bingoHallDisplayPanel.OpenResultPanel(startMiniGameBroadcast);
        }
#endif

        float time = 12f;

        while (time > 0f)
        {
            time -= Time.deltaTime;
            yield return new WaitForEndOfFrame();
        }
        if (gameObject.activeSelf)
        {
            OnBackButtonTap();
        }
    }

    #endregion
    #region COROUTINES
    IEnumerator AutoTurn()
    {
        Debug.Log($"[TreasureChest] AutoTurn coroutine started with {autoTurnTime} seconds");

        for (int i = autoTurnTime; i >= 0; i--)
        {
            // Check if game is over and exit coroutine immediately
            if (isGameOver)
            {
                Debug.Log("[TreasureChest] AutoTurn - Game over detected, stopping timer");
                txtTimer.text = "";
                yield break;
            }

            txtTimer.text = "00:" + i.ToString("00");
            Debug.Log("[TreasureChest] AutoTurn - Waiting for 1 second :" + isPaused);
            // Check if the game is paused and wait until it resumes
            while (isPaused)
            {
                Debug.Log("[TreasureChest] AutoTurn - Paused, waiting for resume :" + isPaused);
                // Also check for game over while paused
                if (isGameOver)
                {
                    Debug.Log("[TreasureChest] AutoTurn - Game over detected while paused");
                    txtTimer.text = "";
                    yield break;
                }
                yield return null; // Pause the coroutine
            }

            yield return new WaitForSeconds(1);
        }

        Debug.Log("[TreasureChest] AutoTurn - Timer completed");
        txtTimer.text = "";

        // Execute additional logic when the timer finishes (only if game is not over)
        if (!isGameOver && Can_Click_On_Box && Is_Game_4)
        {
            Debug.Log("[TreasureChest] AutoTurn - Auto-selecting chest");
            AutoTurnSelectChest();
        }
    }

    //IEnumerator AutoTurn()
    //{
    //    for (int i = autoTurnTime; i >= 0; i--)
    //    {
    //        txtTimer.text = "00:" + i.ToString("00");
    //        yield return new WaitForSeconds(1);
    //    }
    //    txtTimer.text = "";



    //    //Temp Comment When Time finished Coment By Mathew
    //    if (Can_Click_On_Box && Is_Game_4)
    //        AutoTurnSelectChest();
    //}
    #endregion

    #region GETTER_SETTER
    #endregion
}
