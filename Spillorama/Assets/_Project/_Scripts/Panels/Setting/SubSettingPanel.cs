using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SubSettingPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private GameObject aboutUsPanel;
    public FAQPanel faqPanel;
    [SerializeField] private GameObject termsAndConditionsPanel;
    [SerializeField] private GameObject supportPanel;
    [SerializeField] private GameObject responsibleGamingPanel;
    [SerializeField] private GameObject linksOfOtherAgenciesPanel;
    #endregion

    #region UNITY_CALLBACKS

    private void OnDisable()
    {
        CloseAllPanels();
        Debug.Log("CloseAllPanels");
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OpenAboutUsPanel()
    {
        ResetPanels();
        aboutUsPanel.gameObject.SetActive(true);
    }

    public void OpenFAQPanel()
    {
        ResetPanels();
        faqPanel.gameObject.SetActive(true);        
    }

    public void OpenTermsAndConditionPanel()
    {
        ResetPanels();
        termsAndConditionsPanel.gameObject.SetActive(true);        
    }

    public void OpenSupportPanel()
    {
        ResetPanels();
        supportPanel.gameObject.SetActive(true);        
    }

    public void OpenResponsibleGamingPanel()
    {
        ResetPanels();
        responsibleGamingPanel.gameObject.SetActive(true);        
    }

    public void OpenLinksOfOtherAgenciesPanel()
    {
        ResetPanels();
        linksOfOtherAgenciesPanel.gameObject.SetActive(true);        
    }

    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.settingPanel.Open();
    }
    #endregion

    #region PRIVATE_METHODS
    private void ResetPanels()
    {
        this.Open();

        aboutUsPanel.gameObject.SetActive(false);
        faqPanel.gameObject.SetActive(false);
        termsAndConditionsPanel.gameObject.SetActive(false);
        supportPanel.gameObject.SetActive(false);
        responsibleGamingPanel.gameObject.SetActive(false);
        linksOfOtherAgenciesPanel.gameObject.SetActive(false);
    }


    private void CloseAllPanels()
    {
        aboutUsPanel.gameObject.SetActive(false);
        faqPanel.gameObject.SetActive(false);
        termsAndConditionsPanel.gameObject.SetActive(false);
        supportPanel.gameObject.SetActive(false);
        responsibleGamingPanel.gameObject.SetActive(false);
        linksOfOtherAgenciesPanel.gameObject.SetActive(false);
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
