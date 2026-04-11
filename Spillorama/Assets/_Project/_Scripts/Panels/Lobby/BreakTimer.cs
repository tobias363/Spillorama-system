using System;
using System.Collections;
using UnityEngine;
using TMPro;

public class BreakTimer : MonoBehaviour
{
    [SerializeField] private TextMeshProUGUI countdownText;
    [SerializeField] private CanvasGroup canvasGroup;

    private Coroutine countDown;

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        canvasGroup.blocksRaycasts = true;
        RestartCountdown();
    }

    private void OnDisable()
    {
        canvasGroup.blocksRaycasts = false;
        StopCountdown();
        this.Close();
    }
    #endregion

    #region PUBLIC_METHODS
    public void OpenPanel(string gameType = "")
    {
        //Debug.LogError("openpanel");

        if (!UIManager.Instance.isBreak)
        {
            this.Close();
            return;
        }

        if (!IsAnyGamePanelActive())
        {
            this.Close();
            return;
        }

        bool opened = HandleGameSpecificOpen(gameType);
        if (opened)
        {
            RestartCountdown();
            UIManager.Instance.DisplayLoader(false);
        }
        else
        {
            this.Close();
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void RestartCountdown()
    {
        StopCountdown();
        countDown = StartCoroutine(CountdownTimer());
    }

    private void StopCountdown()
    {
        if (countDown != null)
        {
            StopCoroutine(countDown);
            countDown = null;
        }
    }

    private bool IsAnyGamePanelActive()
    {
        return UIManager.Instance.game2Panel.gameObject.activeSelf ||
               UIManager.Instance.game3Panel.gameObject.activeSelf ||
               UIManager.Instance.game4Panel.gameObject.activeSelf ||
               UIManager.Instance.game5Panel.gameObject.activeSelf;
    }

    private bool HandleGameSpecificOpen(string gameType)
    {
        switch (gameType)
        {
            case "Game2" when UIManager.Instance.game2Panel.gameObject.activeSelf:
                this.Open();
                UIManager.Instance.game2Panel.game2PlayPanel.CallSubscribeRoom();
                return true;

            case "Game3" when UIManager.Instance.game3Panel.gameObject.activeSelf:
                this.Open();
                UIManager.Instance.game3Panel.game3GamePlayPanel.CallSubscribeRoom();
                return true;

            case "Game4" when UIManager.Instance.game4Panel.gameObject.activeSelf:
                this.Open();
                TriggerGame4Theme();
                return true;

            case "Game5" when UIManager.Instance.game5Panel.gameObject.activeSelf:
                this.Open();
                UIManager.Instance.game5Panel.game5GamePlayPanel.CallSubscribeRoom();
                return true;

            case "null":
                this.Open();
                return true;

            default:
                return false;
        }
    }

    private void TriggerGame4Theme()
    {
        switch (true)
        {
            case true when UIManager.Instance.isGame4Theme1:
                UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn1.OnButtonTap();
                break;
            case true when UIManager.Instance.isGame4Theme2:
                UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn2.OnButtonTap();
                break;
            case true when UIManager.Instance.isGame4Theme3:
                UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn3.OnButtonTap();
                break;
            case true when UIManager.Instance.isGame4Theme4:
                UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn4.OnButtonTap();
                break;
            case true when UIManager.Instance.isGame4Theme5:
                UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn5.OnButtonTap();
                break;
        }
    }
    #endregion

    #region COROUTINES
    private IEnumerator CountdownTimer()
    {
        var endBreakTime = UIManager.Instance.endBreakTime;
        if (endBreakTime == default)
        {
            Debug.LogError("endBreakTime is not set!");
            yield break;
        }

        while (true)
        {
            var remainingTime = endBreakTime - DateTimeOffset.UtcNow;

            if (remainingTime.TotalSeconds <= 0)
            {
                countdownText.text = "00:00";
                EndBreakActions();
                yield break;
            }

            countdownText.text = $"{(int)remainingTime.TotalMinutes:D2}:{remainingTime.Seconds:D2}";
            yield return new WaitForSeconds(1f);
        }
    }
    #endregion

    #region BREAK_END
    private void EndBreakActions()
    {
        Debug.Log("Countdown ended.");
        UIManager.Instance.endBreakTime = default;
        UIManager.Instance.startBreakTime = default;
        UIManager.Instance.isBreak = false;

        switch (true)
        {
            case true when UIManager.Instance.isGame2:
                UIManager.Instance.game2Panel.game2PlayPanel.CallSubscribeRoom();
                break;
            case true when UIManager.Instance.isGame3:
                UIManager.Instance.game3Panel.game3GamePlayPanel.CallSubscribeRoom();
                break;
            case true when UIManager.Instance.isGame4:
                TriggerGame4Theme();
                break;
            case true when UIManager.Instance.isGame5:
                UIManager.Instance.game5Panel.game5GamePlayPanel.CallSubscribeRoom();
                break;
            default:
                this.Close();
                break;
        }

        this.Close();
    }
    #endregion
}
