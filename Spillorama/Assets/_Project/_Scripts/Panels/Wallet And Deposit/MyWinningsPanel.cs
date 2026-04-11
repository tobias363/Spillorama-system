using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using I2.Loc;

public class MyWinningsPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private GameObject DropdownAndDatepicker;
    [Header("Date Picker")]
    [SerializeField] private DatePickerInputBox datePickerDOB;
    [SerializeField] private TMP_InputField inputDOB;


    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTotalNumberOfGamePlayed;
    [SerializeField] private TextMeshProUGUI txtTotalNumberOfGameWon;
    [SerializeField] private TextMeshProUGUI txtTotalNumberOfGameLost;
    [SerializeField] private TextMeshProUGUI txtTotalNumberOfJackpotWon;
    [SerializeField] private TextMeshProUGUI txtTotalWinning;
    [SerializeField] private TextMeshProUGUI txtProfitLoss;
    [SerializeField] private TextMeshProUGUI txtTotalBet;

    [Header("DropDown")]
    [SerializeField] private TextMeshProUGUI txtFilterByLabel;
    [SerializeField] private TMP_Dropdown filterByDropdown;

    [Header("Buttons")]
    [SerializeField] private Button btnGame1;
    [SerializeField] private Button btnGame2;
    [SerializeField] private Button btnGame3;
    [SerializeField] private Button btnGame4;
    [SerializeField] private Button btnGame5;
    [SerializeField] private Button lastHourPL;

    GameStatistics game1Statistics;
    GameStatistics game2Statistics;
    GameStatistics game3Statistics;
    GameStatistics game4Statistics;
    GameStatistics game5Statistics;

    [Header("Sprites")]
    public Sprite ActiveSprite;
    public Sprite DeActiveSprite;

    private int previouseSelectedOption = 1;
    private bool eventCallSuccess = false;

    [SerializeField] private GridLayoutGroup group;

    private DateTime dateDOB = new DateTime(2000, 1, 18);
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        datePickerDOB.Close();
        inputDOB.Open();
#else
        datePickerDOB.Open();
        inputDOB.Close();
#endif
        // RefreshStatistics(new GameStatistics());
    }
    private void OnEnable()
    {
#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        DateTime today = DateTime.Today;
        inputDOB.text = Utility.Instance.GetDateString(today);
        Debug.Log("Setting today's date: " + today.ToString());
        dateDOB = today;

        if (!Utility.Instance.Validate_Date(dateDOB))
        {
            inputDOB.text = "";
            dateDOB = new DateTime(2000, 1, 18);
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.DateInvalid);
            return;
        }

        date = dateDOB.ToString("yyyy-MM-dd");
#else
        datePickerDOB.SetTodayDate();
