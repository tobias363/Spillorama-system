using BestHTTP.SocketIO;
using UnityEngine;

public partial class Game1GamePlayPanel
{
    public void Reconnect()
    {
        UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
    }

    public void OnLuckeyNumberTap()
    {
        selectLuckyNumberPanel.Open();
    }

    internal void Close_Panels()
    {
        selectLuckyNumberPanel.Close();
        changeMarkerBackgroundPanel.Close();
    }

    public void OpenChangeMarkerBackgroundPanel()
    {
        changeMarkerBackgroundPanel.Open();
    }

    public void OnLuckyNumberSelection(int luckyNumber)
    {
        if (LuckyNumber == luckyNumber)
            return;

        int lastLuckyNumber = LuckyNumber;
        DisplayLoader(true);
        EventManager.Instance.SelectLuckyNumberGame1(
            gameData.namespaceString,
            gameData.gameId,
            luckyNumber,
            (socket, packet, args) =>
            {
                Debug.Log("SelectLuckyNumber response: " + packet.ToString());
                DisplayLoader(false);
                EventResponse eventResponse = JsonUtility.FromJson<EventResponse>(
                    Utility.Instance.GetPacketString(packet)
                );

                if (eventResponse.status == Constants.EventStatus.SUCCESS)
                {
                    LuckyNumber = luckyNumber;
                    HighlightLuckyNumber();
                }
                else
                {
                    LuckyNumber = lastLuckyNumber;
                    GetUtilityMessagePanel().DisplayMessagePopup(eventResponse.message);
                }
            }
        );
    }

    public void OpenWithdrawNumberHistoryPanel()
    {
        UIManager.Instance.withdrawNumberHistoryPanel.Open();
    }

    public UtilityMessagePanel GetUtilityMessagePanel()
    {
        if (
            loaderPanel
            && Utility.Instance.IsSplitScreenSupported
            && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1
        )
            return messagePopup;

        return UIManager.Instance.messagePopup;
    }

    public void DisplayLoader(bool showLoader)
    {
        if (
            loaderPanel
            && Utility.Instance.IsSplitScreenSupported
            && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1
        )
        {
            if (showLoader)
                loaderPanel.ShowLoader();
            else
            {
                loaderPanel.HideLoader();
                UIManager.Instance.DisplayLoader(false);
            }
        }
    }
}
