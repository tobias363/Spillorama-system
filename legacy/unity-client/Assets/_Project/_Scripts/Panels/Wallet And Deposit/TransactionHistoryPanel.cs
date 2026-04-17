using BestHTTP.SocketIO;
using System;
using System.Collections;
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
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.TransactionHistory(TransactionHistoryResponse);
        GameSocketManager.OnSocketReconnected += Reconnect;
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
            EventManager.Instance.TransactionHistory(TransactionHistoryResponse);
        }
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
    private void TransactionHistoryResponse(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"TransactionHistoryResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);
        
        EventResponseList<TransactionHistory> response = JsonUtility.FromJson<EventResponseList<TransactionHistory>>(Utility.Instance.GetPacketString(packet));        

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            eventCallSuccess = true;
            txtRecordNotFound.gameObject.SetActive(response.result.Count == 0);

            bool firstRecordAdded = false;
            DateTime transactionTitleDate = DateTime.Now.Date;
            foreach(TransactionHistory tHistory in response.result)
            {                
                if(!firstRecordAdded || transactionTitleDate.Date != Utility.Instance.GetDateTimeLocal(tHistory.dateAndTime).Date)
                {
                    transactionTitleDate = Utility.Instance.GetDateTimeLocal(tHistory.dateAndTime).Date;
                    PrefabTransactionHistoryDate tDate = Instantiate(prefabTransactionDate, transformTransactionContainer);
                    tDate.DateTime = transactionTitleDate;
                    firstRecordAdded = true;
                }

                PrefabTransactionHistoryDetail tDetail = Instantiate(prefabTransactionDetail, transformTransactionContainer);
                tDetail.SetData(tHistory);
            }
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

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
