using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class PrefabMiniGameWinPlayerDetails : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtPlayerType;
    [SerializeField] private TextMeshProUGUI txtTicketNumber;
    [SerializeField] private TextMeshProUGUI txtWinningAmount;

    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(string playerType, string ticketNumber, int winningAmount)
    { 
        txtPlayerType.text = playerType;
        txtTicketNumber.text = ticketNumber;
        txtWinningAmount.text = winningAmount.ToString() +" kr";
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
