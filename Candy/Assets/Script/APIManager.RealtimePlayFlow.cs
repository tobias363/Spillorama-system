using System;
using SimpleJSON;
using UnityEngine;

public partial class APIManager
{
    public void PlayRealtimeRound()
    {
        if (!useRealtimeBackend)
        {
            return;
        }

        if (realtimeScheduledRounds)
        {
            SyncRealtimeEntryFeeWithCurrentBet();
            PushRealtimeRoomConfiguration();
            RequestRealtimeStateForScheduledPlay();
            return;
        }

        if (!playButtonStartsAndDrawsRealtime)
        {
            RequestRealtimeState();
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null)
        {
            return;
        }

        string desiredAccessToken = (accessToken ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(desiredAccessToken))
        {
            RequestRealtimeState();
            return;
        }

        string desiredHallId = (hallId ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(desiredHallId))
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

        realtimeClient.RequestRoomState(activeRoomCode, HandlePlayRoomStateAck);
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

    private bool CanSendClaim()
    {
        if (!useRealtimeBackend || realtimeClient == null || !realtimeClient.IsReady)
        {
            Debug.LogWarning("[APIManager] Realtime client not ready for claim.");
            return false;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            Debug.LogWarning("[APIManager] Missing room/player for claim.");
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
