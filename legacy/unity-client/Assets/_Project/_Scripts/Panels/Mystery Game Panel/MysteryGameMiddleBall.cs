using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class MysteryGameMiddleBall : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private TextMeshProUGUI textNumber;

    private int _number;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
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
            textNumber.text = value.ToString();
        }
    }

    public bool Highlight
    {
        set
        {
            if (value)
                Utility.Instance.ChangeScale(this.transform, new Vector3(1.2f, 1.2f, 1.2f), 1);
            else
                Utility.Instance.ChangeScale(this.transform, Vector3.one, 1);
        }
    }
    #endregion
}
