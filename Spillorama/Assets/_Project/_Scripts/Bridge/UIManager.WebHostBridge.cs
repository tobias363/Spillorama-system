using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable]
public class ApprovedHallHostSyncItem
{
    public string hallId = "";
    public string hallName = "";
    public double totalLimitAvailable = 0;
    public bool isSelected = false;
}

[Serializable]
public class ApprovedHallHostSyncPayload
{
    public string activeHallId = "";
    public string activeHallName = "";
    public List<ApprovedHallHostSyncItem> halls = new List<ApprovedHallHostSyncItem>();
}

[Serializable]
public class SpilloramaUserPayload
{
    public string id;
    public string email;
    public string displayName;
    public string phone;
    public string walletId;
    public string role;
    public string kycStatus;
    public string birthDate;
    public float balance;
    public string createdAt;
    public string updatedAt;
}

[Serializable]
public class SpilloramaWalletPayload
{
    public SpilloramaAccountPayload account;
}

[Serializable]
public class SpilloramaAccountPayload
{
    public float balance;
}

public partial class UIManager
{
    // Phase 1: Spillorama JWT stored after ReceiveShellToken
    private string _shellJwt = "";
    public string ShellJwt => _shellJwt;

    /// <summary>
    /// Phase 1: Returns the Spillorama backend base URL.
    /// In WebGL, derived from window.location so it works on any host.
    /// In editor/standalone, falls back to localhost.
    /// </summary>
    // Phase 2: public alias so SpilloramaApiClient can call this without reflection
    public string GetSpilloramaBaseUrlPublic() => GetSpilloramaBaseUrl();

    private string GetSpilloramaBaseUrl()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        var uri = new Uri(Application.absoluteURL);
        return uri.Scheme + "://" + uri.Authority;
#else
        return "http://localhost:4001";
#endif
    }

    /// <summary>
    /// Phase 1 entry point. Called by JS shell via SendMessage after login.
    /// Validates JWT against Spillorama REST, populates gameAssetData, then
    /// launches any pending game. Does NOT require AIS socket to be connected.
    /// </summary>
    public void ReceiveShellToken(string jwt)
    {
        if (string.IsNullOrEmpty(jwt))
        {
            Debug.LogWarning("[Phase1] ReceiveShellToken: empty JWT — ignoring");
            return;
        }

        _shellJwt = jwt;
        Debug.Log("[Phase1] ReceiveShellToken: JWT received, fetching Spillorama profile");

        // Ensure Spillorama singletons exist (they may not be in the scene)
        if (SpilloramaApiClient.Instance == null)
        {
            var go = new GameObject("SpilloramaRuntime");
            go.AddComponent<SpilloramaApiClient>();
            go.AddComponent<SpilloramaSocketManager>();
            go.AddComponent<SpilloramaGameBridge>();
            DontDestroyOnLoad(go);
            Debug.Log("[Phase1] Created SpilloramaRuntime GameObject with ApiClient + SocketManager + GameBridge");
        }

        SpilloramaApiClient.Instance.GetProfile(
            (SpilloramaUserPayload u) =>
            {
                Debug.Log($"[Phase1] Spillorama profile: id={u.id} displayName={u.displayName} balance={u.balance}");

                // Populate gameAssetData from Spillorama — same fields AIS login sets
                gameAssetData.PlayerId = u.id;
                gameAssetData.IsLoggedIn = true;
                string balanceStr = u.balance.ToString("###,###,##0.00", System.Globalization.CultureInfo.InvariantCulture);
                gameAssetData.RealMoney = balanceStr;
                gameAssetData.TodaysBalance = balanceStr;

                // Forward JWT to shell as "player token" so spillvett.js stays in sync
                SyncPlayerTokenToWebHost(jwt);

                // Phase 2: open Spillorama socket connection now that we have a JWT
                if (SpilloramaSocketManager.Instance != null)
                    SpilloramaSocketManager.Instance.Connect();

                // Launch any game that was pending before Unity was ready
                ProcessPendingHostGame();
            },
            (string code, string msg) =>
            {
                Debug.LogWarning($"[Phase1] FetchSpilloramaAuthMe failed: {code} {msg}");
            }
        );
    }

    /// <summary>
    /// Phase 1: Fetches wallet balance from Spillorama REST.
    /// Called by RefreshPlayerWalletFromHost when a shell JWT is available.
    /// </summary>
    private void FetchSpilloramaWallet()
    {
        SpilloramaApiClient.Instance.GetWallet(
            (SpilloramaWalletPayload wallet) =>
            {
                float balance = wallet.account.balance;
                string balanceStr = balance.ToString("###,###,##0.00", System.Globalization.CultureInfo.InvariantCulture);
                gameAssetData.RealMoney = balanceStr;
                gameAssetData.TodaysBalance = balanceStr;
                SyncActiveHallToWebHost();
                SyncApprovedHallsToWebHost();
                Debug.Log($"[Phase1] Wallet refreshed from Spillorama: {balance}");
            },
            (string code, string msg) =>
            {
                Debug.LogWarning($"[Phase1] FetchSpilloramaWallet failed: {code} {msg}");
            }
        );
    }

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
        Application.ExternalCall("ClearApprovedHalls");
