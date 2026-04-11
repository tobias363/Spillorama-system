using System.Collections.Generic;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabHallSelection : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [SerializeField] private Toggle toggleCheckbox;
    [SerializeField] private TextMeshProUGUI txtHallName;
    #endregion

    #region PRIVATE_VARIABLES
    private HallData hallData;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(HallData data, ToggleGroup hall_Container_TG)
    {
        hallData = data;
        txtHallName.text = data.name;
        toggleCheckbox.group = hall_Container_TG;
    }

    public HallData GetData()
    {
        return hallData;
    }

    public bool CompareHallId(string id)
    {
        if (hallData._id == id)
            return true;
        else
            return false;
    }

    public void ToggleButton()
    {
        IsSelected = !IsSelected;
        UIManager.Instance.signupPanel.hallSelectionPanel.ClosePanel();
    }

    public void OnValueChange()
    {
        List<HallData> selectedHallList = new List<HallData>();
        foreach (PrefabHallSelection hall in UIManager.Instance.loginPanel.hallSelectionList)
        {
            if (hall.IsSelected)
                selectedHallList.Add(hall.GetData());
        }

        UIManager.Instance.loginPanel.eventSelectedHallList.Invoke(selectedHallList);
        UIManager.Instance.loginPanel.hallSelectionPopup.SetActive(false);
        UIManager.Instance.loginPanel.isPopupActive = false;
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public bool IsSelected
    {
        set
        {
            toggleCheckbox.isOn = value;
            if (!value)
            {
                txtHallName.text = hallData.name;
            }
        }
        get
        {
            return toggleCheckbox.isOn;
        }
    }

    public bool IsPending
    {
        set
        {
            toggleCheckbox.isOn = value;
            if (value)
            {
#if UNITY_WEBGL
                if (UIManager.Instance.isGameWebGL)
                {
                    txtHallName.text = hallData.name + " <size=80%>- " + LocalizationManager.GetTermTranslation("Pending");
                }
                else
                {
                    txtHallName.text = hallData.name + " <size=80%>- " + "Pending";
                }
#else
                txtHallName.text = hallData.name + " <size=80%>- " + LocalizationManager.GetTermTranslation("Pending");
#endif
            }
        }
    }

    public string HallId
    {
        get
        {
            return hallData._id;
        }
    }
    #endregion
}
