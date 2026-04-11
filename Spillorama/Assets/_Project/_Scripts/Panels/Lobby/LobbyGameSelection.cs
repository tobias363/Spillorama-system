using BestHTTP.SocketIO;
using System;
using System.Collections;
using System.Globalization;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

public class LobbyGameSelection : MonoBehaviour
{
    #region PRIVATE_VARIABLES
    private const string CandyTileObjectName = "Panel - Candy Mania";
    private const string CandyTileDisplayName = "Candy Mania";
    private const string CandyTileRoute = "/candy/";
    private const string CandyTileStatusName = "game_candy";
    private const string CandyThumbnailSpriteName = "godterihuset";

    [SerializeField] private HomeListItem[] homeList;
    private bool start = false;

    private Coroutine refreshGet_AvailableGames;
    private PanelGameStatus candyPanelGameStatus;
    private Sprite candyThumbnailSprite;
    #endregion

    #region UNITY_CALLBACKS
    private void Start()
    {
        EnsureCandyTileExists();
        CallHomeEvent();
        start = true;
    }

    private void OnDisable()
    {
        // Stop calling the method
        if (refreshGet_AvailableGames != null)
            StopCoroutine(refreshGet_AvailableGames);
        GameSocketManager.OnSocketReconnected -= Reconnect;
    }

    private void OnEnable()
    {
        GameSocketManager.OnSocketReconnected += Reconnect;
        Debug.Log("OnEnable LobbyGameSelection");
        EnsureCandyTileExists();
        // UIManager.Instance.webViewManager.DestoryWebs();
        UIManager.Instance.breakTimePopup.Close();
        if (start)
            CallHomeEvent();
        LandingScreenController.Instance.Get_Game_Type_List();
        StartCoroutine(LandingScreenController.Instance.Get_AvailableGames());
        StartCoroutine(LandingScreenController.Instance.Get_Game1Status());

        // Start calling the method every 1 minute
        refreshGet_AvailableGames = StartCoroutine(RefreshEveryMinute());

        if (UIManager.Instance.selectedLanguage == "en")
            UIManager.Instance.settingPanel.InitLanguage("en");
        else
            UIManager.Instance.settingPanel.InitLanguage("nor");
    }

    private void Reconnect()
    {
        Debug.Log("Reconnect LobbyGameSelection");
        StartCoroutine(LandingScreenController.Instance.Get_AvailableGames());
        StartCoroutine(LandingScreenController.Instance.Get_Game1Status());
    }

    #endregion

    #region PUBLIC_METHODS

    public void OnGame1ButtonTap()
    {
        this.Open();
        UIManager.Instance.lobbyPanel.Open();
        StartCoroutine(OnGameButtonTap("game_1"));
    }

    public void OnGame2ButtonTap()
    {
        this.Open();
        UIManager.Instance.lobbyPanel.Open();
        StartCoroutine(OnGameButtonTap("game_2"));
    }

    public void OnGame3ButtonTap()
    {
        this.Open();
        UIManager.Instance.lobbyPanel.Open();
        StartCoroutine(OnGameButtonTap("game_3"));
    }

    public void OnGame4ButtonTap()
    {
        this.Open();
        UIManager.Instance.lobbyPanel.Open();
        StartCoroutine(OnGameButtonTap("game_4"));
    }

    public void OnGame5ButtonTap()
    {
        this.Open();
        UIManager.Instance.lobbyPanel.Open();
        StartCoroutine(OnGameButtonTap("game_5"));
    }

    public void OnCandyButtonTap()
    {
        Debug.Log("OnCandyButtonTap");

#if UNITY_WEBGL && !UNITY_EDITOR
        Application.ExternalCall("OpenUrlInSameTab", CandyTileRoute);
#else
        Debug.LogWarning("Candy overlay is only available in WebGL builds. Requested route: " + CandyTileRoute);
#endif
    }

    public IEnumerator OnGameButtonTap(string gameName)
    {
        Debug.Log("OnGameButtonTap : " + gameName);
        if (gameName == "game_1")
        {
            yield return StartCoroutine(LandingScreenController.Instance.Get_Game1Status());
        }
        else
        {
            yield return StartCoroutine(LandingScreenController.Instance.Get_AvailableGames());
        }

        PanelGameStatus foundStatus = LandingScreenController.Instance.GetPanelGameStatusByName(gameName);

        if (foundStatus.status == "Start at" || foundStatus.status == "Open")
        {
            this.Close();
            UIManager.Instance.lobbyPanel.Close();
            UIManager.Instance.CloseAllSubPanels();
            switch (gameName)
            {
                case "game_1":
                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                    break;
                case "game_2":
                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame2ButtonTap();
                    break;
                case "game_3":
                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame3ButtonTap();
                    break;
                case "game_4":
                    // UIManager.Instance.game4Panel.OpenPanel();
                    Game4();
                    break;
                case "game_5":
                    // UIManager.Instance.game5Panel.OpenPanel();
                    Game5();
                    break;
                // Add cases for additional games if needed
                default:
                    Debug.LogError("Invalid game name: " + gameName);
                    break;
            }
        }
        else
        {
            Debug.LogError("Game is Closed wait for it");
            // UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GameIsClosedMessage, () =>
            // {
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
            // UIManager.Instance.messagePopup.Close();
            // });
        }
    }

