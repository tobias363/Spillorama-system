using System.Collections;
using UnityEngine;

public partial class UIManager
{
    public void SyncPlayerTokenToWebHost()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        string authToken = gameAssetData != null && gameAssetData.playerGameData != null
            ? gameAssetData.playerGameData.authToken
            : "";

        if (!string.IsNullOrEmpty(authToken))
            Application.ExternalCall("SetPlayerToken", authToken);
#endif
    }

    public void SyncPlayerTokenToWebHost(string authToken)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!string.IsNullOrEmpty(authToken))
            Application.ExternalCall("SetPlayerToken", authToken);
#endif
    }

    public void ClearPlayerTokenFromWebHost()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        Application.ExternalCall("ClearPlayerToken");
#endif
    }

    public void RefreshPlayerWalletFromHost()
    {
        if (gameAssetData == null
            || gameAssetData.playerGameData == null
            || !gameAssetData.IsLoggedIn
            || string.IsNullOrEmpty(gameAssetData.PlayerId))
        {
            Debug.LogWarning("RefreshPlayerWalletFromHost skipped: missing logged-in player context.");
            return;
        }

        EventManager.Instance.GetPlayerDetails(
            gameAssetData.PlayerId,
            (socket, packet, args) =>
            {
                EventResponse<ProfileData> response = JsonUtility.FromJson<EventResponse<ProfileData>>(
                    Utility.Instance.GetPacketString(packet)
                );

                if (response.status != Constants.EventStatus.SUCCESS || response.result == null)
                {
                    Debug.LogWarning("RefreshPlayerWalletFromHost failed: " + (response != null ? response.message : "empty response"));
                    return;
                }

                gameAssetData.PlayerId = response.result.playerId;
                gameAssetData.Points = response.result.points.ToString("###,###,##0.00");
                gameAssetData.RealMoney = response.result.realMoney.ToString("###,###,##0.00");
                gameAssetData.TodaysBalance = response.result.realMoney.ToString("###,###,##0.00");
                Player_Hall_ID = response.result.hall;
                Player_Hall_Name = response.result.hallName;
            }
        );
    }

    public void NavigateToGame(string gameNumber)
    {
        Debug.Log("NavigateToGame called from JS: game_" + gameNumber);

        if (gameNumber == "0")
        {
            topBarPanel.OnGamesButtonTap();
            return;
        }

        lobbyPanel.OpenGameSelectionPanel();
        StartCoroutine(NavigateToGameDelayed(gameNumber));
    }

    public void ReturnToLobby()
    {
        Debug.Log("ReturnToLobby called from JS");
        topBarPanel.OnGamesButtonTap();
    }

    private IEnumerator NavigateToGameDelayed(string gameNumber)
    {
        yield return null;

        LobbyGameSelection gameSelection = lobbyPanel.GetComponentInChildren<LobbyGameSelection>(true);
        if (gameSelection == null)
        {
            Debug.LogError("NavigateToGame: LobbyGameSelection not found in lobbyPanel");
            yield break;
        }

        gameSelection.gameObject.SetActive(true);
        switch (gameNumber)
        {
            case "1":
                gameSelection.OnGame1ButtonTap();
                break;
            case "2":
                gameSelection.OnGame2ButtonTap();
                break;
            case "3":
                gameSelection.OnGame3ButtonTap();
                break;
            case "4":
                gameSelection.OnGame4ButtonTap();
                break;
            case "5":
                gameSelection.OnGame5ButtonTap();
                break;
            case "6":
                gameSelection.OnCandyButtonTap();
                break;
            default:
                Debug.LogError("NavigateToGame: invalid game number: " + gameNumber);
                break;
        }
    }
}
