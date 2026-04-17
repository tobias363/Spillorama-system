using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.Events;

public class LoginWithUniqueIdPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Input Field")]
    [SerializeField] private TMP_InputField inputId;
    #endregion

    #region UNITY_Events
    [Header("Unity Events")]
    public UnityEvent OnSubmitAction;
    public UnityEvent OnCancelAction;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        GameSocketManager.OnSocketReconnected += Reconnect;
        Reset();
    }    

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void AddDigit(string digit)
    {
        if(inputId.characterLimit == 0 || (inputId.characterLimit > inputId.text.Length))
            inputId.text += digit;
    }

    public void OnClearButtonTap()
    {
        Reset();
    }

    public void OnSubmitButtonTap()
    {
        OnSubmitAction.Invoke();
    }

    public void OnCloseButtonTap()
    {
        OnCancelAction.Invoke();
    }

    public string GetInputId()
    {
        return inputId.text;
    }
    #endregion

    #region PRIVATE_METHODS

    private void Reconnect()
    {
        UIManager.Instance.DisplayLoader(false);
    }

    private void Reset()
    {
        inputId.text = "";
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
