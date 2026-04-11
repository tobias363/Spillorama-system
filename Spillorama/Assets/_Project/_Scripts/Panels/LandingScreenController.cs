using System.Collections;
using BestHTTP.SocketIO;
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
        GameSocketManager.SocketConnectionInitialization += EnableBroadcasts;
    }

    #endregion

    #region Game List

    public void EnableBroadcasts()
    {
        GameSocketManager.SocketConnectionInitialization -= EnableBroadcasts;
        GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.Game1Status, OnGame1Status);
        GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.AvailableGames, AvailableGames);
        GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.checkGameStatus, checkGameStatus);
    }

    public void DisableBroadcasts()
    {
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.Game1Status, OnGame1Status);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.AvailableGames, AvailableGames);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.checkGameStatus, checkGameStatus);
    }

    internal void Get_Game_Type_List()
    {
        EventManager.Instance.GameTypeList((socket, packet, args) =>
        {
            print(packet.ToString());
            EventResponse<GameTypeList> resp = JsonUtility.FromJson<EventResponse<GameTypeList>>(Utility.Instance.GetPacketString(packet));
            if (resp.status.Equals(Constants.EventStatus.SUCCESS))
            {
                for (int i = 0; i < resp.result.gameList.Count; i++)
                {
                    Bingo_Games[i].Game_Name_Txt.text = resp.result.gameList[i].name;

                    if (i >= BingoGameList.Count)
                    {
                        Download_Game_Image(Bingo_Games[i].Game_Img, resp.result.gameList[i].img);
                        BingoGameList.Add(new GameType(resp.result.gameList[i].name, resp.result.gameList[i].img));
                    }
                    else if (BingoGameList[i].img != resp.result.gameList[i].img)
                    {
                        BingoGameList[i].img = resp.result.gameList[i].img;
                        Download_Game_Image(Bingo_Games[i].Game_Img, BingoGameList[i].img);
                    }
                }
            }
            else
            {
                print("Game List failed");
            }
            ;

        });
    }

    internal IEnumerator Get_AvailableGames()
    {
        Debug.Log("Get_AvailableGames");
        bool responseReceived = false;

        EventManager.Instance.AvailableGames((socket, packet, args) =>
        {
            print("AvailableGames Response: " + packet.ToString());
            EventResponse<AvailableGamesResult> resp = JsonUtility.FromJson<EventResponse<AvailableGamesResult>>(Utility.Instance.GetPacketString(packet));
            availableGamesResult = resp;
            if (resp.status.Equals(Constants.EventStatus.SUCCESS))
            {
                ProcessGameStatus("game_2", resp.result.game_2.status, resp.result.game_2.date, resp.result.game_2);
                ProcessGameStatus("game_3", resp.result.game_3.status, resp.result.game_3.date, resp.result.game_3);
                ProcessGameStatus("game_4", resp.result.game_4.status, resp.result.game_4.date, resp.result.game_4);
                ProcessGameStatus("game_5", resp.result.game_5.status, resp.result.game_5.date, resp.result.game_5);

                responseReceived = true;
            }
        });

        // Wait until response is received or timeout occurs
        yield return new WaitUntil(() => responseReceived);
    }

    internal IEnumerator Get_Game1Status()
    {
        bool responseReceived = false;

        EventManager.Instance.Game1Status((socket, packet, args) =>
        {
            print("Game1Status Response: " + packet.ToString());
            EventResponse<GameStatusData> resp = JsonUtility.FromJson<EventResponse<GameStatusData>>(Utility.Instance.GetPacketString(packet));
            gameStatusData = resp;
            if (resp.status.Equals(Constants.EventStatus.SUCCESS))
            {
                ProcessGameStatus("game_1", resp.result.status, resp.result.date, resp.result);
                responseReceived = true;
            }
        });

        // Wait until response is received or timeout occurs
        yield return new WaitUntil(() => responseReceived);
    }

    private void OnGame1Status(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGame1Status Broadcast:" + packet.ToString());
        GameStatusData resp = JsonUtility.FromJson<GameStatusData>(Utility.Instance.GetPacketString(packet));
        ProcessGameStatus("game_1", resp.status, resp.date, resp);
    }

    private void AvailableGames(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("AvailableGames Broadcast:" + packet.ToString());
        AvailableGamesResult resp = JsonUtility.FromJson<AvailableGamesResult>(Utility.Instance.GetPacketString(packet));

        ProcessGameStatus("game_2", resp.game_2.status, resp.game_2.date, resp.game_2);
        ProcessGameStatus("game_3", resp.game_3.status, resp.game_3.date, resp.game_3);
        ProcessGameStatus("game_4", resp.game_4.status, resp.game_4.date, resp.game_4);
        ProcessGameStatus("game_5", resp.game_5.status, resp.game_5.date, resp.game_5);
    }

    private void checkGameStatus(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("checkGameStatus Broadcast: (Empty Broadcast)" + packet.ToString());

        EventManager.Instance.AvailableGames((socket, packet, args) =>
        {
            print("AvailableGames Response: " + packet.ToString());
            EventResponse<AvailableGamesResult> resp = JsonUtility.FromJson<EventResponse<AvailableGamesResult>>(Utility.Instance.GetPacketString(packet));
            availableGamesResult = resp;
            if (resp.status.Equals(Constants.EventStatus.SUCCESS))
            {
                ProcessGameStatus("game_2", resp.result.game_2.status, resp.result.game_2.date, resp.result.game_2);
                ProcessGameStatus("game_3", resp.result.game_3.status, resp.result.game_3.date, resp.result.game_3);
                ProcessGameStatus("game_4", resp.result.game_4.status, resp.result.game_4.date, resp.result.game_4);
                ProcessGameStatus("game_5", resp.result.game_5.status, resp.result.game_5.date, resp.result.game_5);
            }
        });
    }

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
                    Debug.LogError(UIManager.Instance.game1Panel.game1GamePlayPanel.onGameStart);
                    if (!UIManager.Instance.game1Panel.game1GamePlayPanel.onGameStart)
                    {
                        EventManager.Instance.IsHallClosed((socket, packet, args) =>
                        {
                            print("IsHallClosed Response: " + packet.ToString());
                            EventResponse<IsHallClosed> resp = JsonUtility.FromJson<EventResponse<IsHallClosed>>(Utility.Instance.GetPacketString(packet));
                            if (resp.result.isClosed && UIManager.Instance.game1Panel.isActiveAndEnabled)
                            {
                                Debug.Log($"response status closed -- {resp.status}");
                                UIManager.Instance.topBarPanel.OnGamesButtonTap();
                            }
                            else
                            {
                                Debug.Log($"response status other than closed -- {resp.status}");
                            }
                        });
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
