using UnityEngine;
using UnityEngine.UI;
using TMPro;
using System;

public class ExistingBlocksGamePrefab : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Text")]
    public TextMeshProUGUI txtGameType;
    public TextMeshProUGUI txtSubGameType;
    public TextMeshProUGUI txtDays;
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void setData(string Type, string subType, string date)
    {
        Reset();
        txtGameType.SetText(Type);
        txtSubGameType.SetText(subType);
        txtDays.SetText(DateTime.Parse(date).ToLocalTime().ToString("dd/MM/yyyy"));
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        txtGameType.SetText(string.Empty);
        txtSubGameType.SetText(string.Empty);
        txtDays.SetText(string.Empty);
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
