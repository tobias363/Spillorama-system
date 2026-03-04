using System;
using SimpleJSON;
using UnityEngine;

public sealed class RealtimeRoomConfigurator
{
    private bool hasWarnedForbidden;

    public void ResetWarningState()
    {
        hasWarnedForbidden = false;
    }

    public void PushRoomConfiguration(
        bool useRealtimeBackend,
        bool realtimeScheduledRounds,
        BingoRealtimeClient realtimeClient,
        string roomCode,
        string playerId,
        int entryFee,
        Action<JSONNode> onSnapshot)
    {
        if (!useRealtimeBackend || !realtimeScheduledRounds)
        {
            return;
        }

        if (realtimeClient == null || !realtimeClient.IsReady)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(roomCode) || string.IsNullOrWhiteSpace(playerId))
        {
            return;
        }

        JSONObject payload = new();
        payload["roomCode"] = roomCode;
        payload["playerId"] = playerId;
        payload["entryFee"] = Mathf.Max(0, entryFee);

        realtimeClient.EmitWithAck("room:configure", payload, (ack) =>
        {
            if (ack == null || !ack.ok)
            {
                if (!hasWarnedForbidden &&
                    string.Equals(ack?.errorCode, "FORBIDDEN", StringComparison.OrdinalIgnoreCase))
                {
                    hasWarnedForbidden = true;
                    Debug.LogWarning("[APIManager] room:configure ble avvist (FORBIDDEN).");
                }
                return;
            }

            JSONNode snapshot = ack.data?["snapshot"];
            if (snapshot != null && !snapshot.IsNull)
            {
                onSnapshot?.Invoke(snapshot);
            }
        });
    }
}
