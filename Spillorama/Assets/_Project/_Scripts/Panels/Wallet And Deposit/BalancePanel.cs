using I2.Loc;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class BalancePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtCurrentBalance;
    [SerializeField] private TextMeshProUGUI txtTodaysBalance;

    [Header("Buttons")]
    [SerializeField] private Button btnAddMoney;
    [SerializeField] private Button btnWithdraw;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        if (Utility.Instance.IsStandAloneVersion())
            StandaloneBuildValidation();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
    }

    public void OnAddMoneyButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.depositMoney.Open();
    }

    public void OnWithdrawButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.withdrawAuth.Open();
    }

    public void OnMyWinningsButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.myWinningsPanel.Open();
    }

    public void OnTransactionHistoryButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.transactionHistoryPanel.Open();
    }
    #endregion

    #region PRIVATE_METHODS
    private void StandaloneBuildValidation()
    {
        bool isUniqueIdPlayer = UIManager.Instance.gameAssetData.IsUniqueIdPlayer;
        btnAddMoney.gameObject.SetActive(!isUniqueIdPlayer);
        btnWithdraw.gameObject.SetActive(!isUniqueIdPlayer);
        txtCurrentBalance.transform.parent.gameObject.SetActive(!isUniqueIdPlayer);
        txtTodaysBalance.transform.parent.gameObject.SetActive(isUniqueIdPlayer);
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public string RealMoney
    {
        set
        {
            txtCurrentBalance.GetComponent<LocalizationParamsManager>().SetParameterValue("value", value + " " + Constants.StringClass.currencySymbol);
            //txtCurrentBalance.text = value + " " + Constants.StringClass.currencySymbol;
        }
    }

    public string TodaysBalance
    {
        set
        {
            //txtTodaysBalance.GetComponent<LocalizationParamsManager>().SetParameterValue("value", Constants.StringClass.currencySymbol);
            txtTodaysBalance.text = value + " " + Constants.StringClass.currencySymbol;
        }
    }
    #endregion
}
