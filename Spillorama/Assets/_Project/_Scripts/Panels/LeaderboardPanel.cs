using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;

// ── Spillorama leaderboard response wrappers ─────────────────────────────────

[Serializable]
internal class SpilloramaLeaderboardAck
{
    public bool ok;
    public SpilloramaLeaderboardAckData data;
}

[Serializable]
internal class SpilloramaLeaderboardAckData
{
    public List<SpilloramaLeaderboardEntryRaw> leaderboard;
}

[Serializable]
internal class SpilloramaLeaderboardEntryRaw
{
    public string nickname = "";
    public double points = 0;
}

public class LeaderboardPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtRecordNotFound;

    [Header("Transform")]
    [SerializeField] private Transform transformLeaderboardContainer;

    [Header("Prefabs")]
    [SerializeField] private PrefabLeaderboardPlayerData prefabLeaderboardPlayerData;

    private List<PrefabLeaderboardPlayerData> leaderboardPlayerList = new List<PrefabLeaderboardPlayerData>();
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        Reset();
    }

    private void OnEnable()
    {
        if (UIManager.Instance != null && UIManager.Instance.isGameWebGL)
        {
            FetchLeaderboard_Spillorama();
            return;
        }
        EventManager.Instance.Leaderboard(LeaderboardResponse);
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
    }
    #endregion

    #region PRIVATE_METHODS
    private void LeaderboardResponse(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"LeaderBoardResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponseList<LeaderboardData> response = JsonUtility.FromJson<EventResponseList<LeaderboardData>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            Reset();
            txtRecordNotFound.gameObject.SetActive(response.result.Count == 0);

            foreach(LeaderboardData leaderboardData in response.result)
            {
                PrefabLeaderboardPlayerData leaderboardPlayer = Instantiate(prefabLeaderboardPlayerData, transformLeaderboardContainer);
                leaderboardPlayer.SetData(leaderboardData);
                leaderboardPlayerList.Add(leaderboardPlayer);
            }            
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private void FetchLeaderboard_Spillorama()
    {
        SpilloramaSocketManager.Instance?.FetchLeaderboard(
            onSuccess: (string raw) =>
            {
                Reset();
                try
                {
                    var ack = JsonUtility.FromJson<SpilloramaLeaderboardAck>(raw);
                    if (ack == null || !ack.ok || ack.data?.leaderboard == null)
                    {
                        txtRecordNotFound.gameObject.SetActive(true);
                        return;
                    }

                    txtRecordNotFound.gameObject.SetActive(ack.data.leaderboard.Count == 0);
                    foreach (var entry in ack.data.leaderboard)
                    {
                        var data = new LeaderboardData { nickname = entry.nickname, points = entry.points };
                        PrefabLeaderboardPlayerData leaderboardPlayer = Instantiate(prefabLeaderboardPlayerData, transformLeaderboardContainer);
                        leaderboardPlayer.SetData(data);
                        leaderboardPlayerList.Add(leaderboardPlayer);
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Leaderboard] Parse error: " + ex.Message);
                    txtRecordNotFound.gameObject.SetActive(true);
                }
            },
            onError: (string err) =>
            {
                Debug.LogWarning("[Leaderboard] Fetch error: " + err);
                Reset();
                txtRecordNotFound.gameObject.SetActive(true);
            }
        );
    }

    private void Reset()
    {
        txtRecordNotFound.Close();

        foreach (PrefabLeaderboardPlayerData player in leaderboardPlayerList)
        {
            Destroy(player.gameObject);
        }
        leaderboardPlayerList.Clear();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
