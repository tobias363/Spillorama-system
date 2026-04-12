using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Game1LuckyNumberAutoSelectionBtn : MonoBehaviour
{
    #region Varibles

    public GameObject Selected;
    public int Lucky_Number;

    #endregion

    public void Set_Auto_Lucky_Number()
    {
        print($"Lucky Number : {Lucky_Number}");
        UIManager.Instance.settingPanel.game1LuckyNumberAutoSelectionUI.Set_Lucky_Number(Lucky_Number);
    }

}
