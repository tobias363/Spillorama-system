using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class TabToNextController : MonoBehaviour
{
    #region PUBLIC_VARIABLES    
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private TMP_InputField nextField = null;
    #endregion

    #region UNITY_CALLBACKS    
    void Update()
    {
        if (nextField && GetComponent<TMP_InputField>().isFocused && Input.GetKeyDown(KeyCode.Tab))
        {
            nextField.ActivateInputField();
        }
    }
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
    #endregion
}
