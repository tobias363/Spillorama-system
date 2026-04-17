using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;
using System;
using UnityEngine.UI;
using I2.Loc;
using System.Linq;

public class Game5JackpotRouletteWheel : MonoBehaviour
{
    #region PRIVATE_VARIABLES

    private string gameId = "";
    private string ticketId = "";
    private bool isSpinning;
    private bool isReconnectSpin = false;
    private bool callbackInvoked = false;
    private int spinCount = 0;
    private int totalSpins = 0;
    private const int DefaultAutoTurnTime = 10;
    private int autoTurnTime = DefaultAutoTurnTime;
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
    [SerializeField] private BallPathRottate ballPathRottate;

    #endregion

    #region UNITY_CALLBACKS

    private void OnDisable()
    {
        UIManager.Instance.game5Panel.game5GamePlayPanel.rouletteSpinnerElements.SetActive(true);
    }

    #endregion

    #region PUBLIC_METHODS

    public void SetWinningMultiplier(string red, string black, string green)
    {
        txtMultiplierRed.text = $"{red}x";
        txtMultiplierBlack.text = $"{black}x";
        txtMultiplierGreen.text = $"{green}x";
    }

    public void Open(string gameId, string ticketId, SpinDetails spinDetails, List<RouletteData> rouletteData)
    {
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

        autoTurnTime = DefaultAutoTurnTime;
        StartAutoTurn();
    }

    public void spinButtonTab()
    {
        // TODO: Replace with Spillorama REST endpoint for roulette auto spin
        Debug.LogWarning("[Game5] spinButtonTab (Roulette): Spillorama endpoint not yet implemented");
    }

    #endregion

    #region PRIVATE_METHODS

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
        this.Close();
        UIManager.Instance.game5Panel.Open();
        UIManager.Instance.game5Panel.game5GamePlayPanel.rouletteSpinnerElements.SetActive(true);
        UIManager.Instance.game5Panel.game5GamePlayPanel.rouletteSpinner.IsRotating = false;
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

    private const float AutoBackDelay = 4f;

    IEnumerator Auto_Back_To_Lobby()
    {
        DeactiveMinigamesObjects();
        yield return new WaitForSeconds(AutoBackDelay);
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
}
