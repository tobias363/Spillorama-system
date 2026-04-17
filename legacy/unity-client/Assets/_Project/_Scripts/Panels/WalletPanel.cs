using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class WalletPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public BalancePanel balancePanel;
    public DepositMoney depositMoney;
    public WithdrawMoney withdrawMoney;
    public WithdrawAuthantication withdrawAuth;
    public AddCardDetailsPanel addCardDetailsPanel;
    public MyWinningsPanel myWinningsPanel;
    public TransactionHistoryPanel transactionHistoryPanel;
    public withdrawPayPanel withdrawPayPanel;
    public withdrawbankPanel withdrawbank;
    public TransactionTypePanel payTypePanel;
    #endregion

    #region PRIVATE_VARIABLES    
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        CloseAllPanels();
        balancePanel.Open();
    }

    private void OnDisable()
    {
        CloseAllPanels();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    #endregion

    #region PRIVATE_METHODS
    private void CloseAllPanels()
    {
        balancePanel.Close();
        depositMoney.Close();
        withdrawMoney.Close();
        withdrawAuth.Close();
        withdrawPayPanel.Close();
        withdrawbank.Close();
        transactionHistoryPanel.Close();
        addCardDetailsPanel.Close();
        myWinningsPanel.Close();
        payTypePanel.Close();
        //UIManager.Instance.webViewManager.CloseWebs();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