    #endregion

    #region PRIVATE_METHODS
    private void EnsureCandyTileExists()
    {
        if (candyPanelGameStatus != null)
        {
            candyPanelGameStatus.gameObject.SetActive(true);
            candyPanelGameStatus.transform.SetAsLastSibling();
            RegisterCandyPanelWithLandingScreen();
            RebuildCandyTileLayout(candyPanelGameStatus.transform.parent as RectTransform);
            return;
        }

        Transform gameButtonContainer = GetLobbyGameButtonContainer();
        if (gameButtonContainer == null)
        {
            Debug.LogError("Candy tile setup failed: Panel - Game Button Container not found.");
            return;
        }

        Transform existingCandyTile = FindNamedChild(gameButtonContainer, CandyTileObjectName);
        if (existingCandyTile != null)
        {
            candyPanelGameStatus = existingCandyTile.GetComponent<PanelGameStatus>();
            ConfigureCandyTile(candyPanelGameStatus);
            return;
        }

        PanelGameStatus templateStatus = GetCandyTileTemplate(gameButtonContainer);
        if (templateStatus == null)
        {
            Debug.LogError("Candy tile setup failed: no template tile found in lobby.");
            return;
        }

        GameObject candyTile = Instantiate(templateStatus.gameObject, gameButtonContainer, false);
        candyTile.name = CandyTileObjectName;
        candyTile.SetActive(true);
        candyPanelGameStatus = candyTile.GetComponent<PanelGameStatus>();
        ConfigureCandyTile(candyPanelGameStatus);
        RegisterCandyPanelWithLandingScreen();

        if (gameButtonContainer is RectTransform rectTransform)
            RebuildCandyTileLayout(rectTransform);
    }

    private PanelGameStatus GetCandyTileTemplate(Transform gameButtonContainer)
    {
        if (LandingScreenController.Instance != null)
        {
            PanelGameStatus serializedGame5Tile = LandingScreenController.Instance.GetPanelGameStatusByName("game_5");
            if (serializedGame5Tile != null)
                return serializedGame5Tile;
        }

        PanelGameStatus[] availableTiles = gameButtonContainer.GetComponentsInChildren<PanelGameStatus>(true);
        foreach (PanelGameStatus tile in availableTiles)
        {
            if (tile != null && tile.gameName == "game_5")
                return tile;
        }

        foreach (PanelGameStatus tile in availableTiles)
        {
            if (tile != null)
                return tile;
        }

        return null;
    }

    private void ConfigureCandyTile(PanelGameStatus panelGameStatus)
    {
        if (panelGameStatus == null)
            return;

        panelGameStatus.gameObject.SetActive(true);
        panelGameStatus.gameName = CandyTileStatusName;
        panelGameStatus.SetData(CandyTileStatusName, new GameStatusData
        {
            status = "Open",
            date = string.Empty
        });

        TMP_Text gameNameText = FindNamedComponent<TMP_Text>(panelGameStatus.transform, "Text - Game Name");
        if (gameNameText != null)
            gameNameText.text = CandyTileDisplayName;

        Image thumbnailImage = FindNamedComponent<Image>(panelGameStatus.transform, "Image - Game Thumbnail");
        Sprite candySprite = GetCandyThumbnailSprite();
        if (thumbnailImage != null && candySprite != null)
            thumbnailImage.sprite = candySprite;

        if (panelGameStatus._PlayButton == null)
            return;

        DisablePersistentClickListeners(panelGameStatus._PlayButton);
        panelGameStatus._PlayButton.onClick.RemoveAllListeners();
        panelGameStatus._PlayButton.onClick.AddListener(OnCandyButtonTap);
    }

    private Transform GetLobbyGameButtonContainer()
    {
        if (LandingScreenController.Instance != null && LandingScreenController.Instance.panelGameStatusList != null)
        {
            foreach (PanelGameStatus panelStatus in LandingScreenController.Instance.panelGameStatusList)
            {
                if (panelStatus != null && panelStatus.transform != null && panelStatus.transform.parent != null)
                    return panelStatus.transform.parent;
            }
        }

        return FindNamedChild(transform, "Panel - Game Button Container");
    }

    private void RegisterCandyPanelWithLandingScreen()
    {
        if (LandingScreenController.Instance == null || candyPanelGameStatus == null)
            return;

        if (LandingScreenController.Instance.panelGameStatusList == null)
            LandingScreenController.Instance.panelGameStatusList = new System.Collections.Generic.List<PanelGameStatus>();

        if (!LandingScreenController.Instance.panelGameStatusList.Contains(candyPanelGameStatus))
            LandingScreenController.Instance.panelGameStatusList.Add(candyPanelGameStatus);
    }

