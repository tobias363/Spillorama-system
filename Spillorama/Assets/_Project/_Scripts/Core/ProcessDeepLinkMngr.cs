using System;

using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

public class ProcessDeepLinkMngr : MonoBehaviour
{
    public static ProcessDeepLinkMngr Instance { get; private set; }
    public string deeplinkURL;

    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            Application.deepLinkActivated += onDeepLinkActivated;

            if (!String.IsNullOrEmpty(Application.absoluteURL))
            {
                // cold start and Application.absoluteURL not null so process Deep Link
                onDeepLinkActivated(Application.absoluteURL);
                Debug.Log("Deeplink AbsoluteURL: " + Application.absoluteURL);
            }
            // initialize DeepLink Manager global variable
            else deeplinkURL = "[None]";
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }

    private void onDeepLinkActivated(string url)
    {
        //update DeepLink Manager global variable, so URL can be accessed from anywhere 
        deeplinkURL = url;

        //Decode the DeepLink url to determine action
        string schemaName = url.Split("?"[0])[1];
        bool validSchema;
        switch (schemaName)
        {
            case "RefresPaymentPage":
                validSchema = true;
                break;
            case "closePaymentPage":
                validSchema = true;
                UIManager.Instance.topBarPanel.OnWebpagClose();
                break;
            case "opencurrentPage":
                validSchema = true;
                break;
            default:
                validSchema = false;
                break;
        }

        if (validSchema)
        {
            Debug.Log("DeepLink Schema Executed :" + schemaName);
        }
        else
        {
            Debug.LogWarning("DeepLink Schema is invalid ! Redirect Default");
        }
    }
}


