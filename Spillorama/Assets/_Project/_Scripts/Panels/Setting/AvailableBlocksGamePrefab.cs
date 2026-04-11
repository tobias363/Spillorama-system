using UnityEngine;
using TMPro;
using UnityEngine.UI;
using System.Collections.Generic;
using System;
using I2.Loc;

public class AvailableBlocksGamePrefab : MonoBehaviour
{
    public Toggle toggleHall;
    public GameObject gameObjectGameTypes;
    public GameObject gameObjectSubGameTypes;
    public GameObject gameObjectGameTypesPrefab;
    public GameObject gameObjectSubGameTypesPrefab;
    public GameObject gameObjectDays;
    public Transform transformGameObjectGameTypes;
    public Transform transformGameObjectSubGameTypes;
    public TMP_Dropdown dropdownDays;
    public AvailableBlockRule AvailableBlockRuleData;
    public List<Toggle> toggleGameTypes;
    public List<Toggle> toggleSubGameTypes;
    public bool isAllPrefab = false;
    public event Action<AllSelectionState> onAllValueChanged;

    public void SetData(AvailableBlockRule data)
    {
        this.AvailableBlockRuleData = data;
        toggleHall.GetComponentInChildren<Text>().text = data.hallName;
        gameObjectGameTypes.SetActive(false);
        gameObjectSubGameTypes.SetActive(false);
        gameObjectDays.SetActive(false);
        Reset();
        foreach (var item in data.gameTypes)
        {
            GameObject newGameObjectGameTypes = Instantiate(gameObjectGameTypesPrefab, transformGameObjectGameTypes);
            GameObject newGameObjectSubGameTypes = Instantiate(gameObjectSubGameTypesPrefab, transformGameObjectSubGameTypes);
            newGameObjectGameTypes.GetComponentInChildren<Text>().text = item.name;
            newGameObjectGameTypes.GetComponentInChildren<Toggle>().isOn = false;
            newGameObjectGameTypes.GetComponentInChildren<Toggle>().onValueChanged.AddListener(isOn => OnGameTypeToggleValueChanged(item, isOn));
            toggleGameTypes.Add(newGameObjectGameTypes.GetComponentInChildren<Toggle>());
            if (item.name.Equals(Constants.LanguageKey.Everything, StringComparison.OrdinalIgnoreCase))
            {
                if (LocalizationManager.CurrentLanguageCode == "en-US")
                {
                    newGameObjectGameTypes.GetComponentInChildren<Text>().text = Constants.LanguageKey.Everything;
                }
                else
                {
                    newGameObjectGameTypes.GetComponentInChildren<Text>().text = Constants.LanguageKey.Everything;
                }
            }
        }

        List<TMP_Dropdown.OptionData> options = new List<TMP_Dropdown.OptionData>();

        options.Add(new TMP_Dropdown.OptionData(Constants.LanguageKey.SelectDays));

        for (int i = 0; i < data.days.Count; i++)
        {
            options.Add(new TMP_Dropdown.OptionData(data.days[i].ToString() + " " + Constants.LanguageKey.Days));
        }

        dropdownDays.ClearOptions();
        dropdownDays.AddOptions(options);

        dropdownDays.value = 0;
        dropdownDays.RefreshShownValue();
        LayoutRebuilder.ForceRebuildLayoutImmediate(UIManager.Instance.settingPanel.AvailableblockGamePopup.transformAvailableBlocksGamePrefab);
    }

    public void SetAsAllPrefab(string label, AvailableBlockRule data)
    {
        isAllPrefab = true;
        toggleHall.GetComponentInChildren<Text>().text = label;

        gameObjectGameTypes.SetActive(false);
        gameObjectSubGameTypes.SetActive(false);
        gameObjectDays.SetActive(false);

        Reset();

        foreach (var item in data.gameTypes)
        {
            GameObject newGameObjectGameTypes = Instantiate(gameObjectGameTypesPrefab, transformGameObjectGameTypes);
            newGameObjectGameTypes.GetComponentInChildren<Text>().text = item.name;
            newGameObjectGameTypes.GetComponentInChildren<Toggle>().isOn = false;
            newGameObjectGameTypes.GetComponentInChildren<Toggle>().onValueChanged.AddListener(isOn => OnGameTypeToggleValueChanged(item, isOn));
            toggleGameTypes.Add(newGameObjectGameTypes.GetComponentInChildren<Toggle>());
            if (item.name.Equals(Constants.LanguageKey.Everything, StringComparison.OrdinalIgnoreCase))
            {
                if (LocalizationManager.CurrentLanguageCode == "en-US")
                {
                    newGameObjectGameTypes.GetComponentInChildren<Text>().text = Constants.LanguageKey.Everything;
                }
                else
                {
                    newGameObjectGameTypes.GetComponentInChildren<Text>().text = Constants.LanguageKey.Everything;
                }
            }
        }

        List<TMP_Dropdown.OptionData> options = new List<TMP_Dropdown.OptionData>();

        options.Add(new TMP_Dropdown.OptionData(Constants.LanguageKey.SelectDays));

        for (int i = 0; i < data.days.Count; i++)
        {
            options.Add(new TMP_Dropdown.OptionData(data.days[i].ToString() + " " + Constants.LanguageKey.Days));
        }

        dropdownDays.ClearOptions();
        dropdownDays.AddOptions(options);

        dropdownDays.value = 0;
        dropdownDays.RefreshShownValue();

        toggleHall.onValueChanged.AddListener(OnAllToggleChanged);
        dropdownDays.onValueChanged.AddListener(OnAllDropdownChanged);
    }

