using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;
using BestHTTP.SocketIO;
using System;
using UnityEngine.UI;
using I2.Loc;
using System.Linq;

public class Game5JackpotRouletteWheel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    #endregion

    #region PRIVATE_VARIABLES

    private string gameId = "";
    private string ticketId = "";
    private Socket socket;
    private bool isSpinning;
    private bool isReconnectSpin = false;
    private bool callbackInvoked = false;
    private int spinCount = 0;
    private int totalSpins = 0;
    private int autoTurnTime = 10;
    private List<GameObject> spinHistoryGameObjectList = new List<GameObject>();

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTimer;
    [SerializeField] private TextMeshProUGUI txtTotalSpins;
    [SerializeField] private TextMeshProUGUI txtMultiplierRed;
    [SerializeField] private TextMeshProUGUI txtMultiplierBlack;
    [SerializeField] private TextMeshProUGUI txtMultiplierGreen;

    [Header("Prefabs")]
    [SerializeField] private GameObject spinHistoryTextPrefab;

    [Header("Container")]
    [SerializeField] private Transform spinHistoryContainer;

    [Header("Button")]
    [SerializeField] private Button btnSpin;

    [Header("Game5RouletteWheelController")]
    //[SerializeField] private Game5RouletteWheelController game5RouletteWheelController;
    [SerializeField] private BallPathRottate ballPathRottate;

    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        GameSocketManager.OnSocketReconnected += Reconnect;
    }

    private void Reconnect()
    {

    }

    private void OnDisable()
    {
        Debug.Log("OnDisable Chintan...");
        GameSocketManager.OnSocketReconnected -= Reconnect;

        socket.Off(Constants.BroadcastName.startSpinWheel);
        socket.Off(Constants.BroadcastName.rouletteWinnigs);

        UIManager.Instance.game5Panel.game5GamePlayPanel.roulateSpinnerElements.SetActive(true);
    }

    #endregion

    #region DELEGATE_CALLBACKS

    #endregion

    #region PUBLIC_METHODS
    public void SetWinningMultiplier(string red, string black, string green)
    {
        txtMultiplierRed.text = $"{red}x";
        txtMultiplierBlack.text = $"{black}x";
        txtMultiplierGreen.text = $"{green}x";
    }
    public void Open(Socket socket, string gameId, string ticketId, SpinDetails spinDetails, List<RouletteData> rouletteData)
    {
        this.socket = socket;
        this.gameId = gameId;
        this.ticketId = ticketId;
        spinCount = spinDetails.playedSpins;
        totalSpins = spinDetails.totalSpins;
        txtTotalSpins.text = Constants.LanguageKey.RemainingSpinsMessage + ":\n" +
                    spinDetails.playedSpins + "/" +
                    spinDetails.totalSpins.ToString();

        this.Open();
        ResetSpinHistory();
        isSpinningRoulette = false;

        if (spinDetails != null && spinDetails.spinHistory != null && spinDetails.spinHistory.Any())
        {
            foreach (SpinHistory spinHistoryItem in spinDetails.spinHistory)
            {
                InstantiateSpinHistory(spinHistoryItem.spinCount, spinHistoryItem.wonAmount);
            }
        }

        socket.Off(Constants.BroadcastName.startSpinWheel);
        socket.Off(Constants.BroadcastName.rouletteWinnigs);

        socket.On(Constants.BroadcastName.startSpinWheel, startSpinWheel);
        socket.On(Constants.BroadcastName.rouletteWinnigs, rouletteWinnigs);
        autoTurnTime = 10;
        StartAutoTurn();
    }

    public void ReconnectOpen(Socket socket, string gameId, string ticketId, MiniGameData miniRouletteGameData)
    {
        this.Open();
        if(UIManager.Instance.game5Panel.game5GamePlayPanel.roulateSpinnerElements.activeSelf)
        {
            UIManager.Instance.game5Panel.game5GamePlayPanel.roulateSpinnerElements.SetActive(false);
        }
        this.socket = socket;
        this.gameId = gameId;
        this.ticketId = ticketId;
        spinCount = miniRouletteGameData.gameData.spinDetails.playedSpins;
        totalSpins = miniRouletteGameData.gameData.spinDetails.totalSpins;
        txtTotalSpins.text = Constants.LanguageKey.RemainingSpinsMessage + ":\n" +
                    miniRouletteGameData.gameData.spinDetails.playedSpins + "/" +
                    miniRouletteGameData.gameData.spinDetails.totalSpins.ToString();

        this.Open();
        ResetSpinHistory();
        isSpinningRoulette = false;
        isReconnectSpin = true;
        socket.Off(Constants.BroadcastName.startSpinWheel);
        socket.Off(Constants.BroadcastName.rouletteWinnigs);

        socket.On(Constants.BroadcastName.startSpinWheel, startSpinWheel);
        socket.On(Constants.BroadcastName.rouletteWinnigs, rouletteWinnigs);

        SpinHistory lastSpin = null;

        if (miniRouletteGameData.gameData.spinDetails != null && miniRouletteGameData.gameData.spinDetails.spinHistory != null && miniRouletteGameData.gameData.spinDetails.spinHistory.Any())
        {
            List<SpinHistory> spinHistory = miniRouletteGameData.gameData.spinDetails.spinHistory;
            if (miniRouletteGameData.isMiniGameSpinning)
            {
                for (int i = 0; i < spinHistory.Count - 1; i++)
                {
                    SpinHistory spinHistoryItem = spinHistory[i];
                    InstantiateSpinHistory(spinHistoryItem.spinCount, spinHistoryItem.wonAmount);
                }
                lastSpin = spinHistory[spinHistory.Count - 1];
            }
            else
            {
                for (int i = 0; i < spinHistory.Count; i++)
                {
                    SpinHistory spinHistoryItem = spinHistory[i];
                    InstantiateSpinHistory(spinHistoryItem.spinCount, spinHistoryItem.wonAmount);
                }
            }
        }

        callbackInvoked = false;

        if (!miniRouletteGameData.isMiniGamePlayed && !miniRouletteGameData.isMiniGameFinished)
        {
            if (miniRouletteGameData.isMiniGameSpinning)
            {
                StopTimer();
                StopAllCoroutines();
                isSpinningRoulette = true;

                //game5RouletteWheelController.SpinWheel(lastSpin.rouletteBall, miniRouletteGameData.rouletteSpinRemaningTime, () =>
                //{
                //    isSpinningRoulette = false;
                //    if (!callbackInvoked)
                //    {
                //        InstantiateSpinHistory(lastSpin.spinCount, lastSpin.wonAmount);
                //        callbackInvoked = true;
                //        if (miniRouletteGameData.gameData.spinDetails.totalSpins.Equals(miniRouletteGameData.gameData.spinDetails.playedSpins))
                //        {
                //            StopTimer();
                //            StartCoroutine(Auto_Back_To_Lobby());
                //        }
                //        else
                //        {
                //            autoTurnTime = miniRouletteGameData.autoTurnMoveTime;
                //            StartAutoTurn();
                //        }
                //    }
                //}, true);

                ballPathRottate.SpinWheel(lastSpin.rouletteBall, miniRouletteGameData.rouletteSpinRemaningTime, () =>
                {
                    isSpinningRoulette = false;
                    if (!callbackInvoked)
                    {
                        InstantiateSpinHistory(lastSpin.spinCount, lastSpin.wonAmount);
                        callbackInvoked = true;
                        if (miniRouletteGameData.gameData.spinDetails.totalSpins.Equals(miniRouletteGameData.gameData.spinDetails.playedSpins))
                        {
                            StopTimer();
                            StartCoroutine(Auto_Back_To_Lobby());
                        }
                        else
                        {
                            autoTurnTime = miniRouletteGameData.autoTurnMoveTime;
                            StartAutoTurn();
                        }
                    }
                }, true);

            }
            else
            {
                if (miniRouletteGameData.gameData.spinDetails.totalSpins.Equals(miniRouletteGameData.gameData.spinDetails.playedSpins))
                {
                    StopTimer();
                    StartCoroutine(Auto_Back_To_Lobby());
                }
                else
                {
                    autoTurnTime = miniRouletteGameData.autoTurnReconnectMovesTime;
                    StartAutoTurn();
                }
            }
        }
    }

    public void spinButtonTab()
    {
        EventManager.Instance.SelectRouletteAuto(socket, gameId, ticketId, "Real", spinCount + 1, (socket, packet, args) =>
        {
            Debug.Log("SelectRouletteAuto response: " + packet.ToString());
        });

    }
    #endregion

    #region PRIVATE_METHODS


    private void rouletteWinnigs(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("rouletteWinnigs Broadcast Response : " + packet.ToString());
        Game5MiniGameWinData game5MiniGameWinData = JsonUtility.FromJson<Game5MiniGameWinData>(Utility.Instance.GetPacketString(packet));
        UIManager.Instance.DisplayNotificationUpperTray(Constants.LanguageKey.CongratulationsMessage + " " + game5MiniGameWinData.totalWonAmount.ToString() + " Kr " + Constants.LanguageKey.InRouletteMessage);
    }


    private void startSpinWheel(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("startSpinWheel Broadcast Response : " + packet.ToString());
        startRouletteWheelData startSpinWheelData = JsonUtility.FromJson<startRouletteWheelData>(Utility.Instance.GetPacketString(packet));
        isSpinningRoulette = true;
        spinCount = startSpinWheelData.spinDetails.spinHistory.Count;

        txtTotalSpins.text = Constants.LanguageKey.RemainingSpinsMessage + ":\n" +
            startSpinWheelData.spinDetails.spinHistory.Count + "/" +
            totalSpins.ToString();

        StopTimer();
        isReconnectSpin = false;

        //game5RouletteWheelController.SpinWheel(startSpinWheelData.rouletteStopAt, 10, () =>
        // {
        //     if (isReconnectSpin)
        //         return;

        //     StopAllCoroutines();
        //     StartAutoTurn();
        //     ResetSpinHistory();
        //     autoTurnTime = 10;
        //     isSpinningRoulette = false;

        //     if (startSpinWheelData.spinDetails != null && startSpinWheelData.spinDetails.spinHistory != null)
        //     {
        //         foreach (SpinHistory spinHistoryItem in startSpinWheelData.spinDetails.spinHistory)
        //         {
        //             InstantiateSpinHistory(spinHistoryItem.spinCount, spinHistoryItem.wonAmount);
        //         }
        //     }

        //     if (startSpinWheelData.isMinigameOver)
        //     {
        //         StopTimer();
        //         isSpinningRoulette = true;
        //         StartCoroutine(Auto_Back_To_Lobby());
        //     }
        // });

        ballPathRottate.SpinWheel(startSpinWheelData.rouletteStopAt, 8, () =>
        {
            if (isReconnectSpin)
                return;

            StopAllCoroutines();
            autoTurnTime = 10;
            StartAutoTurn();
            ResetSpinHistory();
            isSpinningRoulette = false;

            if (startSpinWheelData.spinDetails != null && startSpinWheelData.spinDetails.spinHistory != null)
            {
                foreach (SpinHistory spinHistoryItem in startSpinWheelData.spinDetails.spinHistory)
                {
                    InstantiateSpinHistory(spinHistoryItem.spinCount, spinHistoryItem.wonAmount);
                }
            }

            if (startSpinWheelData.isMinigameOver)
            {
                StopTimer();
                isSpinningRoulette = true;
                StartCoroutine(Auto_Back_To_Lobby());
            }
        });


    }

    private void StopTimer()
    {
        StopAllCoroutines();
        txtTimer.transform.parent.gameObject.SetActive(false);
        txtTimer.text = "";
    }

    private void StartAutoTurn()
    {
        StopAllCoroutines();
        StartCoroutine(AutoTurn());
    }

    private void ResetSpinHistory()
    {
        foreach (GameObject spinHistoryTextInstance in spinHistoryGameObjectList)
        {
            Destroy(spinHistoryTextInstance.gameObject);
        }
        spinHistoryGameObjectList.Clear();
    }

    private void InstantiateSpinHistory(int Spin, int Amount)
    {
        GameObject spinHistoryGameObject = Instantiate(spinHistoryTextPrefab, spinHistoryContainer);
        TMP_Text spinHistoryTextInstance = spinHistoryGameObject.transform.GetChild(0).gameObject.GetComponent<TMP_Text>();
        spinHistoryGameObjectList.Add(spinHistoryGameObject);
        spinHistoryTextInstance.text = Constants.LanguageKey.SpinText + " " + Spin + ": " + Amount + " kr";
        spinHistoryGameObject.transform.SetParent(spinHistoryContainer, false);
    }

    private void DeactiveMinigamesObjects()
    {
        UIManager.Instance.game5Panel.game5GamePlayPanel.game5FreeSpinJackpot.gameObject.SetActive(false);
    }


    private void OnBackButtonTap()
    {
        Debug.Log("OnBackButtonTap Chintan...");
        this.Close();
        UIManager.Instance.game5Panel.Open();
        UIManager.Instance.game5Panel.game5GamePlayPanel.roulateSpinnerElements.SetActive(true);
        UIManager.Instance.game5Panel.game5GamePlayPanel.roulateSpinner.IsRotating = false;
    }

    #endregion

    #region COROUTINES

    IEnumerator AutoTurn()
    {
        for (int i = autoTurnTime; i >= 0; i--)
        {
            txtTimer.transform.parent.gameObject.SetActive(true);
            txtTimer.text = i.ToString("00");

            if (i == 0)
            {
                txtTimer.transform.parent.gameObject.SetActive(false);
                txtTimer.text = "";
            }

            yield return new WaitForSeconds(1);
        }

        txtTimer.transform.parent.gameObject.SetActive(true);
        txtTimer.text = "";
    }

    IEnumerator Auto_Back_To_Lobby()
    {
        float time = 4f;

        DeactiveMinigamesObjects();

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
    #region GETTER_SETTER

    public bool isSpinningRoulette
    {
        set
        {
            isSpinning = value;
            btnSpin.interactable = !value;
        }
        get
        {
            return isSpinning;
        }
    }

    #endregion
    #region UNITY_CALLBACKS


    #endregion
}
