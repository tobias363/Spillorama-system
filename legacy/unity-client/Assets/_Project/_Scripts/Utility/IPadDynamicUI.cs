using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class IPadDynamicUI : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header ("RectTransform")]
    [SerializeField] private RectTransform rectTransform = null;
    [SerializeField] private bool ignoreLocalPosition = false;
    [SerializeField] private Vector3 rectTransLocalPosition;
    [SerializeField] private Vector2 rectTransformSizeDelta;

    [Header("GridLayout Data")]
    [SerializeField] private GridLayoutGroup gridLayoutGroup = null;
    [SerializeField] private Vector2 gridLayoutCellSize;
    [SerializeField] private Vector2 gridLayoutSpacing;
    [SerializeField] private bool changeConstraint = false;
    [SerializeField] private GridLayoutGroup.Constraint gridLayoutGroupConstraint;

    [Header("TextMeshPro")]
    [SerializeField] private TextMeshProUGUI txtTextMeshPro;
    [SerializeField] private int txtFontSize;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        if(Utility.Instance.IsRunningOniPad())
        {
            //ReCalculate();
        }
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    #endregion

    #region PRIVATE_METHODS
    private void ReCalculate()
    {
        if(rectTransform)
        {
            if(!ignoreLocalPosition)
                rectTransform.localPosition = rectTransLocalPosition;
            rectTransform.sizeDelta = rectTransformSizeDelta;
        }

        if(gridLayoutGroup)
        {
            gridLayoutGroup.cellSize = gridLayoutCellSize;
            gridLayoutGroup.spacing = gridLayoutSpacing;
        }

        if(changeConstraint)
        {
            gridLayoutGroup.constraint = gridLayoutGroupConstraint;
        }

        if(txtTextMeshPro)
        {
            txtTextMeshPro.fontSize = txtFontSize;
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
