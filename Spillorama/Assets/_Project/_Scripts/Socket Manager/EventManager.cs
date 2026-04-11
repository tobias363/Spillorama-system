using UnityEngine;

public partial class EventManager : MonoBehaviour
{
    public static EventManager Instance = null;

    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
        else
        {
            Destroy(gameObject);
        }
    }

    public bool HasInternetConnection
    {
        get
        {
            if (Application.internetReachability == NetworkReachability.NotReachable)
            {
                UIManager.Instance.DisplayLoader(false);
#if UNITY_WEBGL
                if (UIManager.Instance.isGameWebGL)
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.NoInternetConnectionMessage);
                }
                else
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.NoInternetConnectionMessage);
                }
#else
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.NoInternetConnectionMessage);
#endif
                return false;
            }

            return true;
        }
    }
}
