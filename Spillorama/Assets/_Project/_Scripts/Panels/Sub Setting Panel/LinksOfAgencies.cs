using BestHTTP.SocketIO;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class LinksOfAgencies : MonoBehaviour
{
    #region Private Variables
    [SerializeField] private TextMeshProUGUI title;
    [SerializeField] private TextMeshProUGUI description;

    [SerializeField] private TitleDescription td;
    #endregion

    #region Unity Callback
    private void OnEnable()
    {
        CallLinksOfOtherAgencies();
    }
    #endregion

    #region Private Methods
    private void CallLinksOfOtherAgencies()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.Links(ProcessEventData<TitleDescription>);
    }
    private void ProcessEventData<T>(Socket socket, Packet packet, params object []args) where T : class
    {
        Debug.Log($"ListOfOtherAgencies Reseponse: {packet}");

        EventResponse<T> response = JsonUtility.FromJson<EventResponse<T>>(Utility.Instance.GetPacketString(packet));
        if (response.status == EventResponse<T>.STATUS_SUCCESS)
        {
            td = response.result as TitleDescription;
            //title.text = td.title;
            //description.text = td.description;
            description.text = Constants.LanguageKey.LoadingMessage;

            Utility.Instance.ForceTranslate(td.description, "en-US", I2.Loc.LocalizationManager.CurrentLanguageCode, (string msg) =>
            {
                UIManager.Instance.DisplayLoader(false);
                description.text = msg;
            });

        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }
    #endregion
}
