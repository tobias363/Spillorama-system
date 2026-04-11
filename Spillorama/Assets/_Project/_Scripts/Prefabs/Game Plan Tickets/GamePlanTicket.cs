using System;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class GamePlanTicket : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Texts")]
    [SerializeField] private TextMeshProUGUI txtGameNumber;
    [SerializeField] private TextMeshProUGUI txtGameName;
    [SerializeField] private TextMeshProUGUI txtGameStartTime;
    [SerializeField] private TextMeshProUGUI txtRemainingTime;

    [Header("Buttons")]
    [SerializeField] private Button btnBuy;
    [SerializeField] private Button btnCancel;
    [SerializeField] private Button btnPlay;

    [Header("Data")]
    [SerializeField] private GamePlanRoomData gamePlanRoomData = null;

    private DateTime gameStartedTime;
    private TimeSpan differenceTime;
    private bool gameActive = false;
    #endregion

    #region UNITY_CALLBACKS
    private void Update()
    {
        if (gamePlanRoomData != null)
        {
            differenceTime = gameStartedTime - DateTime.Now;

            if (differenceTime.TotalSeconds > 0)
            {
                if (txtRemainingTime != null)
                    txtRemainingTime.text = ((int)differenceTime.TotalHours).ToString("00") + "h " + differenceTime.Minutes.ToString("00") + "m " + differenceTime.Seconds.ToString("00") + "s";
                gameActive = true;
            }
            else if (gameActive == true)
            {
                gameActive = false;
                if (UIManager.Instance.lobbyPanel.isActiveAndEnabled)
                    UIManager.Instance.lobbyPanel.gamePlanPanel.RefreshList();
                else if (UIManager.Instance.topBarPanel.miniGamePlanPanel.isActiveAndEnabled)
                    UIManager.Instance.topBarPanel.miniGamePlanPanel.RefreshList();
            }
            else
            {
                if (txtRemainingTime != null)
                    txtRemainingTime.text = "00h 00m 00s";
            }
        }
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void SetData(GamePlanRoomData gamePlanRoomData)
    {
        this.gamePlanRoomData = gamePlanRoomData;

        txtGameNumber.text = gamePlanRoomData.gameNumber;        
        try
        {
            gameStartedTime = Utility.Instance.GetDateTimeLocal(gamePlanRoomData.startingTime);
            txtGameStartTime.text = gameStartedTime.ToString("HH:mm:ss");
        }
        catch(Exception e)
        {
            Debug.LogError("GamePlanTicket.SetData(): " + e);
        }

        if (txtGameName)
            txtGameName.text = gamePlanRoomData.gameName;

        btnBuy.gameObject.SetActive(gamePlanRoomData.buyButton);
        btnCancel.gameObject.SetActive(gamePlanRoomData.cancelButton);
        btnPlay.gameObject.SetActive(gamePlanRoomData.playButton);
    }

    public GameData GetGameData()
    {
        return gamePlanRoomData;
    }
    //public void OnPlayButtonTap()
    //{
    //    UIManager.Instance.lobbyPanel.Close();
    //    UIManager.Instance.game3Panel.OpenGamePlayPanel(gamePlanRoomData);
    //}

    public void OnCancelButtonTap()
    {
        UIManager.Instance.messagePopup.DisplayConfirmationPopup(Constants.LanguageKey.CancelConfirmationMessage, (result) => {
            if (result)
            {
                // UIManager.Instance.DisplayLoader(true);
                EventManager.Instance.CancelGameTickets(gamePlanRoomData.namespaceString, gamePlanRoomData.gameId, CancelGameTicketsResponse);
            }
        });
    }

    //public void OnBuyButtonTap()
    //{
    //    UIManager.Instance.DisplayLoader(true);
    //    EventManager.Instance.GetGame3PurchaseData(gamePlanRoomData.gameId, GetGame3PurchaseDataResponse);
    //}
    #endregion

    #region PRIVATE_METHODS
    //private void GetGame3PurchaseDataResponse(Socket socket, Packet packet, object[] args)
    //{
    //    Debug.Log($"GetGame3PurchaseDataResponse: {packet}");
    //    UIManager.Instance.DisplayLoader(false);

    //    EventResponse<GetGame3PurchaseDataResponse> response = JsonUtility.FromJson<EventResponse<GetGame3PurchaseDataResponse>>(Utility.Instance.GetPacketString(packet));

    //    if (response.status == Constants.EventStatus.SUCCESS)
    //    {
    //        UIManager.Instance.game3Panel.OpenTicketPurchasePanel(gamePlanRoomData, response.result);
    //    }
    //    else
    //    {
    //        UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
    //    }
    //}

    private void CancelGameTicketsResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"CancelGameTicketsResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            if (UIManager.Instance.lobbyPanel.isActiveAndEnabled)
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.RefreshGamePlanList();                
            }            
            else if (UIManager.Instance.topBarPanel.miniGamePlanPanel.isActiveAndEnabled)
            {                
                if (UIManager.Instance.game1Panel.isActiveAndEnabled && UIManager.Instance.game1Panel.GameId == gamePlanRoomData.gameId)                
                    UIManager.Instance.topBarPanel.OnGamesButtonTap();                
                else if (UIManager.Instance.game2Panel.isActiveAndEnabled && UIManager.Instance.game2Panel.GameId == gamePlanRoomData.gameId)                
                    UIManager.Instance.topBarPanel.OnGamesButtonTap();                
                else if (UIManager.Instance.game3Panel.isActiveAndEnabled && UIManager.Instance.game3Panel.GameId == gamePlanRoomData.gameId)                
                    UIManager.Instance.topBarPanel.OnGamesButtonTap();

                UIManager.Instance.topBarPanel.miniGamePlanPanel.RefreshList();
            }

            if (Utility.Instance.IsStandAloneVersion())
            {
                if (UIManager.Instance.game1Panel.GameId == gamePlanRoomData.gameId)
                    UIManager.Instance.game1Panel.game1GamePlayPanel.ClosePanel();
                else if (UIManager.Instance.game2Panel.GameId == gamePlanRoomData.gameId)
                    UIManager.Instance.game2Panel.game2PlayPanel.ClosePanel();
                else if (UIManager.Instance.game3Panel.GameId == gamePlanRoomData.gameId)
                    UIManager.Instance.game3Panel.game3GamePlayPanel.ClosePanel();
            }

            BackgroundManager.Instance.PlayerUpdateIntervalCall();
        }

        UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
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
