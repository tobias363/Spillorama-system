using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using BestHTTP.SocketIO;
#if !UNITY_WEBGL
using I2.Loc;
#endif
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class Game5FreeSpinJackpot : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    private string gameId = "";
    private string ticketId = "";
    private Socket socket;
    private bool isSpinning;
    public GameObject wheelObject;
    int autoTurnTime = 10;

    #region SERIALIZE_FIELD
    [Header("Wheel Prize List")]
    [SerializeField] private TMP_Text[] WheelPrizes;
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTimer;
    [SerializeField] private Button btnSpin;
    #endregion

    [Header("Jackpot Wheel Plates Data")]
    [SerializeField] private int[] PlatesData;
    [SerializeField] private float[] PlatesVectorValues;


    public int SampleInput;

    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        GameSocketManager.OnSocketReconnected += Reconnect;
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;
    }

    #endregion

    #region DELEGATE_CALLBACKS

    #endregion

    #region PUBLIC_METHODS

    public void Open(Socket socket, string gameId, string ticketId, WheelOfFortuneData wheelOfFortuneData)
    {
        this.socket = socket;
        this.gameId = gameId;
        this.ticketId = ticketId;
        this.Open();
        SetWheelPrizesData(wheelOfFortuneData.prizeList);
        isSpinningWOF = false;

        socket.Off(Constants.BroadcastName.startSpinWheel);

        socket.On(Constants.BroadcastName.startSpinWheel, startSpinWheel);
        autoTurnTime = 10;
        StartAutoTurn();
    }

    public void ReconnectOpen(Socket socket, string gameId, string ticketId, MiniGameData miniWofGameData)
    {
        this.Open();
        if (UIManager.Instance.game5Panel.game5GamePlayPanel.roulateSpinnerElements.activeSelf)
        {
            UIManager.Instance.game5Panel.game5GamePlayPanel.roulateSpinnerElements.SetActive(false);
        }

        isSpinningWOF = false;
        this.gameId = gameId;
        this.ticketId = ticketId;
        this.socket = socket;
        socket.Off(Constants.BroadcastName.startSpinWheel);
        socket.On(Constants.BroadcastName.startSpinWheel, startSpinWheel);

        if (miniWofGameData.isMiniGameActivated)
        {
            if (!miniWofGameData.isMiniGamePlayed && !miniWofGameData.isMiniGameFinished)
            {
                autoTurnTime = miniWofGameData.autoTurnReconnectMovesTime;
                StartAutoTurn();
            }
            else
            {
                isSpinningWOF = false;
                StopTimer();
                animJackpotWheel(miniWofGameData.gameData.wofWinnings.wofSpins, 0);
            }
        }
    }

    public void spinButtonTab()
    {
        EventManager.Instance.SelectWofAuto(socket, gameId, ticketId, (socket, packet, args) =>
        {
            Debug.Log("SelectWofAuto response: " + packet.ToString());
        });
    }

    #endregion

    #region PRIVATE_METHODS

    private void startSpinWheel(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("startSpinWheel Broadcast Response : " + packet.ToString());
        startSpinWheelData startSpinWheelData = JsonUtility.FromJson<startSpinWheelData>(Utility.Instance.GetPacketString(packet));
        StopTimer();
        animJackpotWheel(startSpinWheelData.freeSpins);
    }

    private void animJackpotWheel(int inputNumber, float inputTime = 7f)
    {
        if (isSpinningWOF)
            return;

        gameObject.transform.localRotation = Quaternion.identity;
        isSpinningWOF = true;
        float targetRotation = transform.rotation.eulerAngles.z + 1800 + PlatesVectorValues[GetRandomTargetPlateIndex(inputNumber)];
        // Apply rotation animation
        LeanTween.rotateZ(wheelObject, targetRotation, inputTime)
                .setEase(LeanTweenType.easeOutCubic)
                .setOnComplete(() =>
                {
                    isSpinning = false;

                });
    }

    private void SetWheelPrizesData(List<long> prizeList)
    {
        // Make sure the lengths match before proceeding
        if (prizeList.Count != WheelPrizes.Length)
        {
            Debug.LogError("Mismatch in the lengths of prizeList and WheelPrizes");
            return;
        }

        // Iterate through both lists and set the text of TMP_Text elements
        for (int i = 0; i < prizeList.Count; i++)
        {
            // Assuming you want to set the long value as text
            WheelPrizes[i].text = prizeList[i].ToString() + " Spinn";
        }
    }

    private int GetRandomTargetPlateIndex(int valueToFind)
    {
        List<int> indices = new List<int>();

        for (int i = 0; i < PlatesData.Length; i++)
        {
            if (PlatesData[i] == valueToFind)
            {
                indices.Add(i);
            }
        }

        if (indices.Count == 0)
        {
            return -1; // Return a special value to indicate not found
        }

        int randomIndex = UnityEngine.Random.Range(0, indices.Count);

        return indices[randomIndex];
    }

    private void StopTimer()
    {
        StopAllCoroutines();
        txtTimer.text = "";
    }

    private void StartAutoTurn()
    {
        StopAllCoroutines();
        StartCoroutine(AutoTurn());
    }

    private void Reconnect()
    {
        socket.Off(Constants.BroadcastName.startSpinWheel);
        socket.On(Constants.BroadcastName.startSpinWheel, startSpinWheel);
    }
    #endregion

    #region COROUTINES
    IEnumerator AutoTurn()
    {
        for (int i = autoTurnTime; i >= 0; i--)
        {
            txtTimer.text = "00:" + i.ToString("00");
            yield return new WaitForSeconds(1);
        }

        txtTimer.text = "";
    }
    #endregion

    #region GETTER_SETTER
    public bool isSpinningWOF
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
