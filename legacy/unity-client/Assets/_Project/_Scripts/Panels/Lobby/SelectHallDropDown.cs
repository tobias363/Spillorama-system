using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class SelectHallDropDown : MonoBehaviour
{
    
    #region Private_Variables
    [SerializeField] private  TextMeshProUGUI tmpLabel;
    [SerializeField] private TMP_Dropdown dropHall;

    private List<string> hallList;
    #endregion

    #region Public_Variables

    public void SetDataAndOpen(List<string> hallsList)
    {
        dropHall.ClearOptions();
        dropHall.AddOptions(hallsList);
        hallList = hallsList;
        this.Open();
    }
    public void OnHallSelected(int index)
    {
        Debug.Log($"Player Selected Hall: {hallList[index]}");
    }
    #endregion

    #region Private_Variables
    #endregion
}
