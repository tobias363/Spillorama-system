using System;
using SimpleJSON;

public sealed class RealtimeSchedulerState
{
    private const string IdleStatus = "NONE";

    public long NextScheduledRoundStartAtMs { get; private set; }
    public string LatestGameStatus { get; private set; } = IdleStatus;
    public bool SchedulerEnabled { get; private set; } = true;
    public int MinPlayers { get; private set; } = 1;
    public int PlayerCount { get; private set; }

    public void Reset()
    {
        NextScheduledRoundStartAtMs = 0;
        LatestGameStatus = IdleStatus;
        SchedulerEnabled = true;
        MinPlayers = 1;
        PlayerCount = 0;
    }

    public void ApplySchedulerSnapshot(JSONNode snapshot)
    {
        NextScheduledRoundStartAtMs = 0;
        SchedulerEnabled = true;
        MinPlayers = 1;
        PlayerCount = 0;

        if (snapshot == null || snapshot.IsNull)
        {
            return;
        }

        JSONNode players = snapshot["players"];
        if (players != null && players.IsArray)
        {
            PlayerCount = players.Count;
        }

        JSONNode scheduler = snapshot["scheduler"];
        if (scheduler == null || scheduler.IsNull)
        {
            return;
        }

        SchedulerEnabled = scheduler["enabled"].AsBool;
        MinPlayers = Math.Max(1, scheduler["minPlayers"].AsInt);
        PlayerCount = Math.Max(PlayerCount, scheduler["playerCount"].AsInt);

        string nextStartAtRaw = scheduler["nextStartAt"];
        if (!string.IsNullOrWhiteSpace(nextStartAtRaw) &&
            DateTimeOffset.TryParse(nextStartAtRaw, out DateTimeOffset parsed))
        {
            NextScheduledRoundStartAtMs = parsed.ToUnixTimeMilliseconds();
        }
    }

    public void SetCurrentGameStatus(string status)
    {
        LatestGameStatus = string.IsNullOrWhiteSpace(status) ? IdleStatus : status.Trim();
    }

    public string BuildCountdownLabel(long nowMs)
    {
        if (string.Equals(LatestGameStatus, "RUNNING", StringComparison.OrdinalIgnoreCase))
        {
            return "Spill pågår";
        }

        if (!SchedulerEnabled)
        {
            return "Autostart er av";
        }

        if (NextScheduledRoundStartAtMs <= 0)
        {
            return "Venter på neste runde";
        }

        long remainingMs = Math.Max(0, NextScheduledRoundStartAtMs - nowMs);
        int remainingSeconds = (int)Math.Ceiling(remainingMs / 1000d);
        int minutes = remainingSeconds / 60;
        int seconds = remainingSeconds % 60;

        if (PlayerCount < MinPlayers)
        {
            return $"Venter på spillere {PlayerCount}/{MinPlayers}\n{minutes:00}:{seconds:00}";
        }

        return $"Neste runde\n{minutes:00}:{seconds:00}";
    }

    public bool ShouldFallbackToManualStart()
    {
        return !SchedulerEnabled || PlayerCount < MinPlayers;
    }
}
