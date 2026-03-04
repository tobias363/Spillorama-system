using System;
using SimpleJSON;

public static class RealtimeRoomStateUtils
{
    public static bool IsRoomNotFound(SocketAck ack)
    {
        if (ack == null)
        {
            return false;
        }

        return string.Equals(ack.errorCode, "ROOM_NOT_FOUND", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsPlayerAlreadyInRunningGame(SocketAck ack)
    {
        if (ack == null)
        {
            return false;
        }

        return string.Equals(ack.errorCode, "PLAYER_ALREADY_IN_RUNNING_GAME", StringComparison.OrdinalIgnoreCase);
    }

    public static string ExtractRoomCodeFromAlreadyRunningMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return string.Empty;
        }

        int markerIndex = message.LastIndexOf("(rom ", StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0)
        {
            return string.Empty;
        }

        int codeStart = markerIndex + "(rom ".Length;
        int codeEnd = message.IndexOf(')', codeStart);
        if (codeEnd <= codeStart)
        {
            return string.Empty;
        }

        return message.Substring(codeStart, codeEnd - codeStart).Trim().ToUpperInvariant();
    }

    public static string ResolvePlayerIdFromSnapshot(JSONNode snapshot, string walletId, string playerName)
    {
        JSONNode players = snapshot?["players"];
        if (players == null || players.IsNull || !players.IsArray || players.Count == 0)
        {
            return string.Empty;
        }

        string desiredWalletId = (walletId ?? string.Empty).Trim();
        string desiredPlayerName = (playerName ?? string.Empty).Trim();
        string fallbackByName = string.Empty;

        for (int i = 0; i < players.Count; i++)
        {
            JSONNode player = players[i];
            if (player == null || player.IsNull)
            {
                continue;
            }

            string candidateId = player["id"];
            if (string.IsNullOrWhiteSpace(candidateId))
            {
                continue;
            }

            string candidateWalletId = player["walletId"];
            if (!string.IsNullOrWhiteSpace(desiredWalletId) &&
                string.Equals(candidateWalletId, desiredWalletId, StringComparison.Ordinal))
            {
                return candidateId.Trim();
            }

            string candidateName = player["name"];
            if (string.IsNullOrWhiteSpace(fallbackByName) &&
                !string.IsNullOrWhiteSpace(desiredPlayerName) &&
                string.Equals(candidateName, desiredPlayerName, StringComparison.OrdinalIgnoreCase))
            {
                fallbackByName = candidateId.Trim();
            }
        }

        if (!string.IsNullOrWhiteSpace(fallbackByName))
        {
            return fallbackByName;
        }

        if (players.Count == 1)
        {
            string onlyPlayerId = players[0]?["id"];
            return string.IsNullOrWhiteSpace(onlyPlayerId) ? string.Empty : onlyPlayerId.Trim();
        }

        return string.Empty;
    }
}
