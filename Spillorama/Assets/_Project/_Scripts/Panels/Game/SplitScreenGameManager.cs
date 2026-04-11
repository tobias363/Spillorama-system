using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class SplitScreenGameManager : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Game Panels")]
    public Game1Panel game1Panel;
    public Game2Panel game2Panel;
    public Game3Panel game3Panel;
    public Game4Panel game4Panel;
    public Game5Panel game5Panel;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("RectTransform")]
    [SerializeField] private RectTransform rectTransform = null;

    [Header("GridLayoutGroup")]
    [SerializeField] private GridLayoutGroup gridLayoutGroup = null;

    [Header("Image")]
    [SerializeField] private Image imgPartitionLineVertical = null;
    [SerializeField] private Image imgPartitionLineHorinontal = null;

    [SerializeField] private float panelWidth;
    [SerializeField] private float panelHeight;    
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        panelWidth = rectTransform.rect.width;
        panelHeight = rectTransform.rect.height;        
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OpenGamePlay1(GameData gameData, string gameId)
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        game1Panel.OpenGamePlayPanel(gameData, gameId);
        UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;

        RefreshLayout();
    }

    public void OpenGamePlay2(GameData gameData, string gameId)
    {
        if (!this.isActiveAndEnabled)
            this.Open();
        
        game2Panel.OpenGamePlayPanel(gameData, gameId);
        UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;

        RefreshLayout();
    }   

    public void OpenGamePlay3(GameData gameData, string gameID)
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        game3Panel.OpenGamePlayPanel(gameData, gameID);
        UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;

        RefreshLayout();
    }

    public void OpenGamePlay4(Game4Theme theme, Game4Data game4data = null)
    {
        if (!this.isActiveAndEnabled)
            this.Open();
        
        game4Panel.Open();
        game4Panel.game4GamePlayPanel.SetData(theme, game4data);
        UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;

        RefreshLayout();
    }

    public int SplitScreenRunningGameCount()
    {
        int count = 0;

        if (game1Panel.isActiveAndEnabled)
            count++;
        if (game2Panel.isActiveAndEnabled)
            count++;
        if (game3Panel.isActiveAndEnabled)
            count++;
        if (game4Panel.isActiveAndEnabled)
            count++;

        return count;
    }

    public void RefreshSplitScreenFunction()
    {        
        if (SplitScreenRunningGameCount() == 0)
            UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;

        RefreshLayout();
    }

    public void CloseResetPanel()
    {
        if (UIManager.Instance.gameAssetData.IsLoggedIn == false)
            ClosePanel();

        UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;
    }

    public void ClosePanel()
    {
        game1Panel.Close();
        game2Panel.Close();
        game3Panel.Close();
        game4Panel.Close();
        game5Panel.Close();
        UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;
        this.Close();
    }
    #endregion

    #region PRIVATE_METHODS
    private void RefreshLayout()
    {
        int runningGameCount = SplitScreenRunningGameCount();

        imgPartitionLineVertical.gameObject.SetActive(runningGameCount >= 2);
        imgPartitionLineHorinontal.gameObject.SetActive(runningGameCount >= 3);

        if (runningGameCount < 2)
            gridLayoutGroup.cellSize = new Vector3(panelWidth, panelHeight);
        else if (runningGameCount < 3)
            gridLayoutGroup.cellSize = new Vector3(panelWidth / 2, panelHeight);
        else
            gridLayoutGroup.cellSize = new Vector3(panelWidth / 2, panelHeight / 2);

        if (game4Panel.isActiveAndEnabled)
            game4Panel.game4GamePlayPanel.RefreshSplitScreenLayoutUI(runningGameCount);
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
