using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class MultipleGameScreenManager : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Grid Layout")]
    [SerializeField] private GridLayoutGroup gridLayoutGroup;

    [Header("Transform")]
    [SerializeField] private Transform transformContainer;

    [Header("ScrollRect")]
    [SerializeField] private ScrollRect scrollRect;

    [Header("Panel")]
    [SerializeField] private Game1Panel game1Panel;
    [SerializeField] private Game2Panel game2Panel;
    [SerializeField] private Game3Panel game3Panel;
    [SerializeField] private Game4Panel game4Panel;
    [SerializeField] private Game5Panel game5Panel;

    private RectTransform rectTransform;
    private bool _allowGamesRunInBackground = false;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        rectTransform = this.GetComponent<RectTransform>();         
    }            
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void RefreshGridLayoutSize()
    {
        float height = rectTransform.rect.height;

        if (ActiveGamesCount() > 1)
        {
            scrollRect.movementType = ScrollRect.MovementType.Elastic;
            height -= 20;
        }
        else
        {
            scrollRect.movementType = ScrollRect.MovementType.Clamped;
        }

        if (ActiveGamesCount() == 0)
            AllowGamesRunInBackground = false;

        gridLayoutGroup.cellSize = new Vector2(rectTransform.rect.width, height);
    }

    public void RefreshPage()
    {
        UIManager.Instance.topBarPanel.RunningGamesButtonEnable = AnyGameActive();
    }

    public bool AnyGameActive()
    {
        if (UIManager.Instance.game1Panel.game1GamePlayPanel.isActiveAndEnabled || UIManager.Instance.game2Panel.game2PlayPanel.isActiveAndEnabled ||
            UIManager.Instance.game3Panel.game3GamePlayPanel.isActiveAndEnabled || UIManager.Instance.game4Panel.isActiveAndEnabled || 
            UIManager.Instance.game5Panel.isActiveAndEnabled)
            return true;
        else
            return false;
    }

    public int ActiveGamesCount()
    {
        int count = 0;

        if (game1Panel.game1GamePlayPanel.isActiveAndEnabled)
            count++;
        if (game2Panel.game2PlayPanel.isActiveAndEnabled)
            count++;
        if (game3Panel.game3GamePlayPanel.isActiveAndEnabled)
            count++;
        if (game4Panel.isActiveAndEnabled)
            count++;
        if (game5Panel.isActiveAndEnabled)
            count++;

        return count;
    }

    public void RefreshScroll(int game)
    {
        if (game == 1)
            RefreshScroll(game1Panel.transform);
        else if (game == 2)
            RefreshScroll(game2Panel.transform);
        else if (game == 3)
            RefreshScroll(game3Panel.transform);
        else if (game == 4)
            RefreshScroll(game4Panel.transform);
    }

    public bool IsBuyOrSelectGamePanelActive()
    {
        if (game1Panel.game1TicketPurchasePanel.isActiveAndEnabled || game2Panel.game2TicketPurchasePanel.isActiveAndEnabled
            || game3Panel.game3TicketPurchasePanel.isActiveAndEnabled)
            return true;
        else
            return false;
    }

    public void ClosePanel()
    {
        if (!this.isActiveAndEnabled)
            return;

        game1Panel.ClosePanel();
        game2Panel.ClosePanel();
        game3Panel.ClosePanel();
        game4Panel.ClosePanel();
        game5Panel.ClosePanel();
        UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;
        this.Close();
    }

    public void CloseResetPanel()
    {
        if(UIManager.Instance.gameAssetData.IsLoggedIn == false)
        {
            ClosePanel();
            this.Close();
        }

        if (game1Panel.game1TicketPurchasePanel.isActiveAndEnabled || !Utility.Instance.IsMultipleScreenSupported)
            game1Panel.Close();
        if (game2Panel.game2TicketPurchasePanel.isActiveAndEnabled || !Utility.Instance.IsMultipleScreenSupported)
            game2Panel.Close();
        if (game3Panel.game3TicketPurchasePanel.isActiveAndEnabled || !Utility.Instance.IsMultipleScreenSupported)
            game3Panel.Close();
        if (!Utility.Instance.IsMultipleScreenSupported)
            game4Panel.Close();
        if (!Utility.Instance.IsMultipleScreenSupported)
            game5Panel.Close();

        UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;
    }

    public void ActiveMultipleScreenOption()
    {
        if (AnyGameActive())
        {
            this.Open();

            if (game1Panel.game1GamePlayPanel)
                AddGame1();
            if (game2Panel.game2PlayPanel)
                AddGame2();
            if (game3Panel.game3GamePlayPanel)
                AddGame3();
            if (game4Panel)
                AddGame4();
        }
    }

    public void AddGame1()
    {
        if (Utility.Instance.IsStandAloneVersion() && Utility.Instance.IsMultipleScreenSupported)
        {
            if (!this.isActiveAndEnabled) this.Open();
            game1Panel.transform.SetParent(transformContainer);
            game1Panel.transform.SetAsFirstSibling();
            UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;
            RefreshScroll();
            RefreshGridLayoutSize();
        }
    }

    public void AddGame2()
    {
        if (Utility.Instance.IsStandAloneVersion() && Utility.Instance.IsMultipleScreenSupported)
        {
            if (!this.isActiveAndEnabled) this.Open();
            game2Panel.transform.SetParent(transformContainer);
            game2Panel.transform.SetAsFirstSibling();
            UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;
            RefreshScroll();
            RefreshGridLayoutSize();
        }
    }

    public void AddGame3()
    {
        if (Utility.Instance.IsStandAloneVersion() && Utility.Instance.IsMultipleScreenSupported)
        {
            if (!this.isActiveAndEnabled) this.Open();
            game3Panel.transform.SetParent(transformContainer);
            game3Panel.transform.SetAsFirstSibling();
            UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;
            RefreshScroll();
            RefreshGridLayoutSize();
        }
    }

    public void AddGame4()
    {
        if (Utility.Instance.IsStandAloneVersion() && Utility.Instance.IsMultipleScreenSupported)
        {
            if (!this.isActiveAndEnabled) this.Open();
            game4Panel.transform.SetParent(transformContainer);
            game4Panel.transform.SetAsFirstSibling();
            UIManager.Instance.topBarPanel.RunningGamesButtonEnable = false;
            RefreshScroll();
            RefreshGridLayoutSize();
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void RefreshScroll()
    {
        scrollRect.ScrollToTop();
    }

    private void RefreshScroll(Transform _transformt)
    {
        int siblingIndex = _transformt.GetSiblingIndex();
        float newScrollValue = 0;

        List<float> count1 = new List<float> { 0 };
        List<float> count2 = new List<float> { 0, 1 };
        List<float> count3 = new List<float> { 0, 0.5f, 1 };
        List<float> count4 = new List<float> { 0, 0.335f, 0.667f, 1 };

        if (ActiveGamesCount() == 1)
            newScrollValue = count1[siblingIndex];
        else if (ActiveGamesCount() == 2)
            newScrollValue = count2[siblingIndex];
        else if (ActiveGamesCount() == 3)
            newScrollValue = count3[siblingIndex];
        else if (ActiveGamesCount() == 4)
            newScrollValue = count4[siblingIndex];

        scrollRect.horizontalScrollbar.value = newScrollValue;
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public bool AllowGamesRunInBackground
    {
        set
        {
            _allowGamesRunInBackground = value;
        }
        get
        {
            return _allowGamesRunInBackground;
        }
    }
    #endregion
}
