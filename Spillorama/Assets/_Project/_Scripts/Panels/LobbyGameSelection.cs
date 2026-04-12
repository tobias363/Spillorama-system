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
    }

    private void OnEnable()
    {
        Debug.Log("OnEnable LobbyGameSelection");
        EnsureCandyTileExists();
        UIManager.Instance.breakTimePopup.Close();

        // WebGL: shell handles lobby display, no AIS game polling needed
        if (UIManager.Instance.selectedLanguage == "en")
            UIManager.Instance.settingPanel.InitLanguage("en");
        else
            UIManager.Instance.settingPanel.InitLanguage("nor");
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

    public void LaunchGameFromHost(string gameNumber)
    {
        Debug.Log("LaunchGameFromHost: " + gameNumber);
        UIManager.Instance.lobbyPanel.OpenHostShellLobbyState();

        switch (gameNumber)
        {
            case "1":
                UIManager.Instance.lobbyPanel.gamePlanPanel.Game1();
                break;
            case "2":
                UIManager.Instance.lobbyPanel.gamePlanPanel.Game2();
                break;
            case "3":
                UIManager.Instance.lobbyPanel.gamePlanPanel.Game3();
                break;
            case "4":
                Game4();
                break;
            case "5":
                Game5();
                break;
            case "6":
                OnCandyButtonTap();
                break;
            default:
                Debug.LogError("LaunchGameFromHost: invalid game number: " + gameNumber);
                break;
        }
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
        LaunchGameWithComplianceCheck_Spillorama(() => UIManager.Instance.game5Panel.OpenPanel());
    }

    private void Game4()
    {
        LaunchGameWithComplianceCheck_Spillorama(() => UIManager.Instance.game4Panel.OpenPanel());
    }

    /// <summary>
    /// WebGL: Check compliance restrictions before launching a game.
    /// Blocks launch if player is paused/excluded; opens break timer if blocked.
    /// </summary>
    private void LaunchGameWithComplianceCheck_Spillorama(System.Action openPanel)
    {
        if (SpilloramaApiClient.Instance == null)
        {
            openPanel?.Invoke();
            return;
        }

        string hallId = UIManager.Instance.Player_Hall_ID ?? "";
        SpilloramaApiClient.Instance.GetCompliance(hallId,
            (SpilloramaComplianceData compliance) =>
            {
                if (compliance.restrictions.isBlocked)
                {
                    UIManager.Instance.isBreak = true;
                    if (!string.IsNullOrEmpty(compliance.restrictions.blockedUntil))
                    {
                        UIManager.Instance.endBreakTime = System.DateTimeOffset.Parse(
                            compliance.restrictions.blockedUntil,
                            System.Globalization.CultureInfo.InvariantCulture,
                            System.Globalization.DateTimeStyles.AssumeUniversal);
                        UIManager.Instance.breakTimePopup.OpenPanel("null");
                    }
                    else
                    {
                        UIManager.Instance.messagePopup.DisplayMessagePopup(
                            compliance.restrictions.blockedReason == "self_exclusion"
                                ? "Du er utestengt fra spill."
                                : "Spillpause er aktiv.");
                    }
                    return;
                }

                UIManager.Instance.isBreak = false;
                openPanel?.Invoke();
            },
            (string code, string message) =>
            {
                Debug.LogWarning($"[LobbyGameSelection] Compliance check failed: {code} — {message}");
                // Fail-closed: block game launch when compliance cannot be verified
                UIManager.Instance.messagePopup.DisplayMessagePopup("Kunne ikke verifisere spilltilgang. Prøv igjen.");
            }
        );
    }

    private void CallHomeEvent()
    {
        // AIS Home event removed — lobby data comes from Spillorama web shell.
    }

    IEnumerator RefreshEveryMinute()
    {
        while (true)
        {
            StartCoroutine(LandingScreenController.Instance.Get_AvailableGames());
            yield return new WaitForSeconds(30f);
        }
    }
    #endregion
}
