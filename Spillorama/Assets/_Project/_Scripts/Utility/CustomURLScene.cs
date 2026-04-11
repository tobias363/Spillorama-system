using System;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;

public class CustomURLScene : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public TMP_Dropdown dropdownServerList;
    public TMP_InputField inptSocketURL;
    public TextMeshProUGUI txtEgUrl;
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    void Start()
    {
        dropdownServerList.value = PlayerPrefs.GetInt("SERVER_INDEX", 0);
        DropdownValueChange(dropdownServerList.value);
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void DropdownValueChange(Int32 index)
    {
        string newUrl = "";
        if (index == 0)
            newUrl = PlayerPrefs.GetString("DROPDOWN_CUSTOM_URL", "");
        else if (index == 1)
            newUrl = Constants.ServerDetails.ProductionBaseUrl;
        else if (index == 2)
            newUrl = Constants.ServerDetails.StagingUrl;
        else if (index == 3)
            newUrl = Constants.ServerDetails.DevelopmentUrl;

        txtEgUrl.gameObject.SetActive(index == 0);
        inptSocketURL.interactable = (index == 0);
        inptSocketURL.text = newUrl;
    }

    public void SumbitButtonTap()
    {
        PlayerPrefs.SetInt("SERVER_INDEX", dropdownServerList.value);
        PlayerPrefs.SetString("CUSTOM_URL", inptSocketURL.text);

        if (dropdownServerList.value == 0)
            PlayerPrefs.SetString("DROPDOWN_CUSTOM_URL", inptSocketURL.text);

        SceneManager.LoadScene(1, LoadSceneMode.Single);
    }
    #endregion
    
    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
