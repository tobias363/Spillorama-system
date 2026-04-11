using BestHTTP.SocketIO;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class TermsAndConditionsPanel : MonoBehaviour
{

    #region private Variables
    [SerializeField] private TextMeshProUGUI title;
    [SerializeField] private TextMeshProUGUI description;

    [Header("Date from event response")]
    [SerializeField] private TitleDescription data;
    #endregion

    #region Unity Callback
    private void OnEnable()
    {
        CallTAndC();
    }
    #endregion

    #region private Methods 
    private void CallTAndC()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.Terms(TANDCdataProcess<TitleDescription>);
    }

    private void TANDCdataProcess<T>(Socket socket, Packet packet, params object[] args) where T : class
    {
        Debug.Log($"Terms Response: {packet}");

        EventResponse<T> response = JsonUtility.FromJson<EventResponse<T>>(Utility.Instance.GetPacketString(packet));

        if (response.status == EventResponse<T>.STATUS_SUCCESS)
        {
            data = response.result as TitleDescription;
            //title.text = data.title;
            description.text = Constants.LanguageKey.LoadingMessage;

            Utility.Instance.ForceTranslate(data.description, "en-US", I2.Loc.LocalizationManager.CurrentLanguageCode, (string msg) =>
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
