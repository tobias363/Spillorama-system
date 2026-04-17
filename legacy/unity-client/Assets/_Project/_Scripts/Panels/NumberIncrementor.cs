using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class NumberIncrementor : MonoBehaviour
{
    #region PublicVariables
    
    public int maxLimit;
    
    #endregion

    #region PrivateVariables
    [Header("Buttons")]
    [SerializeField] private Button btnPositive;
    [SerializeField] private Button btnNegative;

    [Header("Text Element")]
    [SerializeField] private TMP_InputField txtElement;

    private int value;
    #endregion

    #region UnityCallbacks
    
    private void Start()
    {
        btnPositive.onClick.AddListener(() =>
        {
            int v = (value < maxLimit) ? ++value : value;
            txtElement.text = $"{v}";
        });
        
        btnNegative.onClick.AddListener(() =>
        {
            int v = (value > 0) ? --value : value;
            txtElement.text = $"{v}";
        });
    }
    #endregion

    #region PublicMethods

    public void OnTxtElementEndEdit()
    {
        int v = Convert.ToInt32(txtElement.text);
        if (v <= 0)
        {
            v = 0;
        }
        else if (v > maxLimit)
        {
            v = maxLimit;
        }
        
        value = v;
        txtElement.text = $"{v}";
    }
    #endregion
}
