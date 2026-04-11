using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabLuckeyNumberBall : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtLuckyNumber;

    [Header("Button")]
    [SerializeField] internal Button btnSelectLuckyNumber;

    [Header("Image")]    
    [SerializeField] private Image imgSelection;

    [Header("Color")]
    [SerializeField] private Color32 colorNormal;
    [SerializeField] private Color32 colorSelected;

    private SelectLuckyNumberPanel selectLuckyNumberPanel;
    private int _number;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(int number, SelectLuckyNumberPanel selectLuckyNumberPanel)
    {
        this.selectLuckyNumberPanel = selectLuckyNumberPanel;

        Number = number;
        txtLuckyNumber.text = number.ToString();
        imgSelection.Close();
    }

    public void SelectLuckeyNumber()
    {
        if (SoundManager.Instance != null)
        {
            Debug.Log("SelectLuckeyNumber: " + this.Number);
            SoundManager.Instance.PlayNumberAnnouncementForActiveGame(this.Number, false);
        }  
        selectLuckyNumberPanel.RefreshLuckeyNumberSelection(this);
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public int Number
    {
        set
        {
            _number = value;
        }
        get
        {
            return _number;
        }
    }

    public bool Selection
    {
        set
        {
            imgSelection.gameObject.SetActive(value);
            txtLuckyNumber.color = value ? colorSelected : colorNormal;
        }
    }
    #endregion
}
