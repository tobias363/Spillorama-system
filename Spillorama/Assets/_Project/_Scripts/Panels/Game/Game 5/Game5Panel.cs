using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Game5Panel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Panels")]
    public Game5GamePlayPanel game5GamePlayPanel;
    #endregion

    #region PRIVATE_VARIABLES

    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        GameSocketManager.SetSocketGame5Namespace = "Game5";
    }

    private void OnEnable()
    {
        game5GamePlayPanel.Open();
        UIManager.Instance.isGame5 = true;
    }

    private void OnDisable()
    {
        game5GamePlayPanel.Close();
        UIManager.Instance.isGame5 = false;
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OpenPanel()
    {
        this.Open();
        game5GamePlayPanel.Open();
        UIManager.Instance.isGame5 = true;
        if (!Application.isPlaying)
        {
            return;
        }
        if (UIManager.Instance.isBreak)
        {
            UIManager.Instance.breakTimePopup.OpenPanel("null");
        }
        else
        {
            if (BackgroundManager.Instance.checkBreakTime != null)
            {
                StopCoroutine(BackgroundManager.Instance.checkBreakTime);
            }
            BackgroundManager.Instance.checkBreakTime = StartCoroutine(BackgroundManager.Instance.CheckBreakTime());
        }
    }

    public void ClosePanel()
    {
    }
    #endregion

    #region PRIVATE_METHODS    
    #endregion

    #region COROUTINES

    #endregion

    #region GETTER_SETTER
    #endregion
}