    private void RebuildCandyTileLayout(RectTransform gameButtonContainer)
    {
        if (gameButtonContainer == null)
            return;

        Canvas.ForceUpdateCanvases();
        LayoutRebuilder.MarkLayoutForRebuild(gameButtonContainer);
        LayoutRebuilder.ForceRebuildLayoutImmediate(gameButtonContainer);
    }

    private void DisablePersistentClickListeners(Button button)
    {
        int persistentEventCount = button.onClick.GetPersistentEventCount();
        for (int i = 0; i < persistentEventCount; i++)
        {
            button.onClick.SetPersistentListenerState(i, UnityEventCallState.Off);
        }
    }

    private Sprite GetCandyThumbnailSprite()
    {
        if (candyThumbnailSprite != null)
            return candyThumbnailSprite;

        Image[] images = Resources.FindObjectsOfTypeAll<Image>();
        foreach (Image image in images)
        {
            if (image == null || image.sprite == null)
                continue;

            if (string.Equals(image.sprite.name, CandyThumbnailSpriteName, StringComparison.OrdinalIgnoreCase))
            {
                candyThumbnailSprite = image.sprite;
                break;
            }
        }

        return candyThumbnailSprite;
    }

    private Transform FindNamedChild(Transform root, string childName)
    {
        foreach (Transform child in root.GetComponentsInChildren<Transform>(true))
        {
            if (child != null && child.name == childName)
                return child;
        }

        return null;
    }

    private T FindNamedComponent<T>(Transform root, string childName) where T : Component
    {
        Transform child = FindNamedChild(root, childName);
        if (child == null)
            return null;

        return child.GetComponent<T>();
    }

    private void Game5()
    {
        GameSocketManager.SetSocketGame5Namespace = "Game5";
        EventManager.Instance.IsGame5AvailbaleForVerifiedPlayer((socket, packet, args) =>
        {
            Debug.Log($"IsGame5AvailbaleForVerifiedPlayer Response : {packet}");
            EventResponse<CheckBreakTime> resp = JsonUtility.FromJson<EventResponse<CheckBreakTime>>(Utility.Instance.GetPacketString(packet));

            if (resp.status == Constants.EventStatus.SUCCESS)
            {
                UIManager.Instance.isBreak = resp.result.isBreak;
                if (resp.result.startBreakTime != null && resp.result.endBreakTime != null)
                {
                    UIManager.Instance.startBreakTime = DateTimeOffset.Parse(resp.result.startBreakTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
                    UIManager.Instance.endBreakTime = DateTimeOffset.Parse(resp.result.endBreakTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
                    Debug.Log("enter..break time");
                    UIManager.Instance.breakTimePopup.OpenPanel("null");
                }
                UIManager.Instance.game5Panel.OpenPanel();
            }
            else
            {
                UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
                UIManager.Instance.messagePopup.DisplayMessagePopup(resp.message);
            }
        });
    }

    private void Game4()
    {
        GameSocketManager.SetSocketGame4Namespace = "Game4";
        EventManager.Instance.IsGame4AvailbaleForVerifiedPlayer((socket, packet, args) =>
        {
            Debug.Log($"IsGame4AvailbaleForVerifiedPlayer Response : {packet}");
            EventResponse<CheckBreakTime> resp = JsonUtility.FromJson<EventResponse<CheckBreakTime>>(Utility.Instance.GetPacketString(packet));

            if (resp.status == Constants.EventStatus.SUCCESS)
            {
                UIManager.Instance.isBreak = resp.result.isBreak;
                if (resp.result.startBreakTime != null && resp.result.endBreakTime != null)
                {
                    UIManager.Instance.startBreakTime = DateTimeOffset.Parse(resp.result.startBreakTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
                    UIManager.Instance.endBreakTime = DateTimeOffset.Parse(resp.result.endBreakTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
                    //Debug.Log("enter..break time");
                    UIManager.Instance.breakTimePopup.OpenPanel("null");
                }
                UIManager.Instance.game4Panel.OpenPanel();
            }
            else
            {
                UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
                UIManager.Instance.messagePopup.DisplayMessagePopup(resp.message);
            }
        });
    }

    private void CallHomeEvent()
    {
        //UIManager.Instance.DisplayLoader(true);
        //EventManager.Instance.Home(ProcessEventResponse<HomeListItem>);
    }

    IEnumerator RefreshEveryMinute()
    {
        while (true)
        {
            // Call the method to get available games
            StartCoroutine(LandingScreenController.Instance.Get_AvailableGames());
            // Wait for 1 minute
            yield return new WaitForSeconds(30f);
        }
    }

    private void ProcessEventResponse<T>(Socket socket, Packet packet, params object[] args) where T : class
    {
        Debug.Log($"Home Response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponseArray<T> response = JsonUtility.FromJson<EventResponseArray<T>>(Utility.Instance.GetPacketString(packet));
        if (response.status == EventResponseArray<T>.STATUS_SUCCESS)
        {
            homeList = response.result as HomeListItem[];
            UIManager.Instance.gameAssetData.homeGameList = homeList;
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }
    #endregion
}