#endif
        txtTotalWinning.transform.parent.gameObject.SetActive(false);
        txtProfitLoss.transform.parent.gameObject.SetActive(false);
        txtTotalBet.transform.parent.gameObject.SetActive(false);
        group.padding.top = 50;
        // UIManager.Instance.DisplayLoader(true);
        // EventManager.Instance.GameStatistics(GameStatisticsResponse);
        // MyWinnings();
        OnGame1ButtonTap();
        GameSocketManager.OnSocketReconnected += Reconnect;
        InitializeFilterDropdown();
    }

    private void OnDisable()
    {
        eventCallSuccess = false;
        GameSocketManager.OnSocketReconnected -= Reconnect;
    }

    private void Reconnect()
    {
        if (eventCallSuccess == false)
        {
            // UIManager.Instance.DisplayLoader(true);
            // EventManager.Instance.GameStatistics(GameStatisticsResponse);
            MyWinnings();
        }
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnDOBPickerTap()
    {
        Utility.Instance.OpenDatePicker((dateTime) =>
        {
            inputDOB.text = Utility.Instance.GetDateString(dateTime);
            Debug.Log("OnDOBPickerTap() 1: " + dateTime.ToString());
            dateDOB = dateTime;
            Debug.Log("OnDOBPickerTap() 2: " + dateDOB.ToString());
            if (!Utility.Instance.Validate_Date(dateDOB))
            {
                inputDOB.text = "";
                dateDOB = new DateTime(2000, 1, 18);
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.DateInvalid);
                return;
            }
            // date = dateDOB.ToString("dd/MM/yyyy");
            date = dateDOB.ToString("yyyy-MM-dd");
            MyWinnings();
        }, dateDOB.Year, dateDOB.Month, dateDOB.Day);
    }

    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.balancePanel.Open();
    }

    public void OnGame1ButtonTap()
    {
        DropdownAndDatepicker.SetActive(true);
        txtTotalNumberOfGameLost.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGamePlayed.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGameWon.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfJackpotWon.transform.parent.gameObject.SetActive(true);
        txtTotalWinning.transform.parent.gameObject.SetActive(false);
        txtProfitLoss.transform.parent.gameObject.SetActive(true);
        txtTotalBet.transform.parent.gameObject.SetActive(true);
        previouseSelectedOption = 1;
        group.padding.top = 50;
        ResetGameButtons();
        btnGame1.interactable = false;
        //btnGame1.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetYellowColor();
        btnGame1.GetComponent<Image>().sprite = ActiveSprite;
        MyWinnings();

        // RefreshStatistics(game1Statistics);
    }

    public void OnGame2ButtonTap()
    {
        DropdownAndDatepicker.SetActive(true);
        txtTotalNumberOfGameLost.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGamePlayed.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGameWon.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfJackpotWon.transform.parent.gameObject.SetActive(true);
        txtTotalWinning.transform.parent.gameObject.SetActive(false);
        txtProfitLoss.transform.parent.gameObject.SetActive(true);
        txtTotalBet.transform.parent.gameObject.SetActive(true);
        previouseSelectedOption = 2;
        group.padding.top = 50;
        ResetGameButtons();
        btnGame2.interactable = false;
        btnGame2.GetComponent<Image>().sprite = ActiveSprite;
        MyWinnings();

        // RefreshStatistics(game2Statistics);
    }

    public void OnGame3ButtonTap()
    {
        DropdownAndDatepicker.SetActive(true);
        txtTotalNumberOfGameLost.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGamePlayed.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGameWon.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfJackpotWon.transform.parent.gameObject.SetActive(true);
        txtTotalWinning.transform.parent.gameObject.SetActive(false);
        txtProfitLoss.transform.parent.gameObject.SetActive(true);
        txtTotalBet.transform.parent.gameObject.SetActive(true);
        previouseSelectedOption = 3;
        group.padding.top = 50;
        ResetGameButtons();
        btnGame3.interactable = false;
        btnGame3.GetComponent<Image>().sprite = ActiveSprite;
        MyWinnings();

        // RefreshStatistics(game3Statistics);
    }

    public void OnGame4ButtonTap()
    {
        DropdownAndDatepicker.SetActive(true);
        txtTotalNumberOfGameLost.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGamePlayed.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGameWon.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfJackpotWon.transform.parent.gameObject.SetActive(true);
        txtTotalWinning.transform.parent.gameObject.SetActive(false);
        txtProfitLoss.transform.parent.gameObject.SetActive(true);
        txtTotalBet.transform.parent.gameObject.SetActive(true);
        previouseSelectedOption = 4;
        group.padding.top = 50;
        ResetGameButtons();
        btnGame4.interactable = false;
        btnGame4.GetComponent<Image>().sprite = ActiveSprite;
        MyWinnings();

        // RefreshStatistics(game4Statistics);
    }

    public void OnGame5ButtonTap()
    {
        DropdownAndDatepicker.SetActive(true);
        txtTotalNumberOfGameLost.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGamePlayed.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGameWon.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfJackpotWon.transform.parent.gameObject.SetActive(true);
        txtTotalWinning.transform.parent.gameObject.SetActive(false);
        txtProfitLoss.transform.parent.gameObject.SetActive(true);
        txtTotalBet.transform.parent.gameObject.SetActive(true);

        previouseSelectedOption = 5;
        group.padding.top = 50;
        ResetGameButtons();
        btnGame5.interactable = false;
        btnGame5.GetComponent<Image>().sprite = ActiveSprite;
        MyWinnings();

        // RefreshStatistics(game5Statistics);
    }

    public void LastHourPLTap()
    {
        DropdownAndDatepicker.SetActive(true);
        txtTotalNumberOfGameLost.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGamePlayed.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfGameWon.transform.parent.gameObject.SetActive(false);
        txtTotalNumberOfJackpotWon.transform.parent.gameObject.SetActive(true);
        txtTotalWinning.transform.parent.gameObject.SetActive(false);
        txtProfitLoss.transform.parent.gameObject.SetActive(true);
        txtTotalBet.transform.parent.gameObject.SetActive(true);
        previouseSelectedOption = 6;

        group.padding.top = 120;
        ResetGameButtons();
        lastHourPL.interactable = false;
        lastHourPL.GetComponent<Image>().sprite = ActiveSprite;
        MyWinnings();
        // EventManager.Instance.LastHourLossProfit((socket, packet, args) =>
        // {
        //     Debug.Log($"LastHourLossProfit Response: {packet}");
        //     EventResponse<LastHourPL> response = JsonUtility.FromJson<EventResponse<LastHourPL>>(Utility.Instance.GetPacketString(packet));

        //     if (response.status.Equals("success"))
        //     {
        //         txtTotalWinning.text = response.result.totalwinn.ToString();
        //         txtProfitLoss.text = response.result.lossProfit.ToString();
        //         txtTotalBet.text = response.result.totalBet.ToString();
        //     }
        //     else
        //     {
        //         UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        //     }
        // });
    }

    public void OnFilterDropdownValueChanged()
    {
        if (filterByDropdown.value == 1)
        {
#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        datePickerDOB.Close();
        inputDOB.Close();
#else
            datePickerDOB.Close();
            inputDOB.Close();
#endif
        }
        else
        {
#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        datePickerDOB.Close();
        inputDOB.gameObject.SetActive(true);
#else
            datePickerDOB.Open();
            inputDOB.Close();
#endif
        }
        MyWinnings();
    }

    public void OnDateValueChanged()
    {
        // date = $"{datePickerDOB.day}/{datePickerDOB.month}/{datePickerDOB.year}";
        date = $"{datePickerDOB.year}-{datePickerDOB.month}-{datePickerDOB.day}";
        MyWinnings();
    }
    #endregion

    #region PRIVATE_METHODS
    string filterBy;
    string gameType;
    public string date;

    private void InitializeFilterDropdown()
    {
        // Set up the label with translation
        if (txtFilterByLabel != null)
        {
            // Add Localize component if not already present
            Localize localizeLabel = txtFilterByLabel.GetComponent<Localize>();
            if (localizeLabel == null)
            {
                localizeLabel = txtFilterByLabel.gameObject.AddComponent<Localize>();
            }
            localizeLabel.Term = "Filter By";
        }

        // Clear existing options
        filterByDropdown.ClearOptions();

        // Create options list with translation terms
        List<string> options = new List<string>
        {
            "By Day",
            "By Last Hour"
        };

        // Add options to dropdown
        filterByDropdown.AddOptions(options);

        // Set default value to "By Day" (index 0)
        filterByDropdown.value = 0;

        // Add LocalizeDropdown component if not already present
        LocalizeDropdown localizeDropdown = filterByDropdown.GetComponent<LocalizeDropdown>();
        if (localizeDropdown == null)
        {
            localizeDropdown = filterByDropdown.gameObject.AddComponent<LocalizeDropdown>();
        }

        // The LocalizeDropdown component will automatically handle the translation
        // based on the terms we added to the I2Languages asset
    }

    private void MyWinnings()
    {
        filterBy = filterByDropdown.value switch
        {
            0 => "date",
            1 => "last_hour",
            _ => throw new ArgumentOutOfRangeException(nameof(filterByDropdown.value), "Unexpected value"),
        };

        gameType = previouseSelectedOption switch
        {
            1 => "game_1",
            2 => "game_2",
            3 => "game_3",
            4 => "game_4",
            5 => "game_5",
            6 => "all",
            _ => throw new ArgumentOutOfRangeException(nameof(previouseSelectedOption), "Unexpected value"),
        };
        EventManager.Instance.MyWinnings(filterBy, date, gameType, MyWinningsResponse);
    }

    private void GameStatisticsResponse(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"GameStatisticsResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<GameStatisticsResponse> response = JsonUtility.FromJson<EventResponse<GameStatisticsResponse>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            eventCallSuccess = true;

            game1Statistics = response.result.game1;
            game2Statistics = response.result.game2;
            game3Statistics = response.result.game3;
            game4Statistics = response.result.game4;
            game5Statistics = response.result.game5;

            if (previouseSelectedOption == 1)
                OnGame1ButtonTap();
            else if (previouseSelectedOption == 2)
                OnGame2ButtonTap();
            else if (previouseSelectedOption == 3)
                OnGame3ButtonTap();
            else if (previouseSelectedOption == 4)
                OnGame4ButtonTap();
            else
                OnGame5ButtonTap();
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private void MyWinningsResponse(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"MyWinningsResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<LastHourPL> response = JsonUtility.FromJson<EventResponse<LastHourPL>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            txtTotalWinning.text = response.result.totalwinn.ToString() + " " + Constants.StringClass.currencySymbol;
            txtProfitLoss.text = response.result.lossProfit.ToString() + " " + Constants.StringClass.currencySymbol;
            txtTotalBet.text = response.result.totalBet.ToString() + " " + Constants.StringClass.currencySymbol;
            txtTotalNumberOfGamePlayed.text = response.result.totalBet.ToString() + " " + Constants.StringClass.currencySymbol;
            txtTotalNumberOfGameWon.text = response.result.totalwinn.ToString() + " " + Constants.StringClass.currencySymbol;
            txtTotalNumberOfGameLost.text = response.result.lossProfit.ToString() + " " + Constants.StringClass.currencySymbol;
            txtTotalNumberOfJackpotWon.text = response.result.totalwinn.ToString() + " " + Constants.StringClass.currencySymbol;

            eventCallSuccess = true;
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private void RefreshStatistics(GameStatistics gameStatistics)
    {
        txtTotalNumberOfGamePlayed.text = gameStatistics.totalGamePlayed.ToString();
        txtTotalNumberOfGameWon.text = gameStatistics.totalGameWon.ToString();
        txtTotalNumberOfGameLost.text = gameStatistics.totalGameLost.ToString();
        txtTotalNumberOfJackpotWon.text = gameStatistics.totalJackpotWon.ToString() + " " + Constants.StringClass.currencySymbol;
    }

    private void ResetGameButtons()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        btnGame1.interactable = true;
        btnGame2.interactable = true;
        btnGame3.interactable = true;
        btnGame4.interactable = true;
        btnGame5.interactable = true;
        lastHourPL.interactable = true;

        btnGame1.GetComponent<Image>().sprite = DeActiveSprite;
        btnGame2.GetComponent<Image>().sprite = DeActiveSprite;
        btnGame3.GetComponent<Image>().sprite = DeActiveSprite;
        btnGame4.GetComponent<Image>().sprite = DeActiveSprite;
        btnGame5.GetComponent<Image>().sprite = DeActiveSprite;
        lastHourPL.GetComponent<Image>().sprite = DeActiveSprite;
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