#endif
    }

    public void SyncActiveHallToWebHost()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!string.IsNullOrEmpty(Player_Hall_ID))
            Application.ExternalCall("SetActiveHall", Player_Hall_ID, Player_Hall_Name ?? "");
#endif
    }

    public void SyncApprovedHallsToWebHost()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        ApprovedHallHostSyncPayload payload = new ApprovedHallHostSyncPayload
        {
            activeHallId = Player_Hall_ID ?? "",
            activeHallName = Player_Hall_Name ?? ""
        };

        if (topBarPanel != null && topBarPanel.ApprovedHalls != null)
        {
            foreach (ApprovedHalls hall in topBarPanel.ApprovedHalls)
            {
                if (hall == null)
                    continue;

                payload.halls.Add(new ApprovedHallHostSyncItem
                {
                    hallId = hall.hallId ?? "",
                    hallName = hall.hallName ?? "",
                    totalLimitAvailable = hall.totalLimitAvailable,
                    isSelected = hall.isSelected || hall.hallId == Player_Hall_ID
                });
            }
        }

        Application.ExternalCall("SetApprovedHalls", JsonUtility.ToJson(payload));
#endif
    }

    public void RefreshPlayerWalletFromHost()
    {
        if (string.IsNullOrEmpty(_shellJwt))
        {
            Debug.LogWarning("RefreshPlayerWalletFromHost skipped: no JWT available.");
            return;
        }

        FetchSpilloramaWallet();
    }

    public void SwitchActiveHallFromHost(string hallId)
    {
        if (string.IsNullOrEmpty(hallId))
        {
            Debug.LogWarning("SwitchActiveHallFromHost skipped: missing hallId.");
            return;
        }

        if (topBarPanel == null)
        {
            Debug.LogWarning("SwitchActiveHallFromHost skipped: topBarPanel missing.");
            return;
        }

        topBarPanel.SwitchHallFromHost(hallId);
    }

    public void NavigateToGame(string gameNumber)
    {
        Debug.Log("NavigateToGame called from JS: game_" + gameNumber);

        if (gameNumber == "0")
        {
            topBarPanel.OnGamesButtonTap();
            return;
        }

        // If player hasn't logged in yet, queue the game for after login
        if (!gameAssetData.IsLoggedIn)
        {
            Debug.Log("NavigateToGame: player not logged in yet, queuing game_" + gameNumber);
            pendingHostGameNumber = gameNumber;
            return;
        }

        LaunchHostGame(gameNumber);
    }

    public void LaunchHostGame(string gameNumber)
    {
        // Hide top bar when launching game from web shell
        if (isGameWebGL && topBarPanel != null)
        {
            topBarPanel.Close();
        }

        LobbyGameSelection gameSelection = lobbyPanel != null
            ? lobbyPanel.GetComponentInChildren<LobbyGameSelection>(true)
            : null;

        if (gameSelection == null)
        {
            Debug.LogError("NavigateToGame: LobbyGameSelection not found in lobbyPanel");
            return;
        }

        gameSelection.LaunchGameFromHost(gameNumber);
    }

    /// <summary>
    /// Called after login succeeds to launch any game queued by the web shell.
    /// </summary>
    public void ProcessPendingHostGame()
    {
        if (string.IsNullOrEmpty(pendingHostGameNumber))
            return;

        string gameNumber = pendingHostGameNumber;
        pendingHostGameNumber = "";
        Debug.Log("ProcessPendingHostGame: launching queued game_" + gameNumber);
        LaunchHostGame(gameNumber);
    }

    /// <summary>
    /// [DEPRECATED – BIN-276] AIS socket login removed. Web shell no longer calls this.
    /// Kept as no-op so older cached WebGL builds don't throw.
    /// </summary>
    [System.Obsolete("BIN-276: AIS credentials removed. Shell uses JWT + SpilloramaSocketManager.")]
    public void ReceiveHostCredentials(string payload)
    {
        // BIN-276: AIS credentials no longer used — JWT + SpilloramaSocketManager handles auth.
        // Method kept as no-op for backwards compatibility with cached WebGL builds.
        Debug.Log("[HostMode] ReceiveHostCredentials: IGNORED (deprecated, using JWT path)");
    }

    // BIN-276: HostLoginCallback removed — was only used by ReceiveHostCredentials (now no-op)

    /// <summary>
    /// Signals to the web shell that Unity is ready to accept game navigation.
    /// Called after socket connection and login flow is set up.
    /// </summary>
    public void SignalHostReady()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        Application.ExternalCall("OnUnityReady");
#endif
    }

    public void ReturnToLobby()
    {
        Debug.Log("ReturnToLobby called from JS");

        if (isGameWebGL)
        {
            // Host mode: close ALL Unity panels, let web shell show its own lobby.
            // Unity stays loaded in background, ready for the next game launch.
            CloseAllPanels();
            if (topBarPanel != null) topBarPanel.Close();

            // Notify web shell to show its lobby
#if UNITY_WEBGL && !UNITY_EDITOR
            Application.ExternalCall("returnToShellLobby");
#endif
            return;
        }

        topBarPanel.OnGamesButtonTap();
    }
}