    public void OnHallToogleValueChanged(bool isOn)
    {
        // Debug.Log("OnHallToogleValueChanged: " + isOn);
        if (isOn)
        {
            gameObjectGameTypes.SetActive(true);
            LayoutRebuilder.ForceRebuildLayoutImmediate(UIManager.Instance.settingPanel.AvailableblockGamePopup.transformAvailableBlocksGamePrefab);
        }
        else
        {
            gameObjectGameTypes.SetActive(false);
            gameObjectSubGameTypes.SetActive(false);
            gameObjectDays.SetActive(false);
            foreach (var gt in toggleGameTypes)
                gt.isOn = false;

            foreach (var st in toggleSubGameTypes)
                st.isOn = false;

            dropdownDays.value = 0;
            dropdownDays.RefreshShownValue();
            LayoutRebuilder.ForceRebuildLayoutImmediate(UIManager.Instance.settingPanel.AvailableblockGamePopup.transformAvailableBlocksGamePrefab);
        }
    }

    public void OnGameTypeToggleValueChanged(GameTypes gameType, bool isOn)
    {
        // Debug.Log($"OnGameTypeToggleValueChanged: {gameType.name}, {isOn}");

        // ✅ Handle "Everything" toggle
        if (gameType.name.Equals(Constants.LanguageKey.Everything, StringComparison.OrdinalIgnoreCase))
        {
            foreach (var gt in toggleGameTypes)
            {
                if (gt.GetComponentInChildren<Text>().text.Equals(Constants.LanguageKey.Everything, StringComparison.OrdinalIgnoreCase))
                    continue; // skip itself

                gt.isOn = isOn; // apply to all others
                foreach (var st in toggleSubGameTypes)
                    st.isOn = isOn;
            }
        }

        // ✅ Handle DataBingo special case (sub game types)
        if (isOn && gameType.name.Contains("DataBingo"))
        {
            gameObjectSubGameTypes.SetActive(true);

            foreach (Transform child in transformGameObjectSubGameTypes)
                Destroy(child.gameObject);

            toggleSubGameTypes.Clear();

            foreach (string subType in gameType.subTypes)
            {
                GameObject subGO = Instantiate(gameObjectSubGameTypesPrefab, transformGameObjectSubGameTypes);
                Toggle subToggle = subGO.GetComponentInChildren<Toggle>();
                subGO.GetComponentInChildren<Text>().text = subType;
                subToggle.isOn = false;
                subToggle.onValueChanged.AddListener(OnSubGameTypeToogleValueChanged);
                toggleSubGameTypes.Add(subToggle);
            }
        }
        else if (!isOn && gameType.name.Contains("DataBingo"))
        {
            gameObjectSubGameTypes.SetActive(false);

            foreach (Transform child in transformGameObjectSubGameTypes)
                Destroy(child.gameObject);

            toggleSubGameTypes.Clear();
        }

        // ✅ Show Days dropdown if any toggle is active
        bool anySelected = toggleGameTypes.Exists(t => t.isOn);
        gameObjectDays.SetActive(anySelected);

        LayoutRebuilder.ForceRebuildLayoutImmediate(UIManager.Instance.settingPanel.AvailableblockGamePopup.transformAvailableBlocksGamePrefab);

        if (isAllPrefab) BroadcastAllState();
    }

    public void OnSubGameTypeToogleValueChanged(bool isOn)
    {
        // Debug.Log("OnSubGameTypeToogleValueChanged: " + isOn);
        LayoutRebuilder.ForceRebuildLayoutImmediate(UIManager.Instance.settingPanel.AvailableblockGamePopup.transformAvailableBlocksGamePrefab);

        if (isAllPrefab) BroadcastAllState();
    }

    private void Reset()
    {
        foreach (Transform tObj in transformGameObjectGameTypes)
        {
            Destroy(tObj.gameObject);
        }
        foreach (Transform tObj in transformGameObjectSubGameTypes)
        {
            Destroy(tObj.gameObject);
        }
        toggleSubGameTypes.Clear();
        toggleGameTypes.Clear();
        gameObjectSubGameTypes.SetActive(false);
        gameObjectGameTypes.SetActive(false);
    }

    private void OnAllToggleChanged(bool isOn)
    {
        if (isAllPrefab)
        {
            BroadcastAllState();
        }
    }

    private void OnAllDropdownChanged(int index)
    {
        if (isAllPrefab)
        {
            BroadcastAllState();
        }
    }

    public void ApplyAllSelection(AllSelectionState state)
    {
        toggleHall.isOn = state.hallOn;

        // GameTypes
        foreach (var gt in toggleGameTypes)
        {
            string name = gt.GetComponentInChildren<Text>().text;
            gt.isOn = state.selectedGameTypes.Contains(name);
        }

        // SubGameTypes
        foreach (var st in toggleSubGameTypes)
        {
            string name = st.GetComponentInChildren<Text>().text;
            st.isOn = state.selectedSubGameTypes.Contains(name);
        }

        // Dropdown
        if (state.dropdownIndex < dropdownDays.options.Count)
        {
            dropdownDays.value = state.dropdownIndex;
            dropdownDays.RefreshShownValue();
        }
    }

    private void BroadcastAllState()
    {
        if (!isAllPrefab) return;

        AllSelectionState state = new AllSelectionState();
        state.hallOn = toggleHall.isOn;
        state.dropdownIndex = dropdownDays.value;

        foreach (var gt in toggleGameTypes)
        {
            if (gt.isOn)
                state.selectedGameTypes.Add(gt.GetComponentInChildren<Text>().text);
        }

        foreach (var st in toggleSubGameTypes)
        {
            if (st.isOn)
                state.selectedSubGameTypes.Add(st.GetComponentInChildren<Text>().text);
        }

        onAllValueChanged?.Invoke(state);
    }
}
