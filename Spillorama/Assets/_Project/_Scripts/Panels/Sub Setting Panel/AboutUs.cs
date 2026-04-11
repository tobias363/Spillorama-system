using BestHTTP.SocketIO;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class AboutUs : MonoBehaviour
{

    #region Private Variables

    [SerializeField] private TextMeshProUGUI title;
    [SerializeField] private TextMeshProUGUI description;

    [SerializeField] private TitleDescription td;
    #endregion

    #region Unity Callback
    private void OnEnable()
    {
        CallAboutUsevent();
    }
    #endregion

    #region Private Methods
    private void CallAboutUsevent()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.Aboutus(ProcessEventData<TitleDescription>);
    }
    private void ProcessEventData<T>(Socket socket, Packet packet, params object[] args) where T : class
    {
        Debug.Log($"AboutUs Response: {packet}");

        EventResponse<T> response = JsonUtility.FromJson<EventResponse<T>>(Utility.Instance.GetPacketString(packet));
        if (response.status == EventResponse<T>.STATUS_SUCCESS)
        {
            td = response.result as TitleDescription;
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
