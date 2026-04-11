using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class PrefabWithdrawNumberHistoryBall : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtNumber;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public int Number
    {
        set
        {
            txtNumber.text = value.ToString();
        }
    }
    #endregion
}
