using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class RefreshContentSizeFitterScript : MonoBehaviour
{
    #region PRIVATE_VARIABLES
    ContentSizeFitter contentSizeFitter = null;
    #endregion

    #region DELEGATE_CALLBACKS
    private void Awake()
    {
        if (this.gameObject.GetComponentInChildren<ContentSizeFitter>())
            contentSizeFitter = this.gameObject.GetComponentInChildren<ContentSizeFitter>();
    }

    private void Update()
    {
        if(contentSizeFitter != null)
        {
            RefreshContentSizeFitter();
        }
    }
    #endregion

    #region PRIVATE_METHODS
    public void RefreshContentSizeFitter()
    {
        StartCoroutine(RefreshContentSizeFitterIenum(contentSizeFitter));
    }
    #endregion

    #region COROUTINES
    private IEnumerator RefreshContentSizeFitterIenum(ContentSizeFitter contentSizeFitter)
    {
        contentSizeFitter.enabled = false;
        yield return new WaitForEndOfFrame();
        contentSizeFitter.enabled = true;
    }
    #endregion
}
