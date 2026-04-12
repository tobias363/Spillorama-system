using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

public class Game4ThemeSelectionPanel : MonoBehaviour
{
    #region PRIVATE_VARIABLES
    [Header("Transform")]
    [SerializeField] private Transform assetContainer;

    [Header("Game Object")]
    [SerializeField] private GameObject objectDetailPanel;

    private bool themesDownloaded = false;
    public string tempUrl = "";
    public uint tempVersion = 0;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        // Theme asset bundle loading is handled locally — no AIS call needed.
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        foreach (Transform tObj in assetContainer)
            Destroy(tObj.gameObject);
    }
    #endregion

    #region COROUTINES
    IEnumerator LoadAssetBundle(string url, uint version)
    {
        var uwr = UnityWebRequestAssetBundle.GetAssetBundle(url, version, 0);
        yield return uwr.SendWebRequest();

        AssetBundle bundle = DownloadHandlerAssetBundle.GetContent(uwr);
        var loadAsset = bundle.LoadAssetAsync<GameObject>("Panel - Game 4 Theme Button Container");
        yield return loadAsset;

        Instantiate(loadAsset.asset, assetContainer);
        themesDownloaded = true;
    }
    #endregion
}
