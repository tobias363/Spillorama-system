using BestHTTP.SocketIO;
using I2.Loc;
using UnityEngine;

public partial class Game1GamePlayPanel
{
    private void CallWheelOfFortuneEvent(BingoGame1History gameHistory = null, bool isForceShow = false)
    {
        if (isForceShow)
        {
            if (gameHistory.minigameData.isDisplayWheel)
            {
                EventManager.Instance.WheelOfFortuneData(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    WheelOfFortuneDataResponse
                );
            }
        }
        else
        {
            EventManager.Instance.WheelOfFortuneData(
                GameSocketManager.SocketGame1,
                gameData.gameId,
                WheelOfFortuneDataResponse
            );
        }
    }

    private void WheelOfFortuneDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("WheelOfFortuneDataResponse :" + packet.ToString());
        DisplayLoader(false);

        EventResponse<WheelOfFortuneData> response = JsonUtility.FromJson<EventResponse<WheelOfFortuneData>>(
            Utility.Instance.GetPacketString(packet)
        );
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (UIManager.Instance.isGameWebGL)
            {
                newFortuneWheelManager.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    10,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    LocalizationManager.GetTranslation("Game 1")
                );
            }
            else
            {
                newFortuneWheelManager.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    10,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    "Game 1"
                );
            }
#else
            newFortuneWheelManager.Open(
                GameSocketManager.SocketGame1,
                gameData.gameId,
                response.result,
                10,
                UIManager.Instance.game1Panel.BackgroundSprite,
                LocalizationManager.GetTranslation("Game 1")
            );
#endif
        }
        else
        {
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
        }
    }

    private void CallTreasureChestEvent()
    {
        DisplayLoader(true);
        EventManager.Instance.TreasureChestData(
            GameSocketManager.SocketGame1,
            gameData.gameId,
            TreasureChestDataResponse
        );
    }

    private void TreasureChestDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("TreasureChestDataResponse :" + packet.ToString());
        DisplayLoader(false);

        EventResponse<TreasureChestData> response = JsonUtility.FromJson<EventResponse<TreasureChestData>>(
            Utility.Instance.GetPacketString(packet)
        );
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                treasureChestPanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    10,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    LocalizationManager.GetTranslation("Game 1")
                );
            }
            else
            {
                treasureChestPanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    10,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    "Game 1"
                );
            }
#else
            treasureChestPanel.Open(
                GameSocketManager.SocketGame1,
                gameData.gameId,
                response.result,
                10,
                UIManager.Instance.game1Panel.BackgroundSprite,
                LocalizationManager.GetTranslation("Game 1")
            );
#endif
        }
        else
        {
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
        }
    }

    private void CallMysteryGameEvent()
    {
        DisplayLoader(true);
        EventManager.Instance.MysteryGameData(
            GameSocketManager.SocketGame1,
            gameData.gameId,
            MysteryGameDataResponse,
            "Real"
        );
    }

    private void MysteryGameDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("MysteryGameDataResponse :" + packet.ToString());
        DisplayLoader(false);

        EventResponse<MysteryGameData> response = JsonUtility.FromJson<EventResponse<MysteryGameData>>(
            Utility.Instance.GetPacketString(packet)
        );
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                mysteryGamePanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    response.result.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    LocalizationManager.GetTranslation("Game 1"),
                    "Game 1"
                );
            }
            else
            {
                mysteryGamePanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    response.result.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    "Game 1",
                    "Game 1"
                );
            }
#else
            mysteryGamePanel.Open(
                GameSocketManager.SocketGame1,
                gameData.gameId,
                response.result,
                UIManager.Instance.game1Panel.BackgroundSprite,
                response.result.isGamePaused,
                BingoGame1HistoryData.pauseGameMessage,
                LocalizationManager.GetTranslation("Game 1"),
                "Game 1"
            );
#endif
        }
        else
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
    }

    private void CallColorDraftGameEvent()
    {
        DisplayLoader(true);
        EventManager.Instance.ColorDraftGameData(
            GameSocketManager.SocketGame1,
            gameData.gameId,
            ColorDraftGameDataResponse,
            "Real"
        );
    }

    private void ColorDraftGameDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("ColorDraftGameDataResponse :" + packet.ToString());
        DisplayLoader(false);

        EventResponse<ColorDraftGameData> response = JsonUtility.FromJson<EventResponse<ColorDraftGameData>>(
            Utility.Instance.GetPacketString(packet)
        );
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                colorDraftGamePanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    response.result.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    LocalizationManager.GetTranslation("Game 1")
                );
            }
            else
            {
                colorDraftGamePanel.Open(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    response.result,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    response.result.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    "Game 1"
                );
            }
#else
            colorDraftGamePanel.Open(
                GameSocketManager.SocketGame1,
                gameData.gameId,
                response.result,
                UIManager.Instance.game1Panel.BackgroundSprite,
                response.result.isGamePaused,
                BingoGame1HistoryData.pauseGameMessage,
                LocalizationManager.GetTranslation("Game 1")
            );
#endif
        }
        else
        {
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
        }
    }

    private void CloseMiniGames()
    {
        fortuneWheelManager.Close();
        newFortuneWheelManager.Close();
        treasureChestPanel.Close();
        mysteryGamePanel.Close();
        colorDraftGamePanel.Close();
    }
}
