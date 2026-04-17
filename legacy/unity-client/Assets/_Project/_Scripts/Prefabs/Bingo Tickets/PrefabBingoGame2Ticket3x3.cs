using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class PrefabBingoGame2Ticket3x3 : BingoTicket
{
    #region PUBLIC_VARIABLES

    [Header("Layout")]
    public GridLayoutGroup bingoNumbersContainerGridLayoutGroup;

    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        UIManager.Instance.game2Panel.game2PlayPanel.MyEvent += TicketNumbersGridLayoutGroupCellSizeUpdate;
    }

    private void OnDisable()
    {
        UIManager.Instance.game2Panel.game2PlayPanel.MyEvent -= TicketNumbersGridLayoutGroupCellSizeUpdate;
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    #endregion

    #region PRIVATE_METHODS

    public void TicketNumbersGridLayoutGroupCellSizeUpdate(float value)
    {
        float x1 = (value - ( 20 + 20)) / 3;
        float x2 = (value - (80 + 10)) / 3;
        bingoNumbersContainerGridLayoutGroup.cellSize = new Vector2(x1, x2);
    }

    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}