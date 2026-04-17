using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;

public class PrefabHallGameListButton : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Texts")]
    [SerializeField] private TextMeshProUGUI txtGameName;

    [Header("Data")]
    [SerializeField] private GamePlanRoomData gamePlanRoomData = null;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(GamePlanRoomData gamePlanRoomData)
    {
        this.gamePlanRoomData = gamePlanRoomData;
        txtGameName.text = gamePlanRoomData.gameName;
    }

    public void OnClickButton()
    {
        if (gamePlanRoomData.buyButton)
            OnBuyButtonTap();
        else if (gamePlanRoomData.playButton)
            OnPlayButtonTap();
    }

    public void OnBuyButtonTap()
    {
        //GameSocketManager.SetSocketGame1Namespace = gameData.namespaceString;
        //UIManager.Instance.DisplayLoader(true);
        //UIManager.Instance.lobbyPanel.Close();
        //UIManager.Instance.CloseAllSubPanels();
        //UIManager.Instance.game1Panel.OpenTicketPurchasePanel(gameData);

        GameSocketManager.SetSocketGame1Namespace = gamePlanRoomData.namespaceString;
        CallGame1PurchaseDataEvent();

        // UIManager.Instance.DisplayLoader(true);
    }

    public void OnPlayButtonTap()
    {
        GameSocketManager.SetSocketGame1Namespace = gamePlanRoomData.namespaceString;
        //UIManager.Instance.DisplayLoader(true);
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();

        if (Utility.Instance.IsSplitScreenSupported)
        {
            if (UIManager.Instance.splitScreenGameManager.game1Panel.isActiveAndEnabled)
                UIManager.Instance.splitScreenGameManager.game1Panel.Close();

            UIManager.Instance.splitScreenGameManager.OpenGamePlay1(gamePlanRoomData, gamePlanRoomData.gameId);
            //UIManager.Instance.splitScreenGameManager.game1Panel.Game_1_Data = 
            UIManager.Instance.game1Panel.Close();
        }
        else
        {
            UIManager.Instance.game1Panel.OpenGamePlayPanel(gamePlanRoomData);
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void CallGame1PurchaseDataEvent()
    {
        EventManager.Instance.GetGame1PurchaseData(gamePlanRoomData.gameId, Game1PurchaseDataResponse);
    }

    private void Game1PurchaseDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Game1PurchaseDataResponse: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        EventResponse<Game1PurchaseDataResponse> response = JsonUtility.FromJson<EventResponse<Game1PurchaseDataResponse>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            UIManager.Instance.lobbyPanel.Close();
            UIManager.Instance.CloseAllSubPanels();
            UIManager.Instance.game1Panel.OpenTicketPurchasePanel(gamePlanRoomData, response.result);
            UIManager.Instance.topBarPanel.hallGameListPanel.Close();

            if (Utility.Instance.IsSplitScreenSupported && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 0)
                UIManager.Instance.topBarPanel.RunningGamesButtonEnable = true;
        }
        else
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                string translationMessage = "";
                if (LocalizationManager.TryGetTranslation(response.message, out translationMessage))
                    UIManager.Instance.messagePopup.DisplayMessagePopup(translationMessage);
                else
                    UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
            else
            {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
#else
            string translationMessage = "";
            if (LocalizationManager.TryGetTranslation(response.message, out translationMessage))
                UIManager.Instance.messagePopup.DisplayMessagePopup(translationMessage);
            else
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
#endif
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public string GameId
    {
        get
        {
            return gamePlanRoomData.gameId;
        }
    }
    #endregion
}
