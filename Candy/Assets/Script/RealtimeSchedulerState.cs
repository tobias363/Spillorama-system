using System;
using SimpleJSON;

public sealed class RealtimeSchedulerState
{
    private const string IdleStatus = "NONE";

    public long NextScheduledRoundStartAtMs { get; private set; }
    public string LatestGameStatus { get; private set; } = IdleStatus;
    public bool SchedulerEnabled { get; private set; } = true;
    public bool CanStartNow { get; private set; }
    public int MinPlayers { get; private set; } = 1;
    public int PlayerCount { get; private set; }
    public int DrawCapacity { get; private set; } = 30;
    public bool IsGameRunning =>
        string.Equals(LatestGameStatus, "RUNNING", StringComparison.OrdinalIgnoreCase);

    public void Reset()
    {
        NextScheduledRoundStartAtMs = 0;
        LatestGameStatus = IdleStatus;
        SchedulerEnabled = true;
        CanStartNow = false;
        MinPlayers = 1;
        PlayerCount = 0;
        DrawCapacity = 30;
    }

    public void ApplySchedulerSnapshot(JSONNode snapshot)
    {
        NextScheduledRoundStartAtMs = 0;
        SchedulerEnabled = true;
        CanStartNow = false;
        MinPlayers = 1;
        PlayerCount = 0;
        DrawCapacity = 30;

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
        CanStartNow = scheduler["canStartNow"].AsBool;
        MinPlayers = Math.Max(1, scheduler["minPlayers"].AsInt);
        PlayerCount = Math.Max(PlayerCount, scheduler["playerCount"].AsInt);
        DrawCapacity = Math.Max(1, scheduler["drawCapacity"].AsInt > 0 ? scheduler["drawCapacity"].AsInt : DrawCapacity);

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
        if (IsGameRunning)
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

    public bool ShouldAttemptClientStart(long nowMs)
    {
        if (IsGameRunning)
        {
            return false;
        }

        if (PlayerCount < MinPlayers)
        {
            return false;
        }

        if (!SchedulerEnabled)
        {
            return true;
        }

        if (CanStartNow)
        {
            return true;
        }

        return NextScheduledRoundStartAtMs > 0 && nowMs >= NextScheduledRoundStartAtMs;
    }

    public bool ShouldSyncAroundBoundary(long nowMs, long leadTimeMs = 1200)
    {
        if (IsGameRunning || !SchedulerEnabled)
        {
            return false;
        }

        if (CanStartNow)
        {
            return true;
        }

        if (NextScheduledRoundStartAtMs <= 0)
        {
            return false;
        }

        long normalizedLeadTimeMs = Math.Max(250, leadTimeMs);
        return nowMs >= (NextScheduledRoundStartAtMs - normalizedLeadTimeMs);
    }

    public bool ShouldFallbackToManualStart()
    {
        return !SchedulerEnabled;
    }
}
