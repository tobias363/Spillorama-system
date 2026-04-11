using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabCountrySelection : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [SerializeField] private Toggle toggleCheckbox;
    [SerializeField] private TextMeshProUGUI txtCountryName;
    #endregion

    #region PRIVATE_VARIABLES
    private string countryData;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetCountryData(string data, ToggleGroup hall_Container_TG)
    {
        countryData = data;
        txtCountryName.text = data;
        toggleCheckbox.group = hall_Container_TG;
    }

    public string GetCountryData()
    {
        return countryData;
    }

    public void ToggleButton()
    {
        IsSelectedCountry = !IsSelectedCountry;
        UIManager.Instance.signupPanel.countrySelectionPanel.ClosePanel();
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public bool IsSelectedCountry
    {
        set
        {
            toggleCheckbox.isOn = value;
            if (!value)
            {
                txtCountryName.text = countryData;
            }
        }
        get
        {
            return toggleCheckbox.isOn;
        }
    }
    #endregion
}
