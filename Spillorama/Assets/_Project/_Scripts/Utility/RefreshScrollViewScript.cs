using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class RefreshScrollViewScript : MonoBehaviour
{
    #region PUBLIC_VARIABLES    
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private bool scrollToBottom = false;

    private ScrollRect scrollRect = null;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        if (this.gameObject.GetComponentInChildren<ScrollRect>())
            scrollRect = this.gameObject.GetComponentInChildren<ScrollRect>();
    }

    private void OnEnable()
    {
        if(scrollRect != null)
            RefreshScroll();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    #endregion

    #region PRIVATE_METHODS
    public void RefreshScroll()
    {
        if (scrollToBottom)
            scrollRect.ScrollToBottom();
        else
            scrollRect.ScrollToTop();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
