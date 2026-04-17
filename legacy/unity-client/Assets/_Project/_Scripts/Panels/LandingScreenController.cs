using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using System;
using System.Linq;

[System.Serializable]
public class BingoGameType
{
    public TMP_Text Game_Name_Txt;
    public Image Game_Img;
}

public class LandingScreenController : MonoBehaviour
{
    #region Variables

    public static LandingScreenController Instance;

    public List<GameType> BingoGameList;

    public List<BingoGameType> Bingo_Games;

    public EventResponse<AvailableGamesResult> availableGamesResult;
    public EventResponse<GameStatusData> gameStatusData;

    public List<PanelGameStatus> panelGameStatusList;

    #endregion

    #region Unity Methods

    void Awake()
    {
        Instance = this;
    }

    #endregion

    #region Game List

    public void EnableBroadcasts()
    {
        // AIS socket broadcasts removed — Spillorama pushes game status via SpilloramaGameBridge.
        Debug.Log("[LandingScreenController] EnableBroadcasts: no-op (Spillorama path)");
    }

    public void DisableBroadcasts()
    {
        // AIS socket broadcasts removed.
    }

    internal void Get_Game_Type_List()
    {
        // AIS GameTypeList event removed — game types are configured via Spillorama backend.
        Debug.Log("[LandingScreenController] Get_Game_Type_List: no-op (Spillorama path)");
    }

    internal IEnumerator Get_AvailableGames()
    {
        // AIS AvailableGames event removed — game availability is managed by Spillorama web shell.
        // Stub kept because LobbyGameSelection.OnGameButtonTap yields on this coroutine.
        Debug.Log("[LandingScreenController] Get_AvailableGames: no-op (Spillorama path)");

        // Mark all games as Open so the lobby tap-through works in Spillorama mode.
        ProcessGameStatus("game_2", "Open", "", null);
        ProcessGameStatus("game_3", "Open", "", null);
        ProcessGameStatus("game_4", "Open", "", null);
        ProcessGameStatus("game_5", "Open", "", null);
        yield break;
    }

    internal IEnumerator Get_Game1Status()
    {
        // AIS Game1Status event removed — game availability is managed by Spillorama web shell.
        Debug.Log("[LandingScreenController] Get_Game1Status: no-op (Spillorama path)");
        ProcessGameStatus("game_1", "Open", "", null);
        yield break;
    }

    // AIS broadcast handlers (OnGame1Status, AvailableGames, checkGameStatus) removed.
    // Game status updates in Spillorama come via SpilloramaGameBridge events.

    internal void ProcessGameStatus(string gameName, string status, string date, GameStatusData gameStatusData = null)
    {
        Debug.Log("ProcessGameStatus : " + gameName + " " + status);
        PanelGameStatus foundStatus = GetPanelGameStatusByName(gameName);

        if (foundStatus != null)
        {
            foundStatus.SetData(gameName, gameStatusData);
        }

        switch (gameName)
        {
            case "game_1":
                if (status == "Closed" && UIManager.Instance.game1Panel.isActiveAndEnabled)
                {
                    if (!UIManager.Instance.game1Panel.game1GamePlayPanel.onGameStart)
                    {
                        // AIS IsHallClosed call removed — Spillorama web shell manages hall status.
                        Debug.Log("[LandingScreenController] game_1 Closed while active, returning to lobby");
                        UIManager.Instance.topBarPanel.OnGamesButtonTap();
                    }
                }
                break;
            case "game_2":
                if (status == "Closed" && UIManager.Instance.game2Panel.isActiveAndEnabled)
                {
                    UIManager.Instance.topBarPanel.OnGamesButtonTap();
                }
                break;
            case "game_3":
                if (status == "Closed" && UIManager.Instance.game3Panel.isActiveAndEnabled)
                {
                    UIManager.Instance.topBarPanel.OnGamesButtonTap();
                }
                break;
            case "game_4":
                if (status == "Closed" && UIManager.Instance.game4Panel.isActiveAndEnabled)
                {
                    UIManager.Instance.topBarPanel.OnGamesButtonTap();
                }
                break;
            case "game_5":
                if (status == "Closed" && UIManager.Instance.game5Panel.isActiveAndEnabled)
                {
                    UIManager.Instance.topBarPanel.OnGamesButtonTap();
                }
                break;
        }
    }

    void Download_Game_Image(Image img, string imgPath)
    {
        string url = Constants.ServerDetails.BaseUrl + "/" + imgPath;
        Debug.Log($"Downloading an Image {url}");
        StartCoroutine(DownloadHelper.DownloadImage(url, (t) =>
        {
            Rect r = new Rect(0, 0, t.width, t.height);
            Vector2 p = Vector2.one * 0.5f;
            img.sprite = Sprite.Create(t, r, p);
        }));
    }
    public PanelGameStatus GetPanelGameStatusByName(string gameName)
    {
        PanelGameStatus foundPanelGameStatus = panelGameStatusList.FirstOrDefault(panel => panel.gameName == gameName);
        return foundPanelGameStatus;
    }
    #endregion
}
