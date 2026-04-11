using UnityEngine;
using UnityEngine.UI;
using TMPro;
using System.Collections.Generic;

public class ExistingBlockPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public TMP_Dropdown dropdownHalls;
    [Header("Transforms")]
    public Transform Parent;

    [Header("ScriptableObjects")]
    public ExistingBlocksGamePrefab ExistingBlocksGamePrefabs;

    [Header("Variables")]
    public List<ExistingBlockRule> existingBlockRules;
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void closeButtonTap()
    {
        Reset();
        this.Close();
    }

    public void SetDataOpen(List<ExistingBlockRule> Data)
    {
        Reset();
        this.existingBlockRules = Data;

        // ✅ Collect unique hall names
        HashSet<string> uniqueHallNames = new HashSet<string>();
        List<TMP_Dropdown.OptionData> options = new List<TMP_Dropdown.OptionData>();

        foreach (var rule in Data)
        {
            if (!string.IsNullOrEmpty(rule.hallName) && uniqueHallNames.Add(rule.hallName))
            {
                options.Add(new TMP_Dropdown.OptionData(rule.hallName));
            }
        }

        dropdownHalls.ClearOptions();
        dropdownHalls.AddOptions(options);
        dropdownHalls.onValueChanged.RemoveAllListeners();
        dropdownHalls.onValueChanged.AddListener(OnHallDropdownValueChanged);

        dropdownHalls.value = 0;
        dropdownHalls.RefreshShownValue();

        this.Open();

        // Show first hall by default
        if (Data.Count > 0)
        {
            OnHallDropdownValueChanged(0);
        }
    }

    public void OnHallDropdownValueChanged(int value)
    {
        Reset(); // clear old prefabs

        string selectedHall = dropdownHalls.options[value].text;
        List<ExistingBlockRule> filteredRules = existingBlockRules.FindAll(rule => rule.hallName == selectedHall);

        foreach (var rule in filteredRules)
        {
            if (rule.gameTypes != null && rule.gameTypes.Count > 0)
            {
                foreach (var gameType in rule.gameTypes)
                {
                    ExistingBlocksGamePrefab newPrefab = Instantiate(ExistingBlocksGamePrefabs, Parent);

                    string gameTypeName = gameType.name ?? "Unknown";
                    string subType = (gameType.subTypes != null && gameType.subTypes.Count > 0)
                                        ? string.Join(", ", gameType.subTypes)
                                        : "-";

                    newPrefab.setData(gameTypeName, subType, rule.endDate);
                }
            }
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        foreach (Transform tObj in Parent)
        {
            Destroy(tObj.gameObject);
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
