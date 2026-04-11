using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class UtilityLoaderPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] public TextMeshProUGUI txtLoadingMessage;
    [SerializeField] private Transform transformRotationIcon;
    [SerializeField] private Vector3 rotation;
    #endregion

    #region UNITY_CALLBACKS
    void Update()
    {
        transformRotationIcon.Rotate(rotation * Time.deltaTime);
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void ShowLoader(string loadingMessage = "")
    {
        Debug.Log("SHOW LOADER");
        txtLoadingMessage.text = loadingMessage;

        if (!this.isActiveAndEnabled)
            this.Open();
    }

    public void HideLoader()
    {
        //Debug.Log("HIDE LOADER");
        this.Close();
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
