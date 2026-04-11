using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class HallSelectionPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Prefab")]
    [SerializeField] private PrefabHallSelection prefabHallSelection;

    [Header("Transform")]
    [SerializeField] private Transform transformHallContainer;

    [Header("Toggle Group")]
    public ToggleGroup Hall_Container_TG;

    [SerializeField] private List<PrefabHallSelection> hallSelectionList = new List<PrefabHallSelection>();
    #endregion

    #region CUSTOM_UNITY_EVENTS
    public CustomUnityEventHallList eventSelectedHallList;
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    /// <summary>
    /// Set all hall list & selection hall list
    /// </summary>
    /// <param name="allHallDataList"></param>
    /// <param name="selectedHallDataList"></param>
    public void SetData(List<HallData> allHallDataList, List<HallData> selectedHallDataList, bool openPanel = true)
    {
        SetAllHallData(allHallDataList);
        SetSelectedHallData(selectedHallDataList);

        if (openPanel)
            this.Open();
    }

    /// <summary>
    /// Set all hall list
    /// </summary>
    /// <param name="hallDataList"></param>
    /// <param name="openPanel"></param>
    public void SetAllHallData(List<HallData> hallDataList, bool openPanel = false)
    {
        Reset();

        foreach (HallData hallData in hallDataList)
        {
            PrefabHallSelection newHallSelection = Instantiate(prefabHallSelection, transformHallContainer);
            newHallSelection.SetData(hallData, Hall_Container_TG);
            hallSelectionList.Add(newHallSelection);
        }

        if (openPanel)
            this.Open();
    }

    /// <summary>
    /// Set selected hall data list
    /// </summary>
    /// <param name="hallDataList"></param>
    /// <param name="openPanel"></param>
    public void SetSelectedHallData(List<HallData> hallDataList, bool openPanel = false)
    {
        foreach (PrefabHallSelection hallObj in hallSelectionList)
            hallObj.IsSelected = false;

        foreach (PrefabHallSelection hallObject in hallSelectionList)
        {
            for (int i = 0; i < hallDataList.Count; i++)
            {
                if (hallObject.CompareHallId(hallDataList[i]._id))
                {
                    if (hallDataList[i].status.ToLower() == "disapproved")
                        hallObject.Close();
                    else if (hallDataList[i].status.ToLower() == "pending")
                        hallObject.IsPending = true;
                    else
                        hallObject.IsSelected = true;

                    continue;
                }
            }
        }

        if (openPanel)
            this.Open();
    }

    /// <summary>
    /// Un select all halls
    /// </summary>
    public void ResetHallSelection()
    {
        foreach (PrefabHallSelection hall in hallSelectionList)
            hall.IsSelected = false;
    }

    /// <summary>
    /// Open hall selection panel
    /// </summary>
    public void OpenPanel()
    {
        this.Open();
    }

    /// <summary>
    /// Close hall selection panel
    /// </summary>
    public void ClosePanel()
    {
        List<HallData> selectedHallList = new List<HallData>();
        foreach (PrefabHallSelection hall in hallSelectionList)
        {
            if (hall.IsSelected)
                selectedHallList.Add(hall.GetData());
        }

        eventSelectedHallList.Invoke(selectedHallList);
        this.Close();
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        foreach (PrefabHallSelection hall in hallSelectionList)
            Destroy(hall.gameObject);

        hallSelectionList.Clear();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
