using UnityEngine;

public class Game4Panel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Panels")]
    public Game4ThemeSelectionPanel game4ThemeSelectionPanel;
    public Game4GamePlayPanel game4GamePlayPanel;
    #endregion

    #region PRIVATE_VARIABLES

    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        UIManager.Instance.isGame4 = true;
    }

    private void OnDisable()
    {
        UIManager.Instance.isGame4 = false;
        if (game4ThemeSelectionPanel)
            game4ThemeSelectionPanel.Close();
        game4GamePlayPanel.Close();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OpenPanel()
    {
        this.Open();
        UIManager.Instance.isGame4 = true;

        if (game4ThemeSelectionPanel)
            game4ThemeSelectionPanel.Open();

        game4GamePlayPanel.Close();
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
        if (Utility.Instance.IsSplitScreenSupported)
        {
            UIManager.Instance.splitScreenGameManager.game4Panel.Close();
            UIManager.Instance.splitScreenGameManager.RefreshSplitScreenFunction();
            if (UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() == 0)
                UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
        else
        {
            this.Close();
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
    }
    #endregion

    #region PRIVATE_METHODS    
    #endregion

    #region COROUTINES

    #endregion

    #region GETTER_SETTER
    #endregion
}
