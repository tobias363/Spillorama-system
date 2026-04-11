using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Scripting;

public class AISToggleSound : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    private Toggle toggle = null;
    #endregion

    #region UNITY_CALLBACKS
    [Preserve]
    private void Awake()
    {
        toggle = this.gameObject.GetComponent<Toggle>();
        if (toggle != null)
            toggle.onValueChanged.AddListener(PlaySound);
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    #endregion

    #region PRIVATE_METHODS
    [Preserve]
    private void PlaySound(bool isOn)
    {
        SoundManager.Instance.MouseClick1();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
