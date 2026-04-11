using BestHTTP.SocketIO;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class FAQPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] ContentSizeFitter contentSizeFitter;

    [Header("List Parameters")]
    [SerializeField] private Transform listParent;
    [SerializeField] private Transform listItemPrefab;

    [Header("Data from Event response")]
    [SerializeField] private FaqDetails[] faqs;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        CallFAQEvent();
        FAQListItem.onAnswerButtonClicked += OnAnswerOpned;
    }
    private void OnDisable()
    {
        FAQListItem.onAnswerButtonClicked -= OnAnswerOpned;
    }
    #endregion

    #region PUBLIC_METHODS
    public void RefreshPanel()
    {
        Utility.Instance.RefreshContentSizeFitter(contentSizeFitter);
        LayoutRebuilder.ForceRebuildLayoutImmediate(listParent.GetComponent<RectTransform>());
        LayoutRebuilder.ForceRebuildLayoutImmediate(contentSizeFitter.GetComponent<RectTransform>());
        LayoutRebuilder.ForceRebuildLayoutImmediate(listItemPrefab.GetComponent<RectTransform>());
    }
    #endregion

    #region PRIVATE_METHODS
    private void CallFAQEvent()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.FAQ(FAQDataProcess<FaqDetails>);
    }

    private void FAQDataProcess<T>(Socket socket, Packet packet, params object[] args) where T : class
    {
        Debug.Log($"FAQ Response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponseArray<T> response = JsonUtility.FromJson<EventResponseArray<T>>(Utility.Instance.GetPacketString(packet));
        if (response.status == EventResponseArray<T>.STATUS_SUCCESS)
        {
            faqs = response.result as FaqDetails[];
            SetData();
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private void SetData()
    {
        Utility.ClearChilds(listParent);
        foreach (FaqDetails faq in faqs)
        {
            Transform t = Instantiate(listItemPrefab);
            t.SetParent(listParent);
            t.localPosition = Vector3.zero;
            t.localScale = Vector3.one;
            t.GetComponent<FAQListItem>().SetData(faq);
        }
        LayoutRebuilder.ForceRebuildLayoutImmediate(listParent.GetComponent<RectTransform>());
    }

    private void OnAnswerOpned()
    {
        LayoutRebuilder.ForceRebuildLayoutImmediate(listParent.GetComponent<RectTransform>());
    }
    #endregion
}
