using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class TransactionHistoryPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtRecordNotFound;

    [Header("Transform")]
    [SerializeField] private Transform transformTransactionContainer;

    [Header("Prefabs")]
    [SerializeField] private PrefabTransactionHistoryDate prefabTransactionDate;
    [SerializeField] private PrefabTransactionHistoryDetail prefabTransactionDetail;

    private bool eventCallSuccess = false;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        Reset();
        FetchTransactions_Spillorama();
    }

    private void OnDisable()
    {
        eventCallSuccess = false;
    }

    private void FetchTransactions_Spillorama()
    {
        if (SpilloramaApiClient.Instance == null) return;

        SpilloramaApiClient.Instance.GetTransactions(1, 50,
            (SpilloramaTransactionListData data) =>
            {
                eventCallSuccess = true;
                txtRecordNotFound.gameObject.SetActive(data.transactions == null || data.transactions.Length == 0);

                if (data.transactions == null) return;

                bool firstRecordAdded = false;
                DateTime transactionTitleDate = DateTime.Now.Date;

                foreach (SpilloramaTransactionItem item in data.transactions)
                {
                    DateTime itemDate = DateTime.Parse(item.createdAt).ToLocalTime();

                    if (!firstRecordAdded || transactionTitleDate.Date != itemDate.Date)
                    {
                        transactionTitleDate = itemDate.Date;
                        PrefabTransactionHistoryDate tDate = Instantiate(prefabTransactionDate, transformTransactionContainer);
                        tDate.DateTime = transactionTitleDate;
                        firstRecordAdded = true;
                    }

                    TransactionHistory mapped = new TransactionHistory
                    {
                        id = item.id,
                        type = item.type,
                        amount = item.amount,
                        dateAndTime = item.createdAt,
                        date = itemDate.ToString("dd/MM/yyyy"),
                        purchasedFrom = item.description ?? "",
                        status = "completed",
                        uniqueReference = item.id
                    };
                    PrefabTransactionHistoryDetail tDetail = Instantiate(prefabTransactionDetail, transformTransactionContainer);
                    tDetail.SetData(mapped);
                }
            },
            (string code, string message) =>
            {
                Debug.LogWarning($"[TransactionHistory] Spillorama fetch failed: {code} — {message}");
                UIManager.Instance.messagePopup.DisplayMessagePopup(message);
            }
        );
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.balancePanel.Open();
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        txtRecordNotFound.Close();

        foreach (Transform child in transformTransactionContainer)
        {
            Destroy(child.gameObject);
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
