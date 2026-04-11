using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

public class ChangeMarkerBackgroundPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES    
    public CustomUnityEventInt eventBackgroundChanged;
    public CustomUnityEventInt eventMarkerChanged;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Buttons")]
    [SerializeField] private Button btnMarker;
    [SerializeField] private Button btnBackground;

    [Header("GameObject")]
    [SerializeField] private GameObject gameObjectMarkerContainer;
    [SerializeField] private GameObject gameObjectBackgroundContainer;    
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    private void OnEnable()
    {
        OnMarkerButtonTap();
    }
    #endregion

    #region PUBLIC_METHODS
    public void OnMarkerButtonTap()
    {
        ResetPanelsAndButtons();
        btnMarker.interactable = false;
        btnMarker.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetDeactive();
        gameObjectMarkerContainer.SetActive(true);        
    }

    public void OnBackgroundButtonTap()
    {
        ResetPanelsAndButtons();
        btnBackground.interactable = false;
        btnBackground.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetDeactive();
        gameObjectBackgroundContainer.SetActive(true);
    }

    public void ChangeGameMarker(int markerId)
    {
        SoundManager.Instance.MouseClick1();
        eventMarkerChanged.Invoke(markerId);
        this.Close();
    }

    public void ChangeGameBackground(int backgroundId)
    {
        SoundManager.Instance.MouseClick1();
        eventBackgroundChanged.Invoke(backgroundId);
        this.Close();
    }

    public void ClosePanel()
    {
        this.Close();
    }
    #endregion

    #region PRIVATE_METHODS
    private void ResetPanelsAndButtons()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        btnMarker.interactable = true;
        btnBackground.interactable = true;

        gameObjectMarkerContainer.SetActive(false);
        gameObjectBackgroundContainer.SetActive(false);

        btnMarker.GetComponentInChildren<TextMeshProUGUI>().color = Color.white;
        btnBackground.GetComponentInChildren<TextMeshProUGUI>().color = Color.white;
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
