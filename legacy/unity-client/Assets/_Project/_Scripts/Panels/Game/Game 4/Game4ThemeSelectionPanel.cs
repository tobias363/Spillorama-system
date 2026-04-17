using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP;
using BestHTTP.SocketIO;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

public class Game4ThemeSelectionPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

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
    private void Start()
    {
        // objectDetailPanel.SetActive(Utility.Instance.IsStandAloneVersion());
    }

    private void OnEnable()
    {
        if (themesDownloaded == false)
        {
            //CallGame4ThemesDataEvent();
            //StartCoroutine(LoadAssetBundle(tempUrl, tempVersion));
        }

        //GameSocketManager.OnSocketReconnected += Reconnect;
    }

    private void OnDisable()
    {
        //GameSocketManager.OnSocketReconnected -= Reconnect;
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS    
    #endregion    

    #region PRIVATE_METHODS
    private void Reconnect()
    {
        if (themesDownloaded == false)
            CallGame4ThemesDataEvent();
    }

    private void CallGame4ThemesDataEvent()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.Game4ThemesData(Game4ThemesDataHandling);
    }

    private void Game4ThemesDataHandling(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Game4ThemesDataHandling: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        EventResponse<Game4ThemesData> game4ThemeData = JsonUtility.FromJson<EventResponse<Game4ThemesData>>(Utility.Instance.GetPacketString(packet));
        if (game4ThemeData.status == Constants.EventStatus.SUCCESS)
        {
            StartCoroutine(LoadAssetBundle(game4ThemeData.result.assetBundleUrl, game4ThemeData.result.version));
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(game4ThemeData.message);
        }
    }

    private void Reset()
    {
        foreach (Transform tObj in assetContainer)
            Destroy(tObj.gameObject);
    }
    #endregion

    #region COROUTINES
    IEnumerator LoadAssetBundle(string url, uint version)
    {
        // UIManager.Instance.DisplayLoader(true);
        var uwr = UnityWebRequestAssetBundle.GetAssetBundle(Constants.ServerDetails.BaseUrl + url, version, 0);
        yield return uwr.SendWebRequest();

        // Get an asset from the bundle and instantiate it.
        AssetBundle bundle = DownloadHandlerAssetBundle.GetContent(uwr);
        var loadAsset = bundle.LoadAssetAsync<GameObject>("Panel - Game 4 Theme Button Container");
        yield return loadAsset;

        Instantiate(loadAsset.asset, assetContainer);
        UIManager.Instance.DisplayLoader(false);
        themesDownloaded = true;
    }
    #endregion

    #region GETTER_SETTER
    #endregion
}
