using System.Runtime.InteropServices;
using UnityEngine;

public class ExternalCallClass : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public static ExternalCallClass Instance;
    #endregion

    #region PRIVATE_VARIABLES
    private bool isRequestGameEventCalled = false;
    #endregion


#if UNITY_WEBGL && !UNITY_EDITOR
            
        [DllImport("__Internal")]
        private static extern void requestUrlOpen(string url);
#endif


    #region
    void Awake()
    {
        Instance = this;
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS_TO_CALL_WEB_SIDE

    public void RequestGameData()
    {
        print("UNITY RequestGameData call");
        if (isRequestGameEventCalled == false)
        {
            Screen.fullScreen = true;
            Application.ExternalCall("requestGameData");
            isRequestGameEventCalled = true;

#if UNITY_EDITOR
            ReceiveGameData("");
#endif
        }
    }

    public void OpenUrl(string url)
    {
        print("UNITY OpenUrl call");
        //Application.ExternalCall("requestUrlOpen", url);
#if UNITY_WEBGL && !UNITY_EDITOR
        requestUrlOpen(url);
#else
        Debug.Log("Opening in a new tab is supported only in WebGL builds.");
#endif

    }
    #endregion

    #region PUBLIC_METHODS
    public void ReceiveGameData(string data)
    {

    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
