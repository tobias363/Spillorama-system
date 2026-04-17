using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class PrefabTransactionHistoryDate : MonoBehaviour
{
    #region PUBLIC_VARIABLES    
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtDate;
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
    public string Date
    {
        set
        {
            txtDate.text = value.ToUpper();
        }
    }

    public DateTime DateTime
    {
        set
        {
            txtDate.text = value.ToString("MMMM-dd-yyyy");
        }
    }
    #endregion
}
