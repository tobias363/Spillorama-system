using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class CountrySelectionPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Prefab")]
    [SerializeField] private PrefabCountrySelection prefabCountrySelection;

    [Header("Transform")]
    [SerializeField] private Transform transformCountryContainer;

    [Header("Toggle Group")]
    public ToggleGroup Country_Container_TG;

    [SerializeField] private List<PrefabCountrySelection> countrySelectionList = new List<PrefabCountrySelection>();
    #endregion

    #region CUSTOM_UNITY_EVENTS
    public CustomUnityEventCountryList eventSelectedCountryList;
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    /// <summary>
    /// Set all country list & selection country list
    /// </summary>
    /// <param name="allCountryDataList"></param>
    /// <param name="selectedCountryDataList"></param>
    public void SetData(List<string> allCountryDataList, List<string> selectedCountryDataList, bool openPanel = true)
    {
        SetAllCountryData(allCountryDataList);
        SetSelectedCountryData(selectedCountryDataList);

        if (openPanel)
            this.Open();
    }

    /// <summary>
    /// Set all country list
    /// </summary>
    /// <param name="countryDataList"></param>
    /// <param name="openPanel"></param>
    public void SetAllCountryData(List<string> countryList, bool openPanel = false)
    {
        Reset();

        foreach (string country in countryList)
        {
            PrefabCountrySelection newCountrySelection = Instantiate(prefabCountrySelection, transformCountryContainer);
            newCountrySelection.SetCountryData(country, Country_Container_TG);
            countrySelectionList.Add(newCountrySelection);
        }

        if (openPanel)
            this.Open();
    }

    /// <summary>
    /// Set selected country data list
    /// </summary>
    /// <param name="countryDataList"></param>
    /// <param name="openPanel"></param>
    public void SetSelectedCountryData(List<string> countryDataList, bool openPanel = false)
    {
        foreach (PrefabCountrySelection countryObj in countrySelectionList)
            countryObj.IsSelectedCountry = false;

        foreach (PrefabCountrySelection countryObject in countrySelectionList)
        {
            for (int i = 0; i < countryDataList.Count; i++)
            {
                if (countryObject.GetCountryData() == countryDataList[i])
                {
                    countryObject.IsSelectedCountry = true;
                    continue;
                }
            }
        }

        if (openPanel)
            this.Open();
    }

    /// <summary>
    /// Un select all countries
    /// </summary>
    public void ResetCountrySelection()
    {
        foreach (PrefabCountrySelection country in countrySelectionList)
            country.IsSelectedCountry = false;
    }

    /// <summary>
    /// Open country selection panel
    /// </summary>
    public void OpenPanel()
    {
        this.Open();
    }

    /// <summary>
    /// Close country selection panel
    /// </summary>
    public void ClosePanel()
    {
        List<string> selectedCountryList = new List<string>();
        foreach (PrefabCountrySelection country in countrySelectionList)
        {
            if (country.IsSelectedCountry)
                selectedCountryList.Add(country.GetCountryData());
        }

        eventSelectedCountryList.Invoke(selectedCountryList);
        this.Close();
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        foreach (PrefabCountrySelection country in countrySelectionList)
            Destroy(country.gameObject);

        countrySelectionList.Clear();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
