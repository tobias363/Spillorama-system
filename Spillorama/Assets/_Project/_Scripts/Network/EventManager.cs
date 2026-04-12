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

    /// <summary>
    /// Returns true when the AIS socket is available. In WebGL/Spillorama mode,
    /// GameSocketManager.socketManager is null — all AIS EventManager calls should
    /// silently no-op rather than crash.
    /// </summary>
    private bool IsAisSocketAvailable
    {
        get { return GameSocketManager.socketManager?.Socket != null; }
    }

    /// <summary>
    /// Null-safe AIS socket accessor. Returns the Socket if available, null otherwise.
    /// All EventManager methods should use this instead of GameSocketManager.socketManager.Socket.
    /// </summary>
    private BestHTTP.SocketIO.Socket AisSocket
    {
        get { return GameSocketManager.socketManager?.Socket; }
    }

    public bool HasInternetConnection
    {
        get
        {
            // In WebGL/Spillorama mode the AIS socket is intentionally null.
            // Return false silently (no error popup) so callers skip the emit.
            if (!IsAisSocketAvailable) return false;
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
