using UnityEngine;
using System.Collections.Generic;
using TMPro;
using I2.Loc;
using UnityEngine.UI;
using System;

public class AvailableBlockPanel : MonoBehaviour
{
    [SerializeField] GameObject confirmationMessagePanel;
    [SerializeField] TextMeshProUGUI confirmationMessageText;
    [SerializeField] AvailableBlocksGamePrefab availableBlocksGamePrefab;
    [SerializeField] AvailableBlocksGamePrefab allAvailableBlocksGamePrefab;
    public RectTransform transformAvailableBlocksGamePrefab;
    public List<AvailableBlocksGamePrefab> spawnedPrefabs = new List<AvailableBlocksGamePrefab>();
    private AvailableBlocksGamePrefab allPrefab;

    public void SetDataAndOpen(List<AvailableBlockRule> data)
    {
        Reset();
        foreach (var item in data)
        {
            AvailableBlocksGamePrefab newAvailableBlocksGamePrefab = Instantiate(availableBlocksGamePrefab, transformAvailableBlocksGamePrefab);
            newAvailableBlocksGamePrefab.SetData(item);
            spawnedPrefabs.Add(newAvailableBlocksGamePrefab);
        }

        if (data.Count > 1)
        {
            allPrefab = Instantiate(allAvailableBlocksGamePrefab, transformAvailableBlocksGamePrefab);
            allPrefab.SetAsAllPrefab(Constants.LanguageKey.ChooseAll, data[0]);

            allPrefab.onAllValueChanged += OnAllValueChanged;
        }
        this.Open();
    }

    private void OnAllValueChanged(AllSelectionState state)
    {
        foreach (var prefab in spawnedPrefabs)
        {
            if (prefab != null && prefab.gameObject != null)
            {
                prefab.ApplyAllSelection(state);
            }
        }
    }

    public void closeButtonTap()
    {
        Reset();
        this.Close();
    }

    private void Reset()
    {
        foreach (Transform tObj in transformAvailableBlocksGamePrefab)
        {
            Destroy(tObj.gameObject);
        }
        spawnedPrefabs.Clear();
        allPrefab = null;
    }

    public void OnSaveBtnTap()
    {
        if (!ValidateSelection()) return;
        confirmationMessagePanel.SetActive(true);
        if (LocalizationManager.CurrentLanguageCode == "en-US")
        {
            confirmationMessageText.SetText(UIManager.Instance.settingPanel.SettingData.confirmationMessage.en);
        }
        else
        {
            confirmationMessageText.SetText(UIManager.Instance.settingPanel.SettingData.confirmationMessage.nor);
        }
    }

    public void OnConfirmationMessagePopupYesBtnTap()
    {
        // TODO: Spillorama handles blocking via compliance API (voluntary pause / self-exclusion).
        // AIS AddOrUpdateBlockRule is no longer used.
        Debug.LogWarning("[AvailableBlockPanel] OnConfirmationMessagePopupYesBtnTap: AIS block rules removed, use Spillorama compliance API");
        confirmationMessagePanel.SetActive(false);
        this.Close();
    }

    public void OnConfirmationMessagePopupNoBtnTap()
    {
        confirmationMessagePanel.SetActive(false);
    }

    public void OnCancelButtonTap()
    {
        foreach (var prefab in spawnedPrefabs)
        {
            if (prefab != null && prefab.gameObject != null)
            {
                prefab.ApplyAllSelection(new AllSelectionState());
            }
        }
        if (allPrefab != null && allPrefab.gameObject != null)
        {
            allPrefab.ApplyAllSelection(new AllSelectionState());
        }
    }

    public bool ValidateSelection()
    {
        // Check if at least one hall is selected
        bool hasAnyHallSelected = false;
        foreach (var prefab in spawnedPrefabs)
        {
            if (prefab != null && prefab.gameObject != null && prefab.toggleHall.isOn)
            {
                hasAnyHallSelected = true;
                break;
            }
        }

        if (!hasAnyHallSelected)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectHall);
            return false;
        }

        // Validate only the selected halls
        foreach (var prefab in spawnedPrefabs)
        {
            if (prefab == null || prefab.gameObject == null)
                continue;

            // Only validate if this hall is selected
            if (!prefab.toggleHall.isOn)
                continue;

            if (!prefab.toggleGameTypes.Exists(t => t.isOn))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectGameType);
                return false;
            }

            bool dataBingoSelected = prefab.toggleGameTypes.Exists(t =>
                t.isOn && t.GetComponentInChildren<Text>().text.Contains("DataBingo", StringComparison.OrdinalIgnoreCase));

            if (dataBingoSelected)
            {
                if (!prefab.toggleSubGameTypes.Exists(t => t.isOn))
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectSubGameType);
                    return false;
                }
            }

            if (prefab.dropdownDays.value <= 0)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectDay);
                return false;
            }
        }

        return true;
    }
}

public class AllSelectionState
{
    public bool hallOn;
    public List<string> selectedGameTypes = new List<string>();
    public List<string> selectedSubGameTypes = new List<string>();
    public int dropdownIndex;
}

[System.Serializable]
public class SaveRulePayload
{
    public List<RuleEntry> list = new List<RuleEntry>();
}

[System.Serializable]
public class RuleEntry
{
    public string hallId;
    public int days;
    public List<GameTypeEntry> gameTypes = new List<GameTypeEntry>();
}

[System.Serializable]
public class GameTypeEntry
{
    public string name;
    public List<string> subTypes = new List<string>();
}
