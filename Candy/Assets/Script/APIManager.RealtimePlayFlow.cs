using System;
using System.Collections;
using System.Text;
using SimpleJSON;
using UnityEngine;
using UnityEngine.Networking;

public partial class APIManager
{
    public bool CanRequestRealtimeTicketReroll()
    {
        if (!useRealtimeBackend || realtimeClient == null || !realtimeClient.IsReady)
        {
            return false;
        }

        if (realtimeRerollRequestPending)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return false;
        }

        return !realtimeScheduler.IsGameRunning;
    }

    public void RequestRealtimeTicketReroll()
    {
        if (!useRealtimeBackend)
        {
            return;
        }

        BindRealtimeClient();
        if (!CanRequestRealtimeTicketReroll())
        {
            if (realtimeScheduler.IsGameRunning)
            {
                Debug.LogWarning("[APIManager] Kan ikke bytte bonger mens runden kjører.");
            }
            else if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
            {
                JoinOrCreateRoom();
            }
            return;
        }

        realtimeRerollRequestPending = true;
        int ticketsPerPlayer = Mathf.Clamp(realtimeTicketsPerPlayer, 1, 5);
        realtimeClient.RerollTickets(activeRoomCode, activePlayerId, ticketsPerPlayer, (ack) =>
        {
            realtimeRerollRequestPending = false;
            if (ack == null)
            {
                Debug.LogError("[APIManager] ticket:reroll feilet uten ack.");
                return;
            }

            if (!ack.ok)
            {
                if (RealtimeRoomStateUtils.IsRoomNotFound(ack))
                {
                    ResetActiveRoomState(clearDesiredRoomCode: true);
                    JoinOrCreateRoom();
                    return;
                }

                if (string.Equals(ack.errorCode, "ROUND_ALREADY_RUNNING", StringComparison.OrdinalIgnoreCase))
                {
                    RequestRealtimeState();
                    return;
                }

                Debug.LogError($"[APIManager] ticket:reroll failed: {ack.errorCode} {ack.errorMessage}");
                return;
            }

            JSONNode snapshot = ack.data?["snapshot"];
            if (snapshot != null && !snapshot.IsNull)
            {
                HandleRealtimeRoomUpdate(snapshot);
            }
            else
            {
                RequestRealtimeState();
            }
        });
    }

    public void PlayRealtimeRound()
    {
        if (!useRealtimeBackend)
        {
            return;
        }

        if (pendingRealtimeBetArmRequest && realtimeBetArmAwaitingAck)
        {
            return;
        }

        if (treatBetArmAsUnsupported)
        {
            if (IsActivePlayerHost())
            {
                StartRealtimeGameFromPlayButton();
            }
            else
            {
                RequestRealtimeState();
            }
            return;
        }

        LogRealtimeLifecycleEvent(
            "play_realtime_round_requested",
            $"roomCode={activeRoomCode} playerId={activePlayerId} tokenPresent={!string.IsNullOrWhiteSpace(accessToken)}");
        pendingRealtimeBetArmRequest = true;
        SyncRealtimeEntryFeeWithCurrentBet();
        PushRealtimeRoomConfiguration();
        TrySendPendingRealtimeBetArm();
    }

    public void StartRealtimeRoundNow()
    {
        if (!useRealtimeBackend)
        {
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null)
        {
            ReportMissingRuntimeDependency(
                "BingoRealtimeClient",
                "Kan ikke starte runde uten realtime-klient.");
            return;
        }

        SyncRealtimeEntryFeeWithCurrentBet();
        PushRealtimeRoomConfiguration();

        if (!realtimeClient.IsReady)
        {
            realtimeClient.Connect();
            return;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            JoinOrCreateRoom();
            return;
        }

        if (!IsActivePlayerHost())
        {
            Debug.LogWarning("[APIManager] Start naa krever host/admin i aktivt rom.");
            return;
        }

        StartRealtimeGameFromPlayButton();
    }

    private void TrySendPendingRealtimeBetArm()
    {
        if (!pendingRealtimeBetArmRequest)
        {
            return;
        }

        if (realtimeBetArmAwaitingAck)
        {
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null)
        {
            ReportMissingRuntimeDependency(
                "BingoRealtimeClient",
                "Kan ikke armere bet uten realtime-klient.");
            return;
        }

        string desiredAccessToken = (accessToken ?? string.Empty).Trim();
        string desiredHallId = (hallId ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(desiredAccessToken) || string.IsNullOrWhiteSpace(desiredHallId))
        {
            RequestRealtimeState();
            return;
        }

        if (!realtimeClient.IsReady)
        {
            realtimeClient.Connect();
            return;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            JoinOrCreateRoom();
            return;
        }

        if (realtimeBetArmedForNextRound)
        {
            pendingRealtimeBetArmRequest = false;
            return;
        }

        if (treatBetArmAsUnsupported)
        {
            pendingRealtimeBetArmRequest = false;
            if (IsActivePlayerHost())
            {
                StartRealtimeGameFromPlayButton();
            }
            return;
        }

        LogRealtimeLifecycleEvent(
            "bet_arm_request",
            $"roomCode={activeRoomCode} playerId={activePlayerId} entryFee={realtimeEntryFee}");
        realtimeBetArmAwaitingAck = true;
        realtimeBetArmRequestedAt = Time.unscaledTime;
        realtimeClient.ArmBet(activeRoomCode, activePlayerId, true, (ack) =>
        {
            realtimeBetArmAwaitingAck = false;
            realtimeBetArmRequestedAt = -1f;
            if (ack == null)
            {
                pendingRealtimeBetArmRequest = false;
                Debug.LogError("[APIManager] bet:arm feilet uten ack.");
                TryFallbackArmBetViaHttp("socket_ack_null");
                return;
            }

            if (!ack.ok)
            {
                pendingRealtimeBetArmRequest = false;
                if (RealtimeRoomStateUtils.IsRoomNotFound(ack))
                {
                    ResetActiveRoomState(clearDesiredRoomCode: true);
                    JoinOrCreateRoom();
                    return;
                }

                Debug.LogError($"[APIManager] bet:arm failed: {ack.errorCode} {ack.errorMessage}");
                TryFallbackArmBetViaHttp($"socket_ack_error:{ack.errorCode}");
                return;
            }

            pendingRealtimeBetArmRequest = false;
            treatBetArmAsUnsupported = false;
            realtimeBetArmedForNextRound = true;
            LogRealtimeLifecycleEvent("bet_arm_ack_ok", $"roomCode={activeRoomCode} playerId={activePlayerId}");
            JSONNode snapshot = ack.data?["snapshot"];
            if (snapshot != null && !snapshot.IsNull)
            {
                HandleRealtimeRoomUpdate(snapshot);
            }
        });
    }

    private void TickRealtimeBetArmTimeout()
    {
        if (!pendingRealtimeBetArmRequest || !realtimeBetArmAwaitingAck)
        {
            return;
        }

        float timeout = Mathf.Max(0.25f, betArmAckTimeoutSeconds);
        if (Time.unscaledTime < realtimeBetArmRequestedAt + timeout)
        {
            return;
        }

        realtimeBetArmAwaitingAck = false;
        realtimeBetArmRequestedAt = -1f;
        pendingRealtimeBetArmRequest = false;
        treatBetArmAsUnsupported = true;
        Debug.LogWarning("[APIManager] bet:arm ack-timeout. Faller tilbake til direkte game:start.");
        TryFallbackArmBetViaHttp("socket_ack_timeout");

        if (realtimeScheduler.IsGameRunning)
        {
            return;
        }

        if (IsActivePlayerHost())
        {
            StartRealtimeGameFromPlayButton();
            return;
        }

        RequestRealtimeState();
    }

    private void TryFallbackArmBetViaHttp(string reason)
    {
        if (!enableHttpBetArmFallback)
        {
            return;
        }

        if (!useRealtimeBackend)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) ||
            string.IsNullOrWhiteSpace(activePlayerId) ||
            string.IsNullOrWhiteSpace(accessToken))
        {
            return;
        }

        if (realtimeBetArmHttpFallbackInFlight)
        {
            return;
        }

        if (Time.unscaledTime < nextRealtimeBetArmHttpFallbackAt)
        {
            return;
        }

        nextRealtimeBetArmHttpFallbackAt = Time.unscaledTime + Mathf.Max(0.25f, betArmHttpFallbackCooldownSeconds);
        StartCoroutine(ArmBetViaHttpFallbackRoutine(reason));
    }

    private IEnumerator ArmBetViaHttpFallbackRoutine(string reason)
    {
        realtimeBetArmHttpFallbackInFlight = true;

        string normalizedBaseUrl = NormalizeRealtimeBackendBaseUrl(realtimeBackendBaseUrl);
        string roomCodeUpper = (activeRoomCode ?? string.Empty).Trim().ToUpperInvariant();
        string escapedRoomCode = UnityWebRequest.EscapeURL(roomCodeUpper);
        string[] candidateEndpoints =
        {
            $"{normalizedBaseUrl}/api/rooms/{escapedRoomCode}/bet-arm",
            $"{normalizedBaseUrl}/api/admin/rooms/{escapedRoomCode}/bet-arm"
        };

        JSONNode root = null;
        bool success = false;
        long lastResponseCode = 0;
        string lastError = string.Empty;
        bool lastEndpointNotFound = false;
        string usedEndpoint = string.Empty;

        for (int endpointIndex = 0; endpointIndex < candidateEndpoints.Length; endpointIndex += 1)
        {
            string endpoint = candidateEndpoints[endpointIndex];
            JSONObject payload = new();
            payload["actorPlayerId"] = activePlayerId ?? string.Empty;
            payload["playerId"] = activePlayerId ?? string.Empty;
            payload["armed"] = true;

            using (UnityWebRequest request = new UnityWebRequest(endpoint, UnityWebRequest.kHttpVerbPOST))
            {
                byte[] body = Encoding.UTF8.GetBytes(payload.ToString());
                request.uploadHandler = new UploadHandlerRaw(body);
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                request.SetRequestHeader("Authorization", "Bearer " + accessToken.Trim());

                yield return request.SendWebRequest();

                lastResponseCode = request.responseCode;
                lastError = request.error ?? string.Empty;
                string bodyText = request.downloadHandler != null ? request.downloadHandler.text : string.Empty;
                root = SafeParseRealtimeFallbackJson(bodyText);

                bool endpointNotFound =
                    request.result != UnityWebRequest.Result.Success &&
                    request.responseCode == 404;
                lastEndpointNotFound = endpointNotFound;

                if (request.result != UnityWebRequest.Result.Success)
                {
                    if (endpointNotFound && endpointIndex + 1 < candidateEndpoints.Length)
                    {
                        continue;
                    }

                    break;
                }

                bool ok = root != null && !root.IsNull && (root["ok"] == null || root["ok"].AsBool);
                if (!ok)
                {
                    // Ugyldig JSON eller eksplisitt API-feil: avbryt fallback-flyten.
                    break;
                }

                success = true;
                usedEndpoint = endpoint;
                break;
            }
        }

        realtimeBetArmHttpFallbackInFlight = false;
        if (!success)
        {
            if (root == null || root.IsNull)
            {
                if (lastEndpointNotFound)
                {
                    Debug.LogError(
                        $"[APIManager] HTTP bet-arm fallback fant ingen kompatibel endpoint ({reason}). Siste status={lastResponseCode} error={lastError}");
                }
                else
                {
                    Debug.LogError($"[APIManager] HTTP bet-arm fallback returnerte ugyldig JSON ({reason}).");
                }
            }
            else
            {
                string code = root["error"]?["code"];
                string message = root["error"]?["message"];
                Debug.LogError($"[APIManager] HTTP bet-arm fallback failed ({reason}): {code} {message}");
            }
            yield break;
        }

        pendingRealtimeBetArmRequest = false;
        realtimeBetArmAwaitingAck = false;
        realtimeBetArmRequestedAt = -1f;
        realtimeBetArmedForNextRound = true;
        Debug.Log($"[APIManager] HTTP bet-arm fallback ok via {usedEndpoint}");

        JSONNode snapshotNode = root["data"]?["snapshot"];
        if (snapshotNode != null && !snapshotNode.IsNull)
        {
            HandleRealtimeRoomUpdate(snapshotNode);
        }
        else
        {
            RequestRealtimeState();
        }
    }

    private static JSONNode SafeParseRealtimeFallbackJson(string bodyText)
    {
        if (string.IsNullOrWhiteSpace(bodyText))
        {
            return null;
        }

        try
        {
            return JSON.Parse(bodyText);
        }
        catch
        {
            return null;
        }
    }

    private void RequestRealtimeStateForScheduledPlay()
    {
        if (!scheduledModeManualStartFallback)
        {
            RequestRealtimeState();
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null || !realtimeClient.IsReady)
        {
            RequestRealtimeState();
            return;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            RequestRealtimeState();
            return;
        }

        realtimeClient.RequestRoomState(activeRoomCode, HandleScheduledPlayRoomStateAck);
    }

    private void HandleScheduledPlayRoomStateAck(SocketAck ack)
    {
        if (ack == null || !ack.ok)
        {
            if (RealtimeRoomStateUtils.IsRoomNotFound(ack))
            {
                Debug.LogWarning("[APIManager] Scheduled play: room finnes ikke lenger. Oppretter nytt rom.");
                ResetActiveRoomState(clearDesiredRoomCode: true);
                JoinOrCreateRoom();
                return;
            }

            Debug.LogError($"[APIManager] Scheduled play: room:state failed: {ack?.errorCode} {ack?.errorMessage}");
            return;
        }

        JSONNode snapshot = ack.data?["snapshot"];
        if (snapshot == null || snapshot.IsNull)
        {
            return;
        }

        HandleRealtimeRoomUpdate(snapshot);

        JSONNode currentGame = snapshot["currentGame"];
        bool isRunning = currentGame != null &&
                         !currentGame.IsNull &&
                         string.Equals(currentGame["status"], "RUNNING", StringComparison.OrdinalIgnoreCase);
        if (isRunning)
        {
            return;
        }

        TryStartRealtimeRoundFromSchedulerFallback(
            allowManualWhenSchedulerDisabled: true,
            source: "scheduled-play-state");
    }

    private void HandlePlayRoomStateAck(SocketAck ack)
    {
        if (ack == null || !ack.ok)
        {
            if (RealtimeRoomStateUtils.IsRoomNotFound(ack))
            {
                Debug.LogWarning("[APIManager] Play: room finnes ikke lenger. Oppretter nytt rom.");
                ResetActiveRoomState(clearDesiredRoomCode: true);
                JoinOrCreateRoom();
                return;
            }

            Debug.LogError($"[APIManager] Play: room:state failed: {ack?.errorCode} {ack?.errorMessage}");
            return;
        }

        JSONNode snapshot = ack.data?["snapshot"];
        if (snapshot != null && !snapshot.IsNull)
        {
            HandleRealtimeRoomUpdate(snapshot);
        }

        JSONNode currentGame = snapshot?["currentGame"];
        bool isRunning = currentGame != null &&
                         !currentGame.IsNull &&
                         string.Equals(currentGame["status"], "RUNNING", StringComparison.OrdinalIgnoreCase);

        if (!isRunning)
        {
            StartRealtimeGameFromPlayButton();
            return;
        }

        DrawRealtimeNumberFromPlayButton();
    }

    private void StartRealtimeGameFromPlayButton()
    {
        if (realtimeClient == null || !realtimeClient.IsReady)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return;
        }

        if (!ValidatePatternConfigurationForRealtime())
        {
            return;
        }

        int ticketsPerPlayer = Mathf.Clamp(realtimeTicketsPerPlayer, 1, 5);
        int entryFee = Mathf.Max(0, realtimeEntryFee);

        realtimeClient.StartGame(activeRoomCode, activePlayerId, entryFee, ticketsPerPlayer, (startAck) =>
        {
            if (startAck == null || !startAck.ok)
            {
                if (string.Equals(startAck?.errorCode, "GAME_ALREADY_RUNNING", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(startAck?.errorCode, "ROUND_START_TOO_SOON", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(startAck?.errorCode, "PLAYER_ALREADY_IN_RUNNING_GAME", StringComparison.OrdinalIgnoreCase))
                {
                    Debug.Log($"[APIManager] game:start skipped ({startAck?.errorCode}).");
                    return;
                }

                if (string.Equals(startAck?.errorCode, "NOT_ENOUGH_PLAYERS", StringComparison.OrdinalIgnoreCase))
                {
                    string serverMessage = string.IsNullOrWhiteSpace(startAck?.errorMessage)
                        ? "Trenger flere spillere i rommet."
                        : startAck.errorMessage;
                    Debug.LogWarning("[APIManager] Kan ikke starte runde: " + serverMessage);
                    return;
                }

                if (TryRecoverFromInsufficientFundsStartFailure(startAck))
                {
                    return;
                }

                Debug.LogError($"[APIManager] game:start failed: {startAck?.errorCode} {startAck?.errorMessage}");
                return;
            }

            JSONNode snapshot = startAck.data?["snapshot"];
            if (snapshot != null && !snapshot.IsNull)
            {
                HandleRealtimeRoomUpdate(snapshot);
            }

            if (drawImmediatelyAfterManualStart)
            {
                DrawRealtimeNumberFromPlayButton();
            }
        });
    }

    private bool TryRecoverFromInsufficientFundsStartFailure(SocketAck startAck)
    {
        if (!string.Equals(startAck?.errorCode, "INSUFFICIENT_FUNDS", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        float retryDelaySeconds = Mathf.Max(1f, insufficientFundsRetryDelaySeconds);
        nextScheduledManualStartAttemptAt = Time.unscaledTime + retryDelaySeconds;

        if (!fallbackToZeroEntryFeeOnInsufficientFunds || realtimeEntryFee <= 0)
        {
            LogInsufficientFundsWarning(startAck?.errorMessage, usedZeroEntryFeeFallback: false);
            return true;
        }

        if (hasAppliedZeroEntryFeeFallbackForRoom)
        {
            LogInsufficientFundsWarning(startAck?.errorMessage, usedZeroEntryFeeFallback: false);
            return true;
        }

        int previousEntryFee = realtimeEntryFee;
        hasAppliedZeroEntryFeeFallbackForRoom = true;
        realtimeEntryFee = 0;
        if (disableEntryFeeSyncAfterInsufficientFundsFallback)
        {
            syncRealtimeEntryFeeWithBetSelector = false;
        }

        LogInsufficientFundsWarning(startAck?.errorMessage, usedZeroEntryFeeFallback: true);
        PushRealtimeRoomConfiguration();
        Debug.LogWarning(
            $"[APIManager] game:start fikk INSUFFICIENT_FUNDS. " +
            $"Setter entryFee {previousEntryFee} -> 0 for dette rommet og prover igjen.");

        nextScheduledManualStartAttemptAt = Time.unscaledTime + 0.35f;
        StartRealtimeGameFromPlayButton();
        return true;
    }

    private void LogInsufficientFundsWarning(string serverMessage, bool usedZeroEntryFeeFallback)
    {
        if (Time.unscaledTime < nextInsufficientFundsWarningAt)
        {
            return;
        }

        nextInsufficientFundsWarningAt = Time.unscaledTime + 6f;
        string resolvedMessage = string.IsNullOrWhiteSpace(serverMessage)
            ? "Spilleren har ikke nok saldo til buy-in."
            : serverMessage;
        string fallbackMessage = usedZeroEntryFeeFallback
            ? "Prover med entryFee=0."
            : "Top-up wallet eller sett entryFee=0 i realtime-oppsett.";
        Debug.LogWarning($"[APIManager] INSUFFICIENT_FUNDS: {resolvedMessage} {fallbackMessage}");
    }

    private void DrawRealtimeNumberFromPlayButton()
    {
        if (realtimeClient == null || !realtimeClient.IsReady)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return;
        }

        int drawCountCap = ResolveRealtimeDrawCountCap();
        if (processedDrawCount >= drawCountCap)
        {
            Debug.LogWarning($"[APIManager] Hopper over draw: runden har naadd draw-cap ({drawCountCap}).");
            RequestRealtimeState();
            return;
        }

        realtimeClient.DrawNext(activeRoomCode, activePlayerId, (drawAck) =>
        {
            if (drawAck == null || !drawAck.ok)
            {
                Debug.LogError($"[APIManager] draw:next failed: {drawAck?.errorCode} {drawAck?.errorMessage}");
                return;
            }

            JSONNode snapshot = drawAck.data?["snapshot"];
            if (snapshot != null && !snapshot.IsNull)
            {
                HandleRealtimeRoomUpdate(snapshot);
            }
        });
    }

    private void HandleResumeAck(SocketAck ack)
    {
        if (ack == null || !ack.ok)
        {
            Debug.LogError($"[APIManager] room:resume failed: {ack?.errorCode} {ack?.errorMessage}");
            LogRealtimeLifecycleEvent(
                "room_resume_failed",
                $"code={ack?.errorCode} message={ack?.errorMessage}");
            if (RealtimeRoomStateUtils.IsRoomNotFound(ack))
            {
                ResetActiveRoomState(clearDesiredRoomCode: true);
            }
            else
            {
                activePlayerId = string.Empty;
            }
            if (joinOrCreateOnStart)
            {
                JoinOrCreateRoom();
            }
            return;
        }

        LogRealtimeLifecycleEvent("room_resume_ack", $"roomCode={activeRoomCode} playerId={activePlayerId}");
        if (realtimeScheduledRounds)
        {
            SyncRealtimeEntryFeeWithCurrentBet();
            PushRealtimeRoomConfiguration();
        }

        JSONNode snapshot = ack.data?["snapshot"];
        if (snapshot != null && !snapshot.IsNull)
        {
            HandleRealtimeRoomUpdate(snapshot);
            return;
        }

        realtimeClient.RequestRoomState(activeRoomCode, (stateAck) =>
        {
            if (stateAck == null || !stateAck.ok)
            {
                if (RealtimeRoomStateUtils.IsRoomNotFound(stateAck))
                {
                    Debug.LogWarning("[APIManager] room:state after resume feilet med ROOM_NOT_FOUND. Oppretter nytt rom.");
                    ResetActiveRoomState(clearDesiredRoomCode: true);
                    if (joinOrCreateOnStart)
                    {
                        JoinOrCreateRoom();
                    }
                    return;
                }
                Debug.LogError($"[APIManager] room:state after resume failed: {stateAck?.errorCode} {stateAck?.errorMessage}");
                return;
            }

            JSONNode stateSnapshot = stateAck.data?["snapshot"];
            if (stateSnapshot != null && !stateSnapshot.IsNull)
            {
                HandleRealtimeRoomUpdate(stateSnapshot);
            }
        });
    }

    public void ClaimLine()
    {
        if (!CanSendClaim())
        {
            return;
        }

        realtimeClient.SubmitClaim(activeRoomCode, activePlayerId, "LINE", HandleClaimAck);
    }

    public void ClaimBingo()
    {
        if (!CanSendClaim())
        {
            return;
        }

        realtimeClient.SubmitClaim(activeRoomCode, activePlayerId, "BINGO", HandleClaimAck);
    }

    private bool CanSendClaim(bool logWarnings = true)
    {
        if (!useRealtimeBackend || realtimeClient == null || !realtimeClient.IsReady)
        {
            if (logWarnings)
            {
                Debug.LogWarning("[APIManager] Realtime client not ready for claim.");
            }
            return false;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            if (logWarnings)
            {
                Debug.LogWarning("[APIManager] Missing room/player for claim.");
            }
            return false;
        }

        return true;
    }

    private void HandleClaimAck(SocketAck ack)
    {
        if (ack == null)
        {
            return;
        }

        if (!ack.ok)
        {
            Debug.LogError($"[APIManager] claim failed: {ack.errorCode} {ack.errorMessage}");
            return;
        }

        JSONNode snapshot = ack.data?["snapshot"];
        if (snapshot != null && !snapshot.IsNull)
        {
            HandleRealtimeRoomUpdate(snapshot);
        }
    }
}
