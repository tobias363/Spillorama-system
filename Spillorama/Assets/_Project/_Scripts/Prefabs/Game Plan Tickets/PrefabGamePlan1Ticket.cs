using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using I2.Loc;
using UnityEngine;

public class PrefabGamePlan1Ticket : GamePlanTicket
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBuyButtonTap()
    {
        GameSocketManager.SetSocketGame1Namespace = GetGameData().namespaceString;
        CallGame1PurchaseDataEvent();

        // UIManager.Instance.DisplayLoader(true);
        Invoke("CallGame1PurchaseDataEvent", 0.2f);

        //UIManager.Instance.DisplayLoader(true);
        //UIManager.Instance.lobbyPanel.Close();
        //UIManager.Instance.CloseAllSubPanels();
        //UIManager.Instance.game1Panel.OpenTicketPurchasePanel(GetGameData());        

        //if (IsAllowedToPlayInHall() == false)
        //{
        //    Debug.Log(LocalizationManager.GetTranslation("You are not allowed to play in this hall!"));
        //    UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("You are not allowed to play in this hall!"));
        //    return;
        //}                
    }    

    public void OnPlayButtonTap()
    {
        GameSocketManager.SetSocketGame1Namespace = GetGameData().namespaceString;
        //UIManager.Instance.DisplayLoader(true);
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();        

        if(Utility.Instance.IsSplitScreenSupported)
        {
            if (UIManager.Instance.splitScreenGameManager.game1Panel.isActiveAndEnabled)
                UIManager.Instance.splitScreenGameManager.game1Panel.Close();

            UIManager.Instance.splitScreenGameManager.OpenGamePlay1(GetGameData(), GetGameData().gameId);
            UIManager.Instance.game1Panel.Close();
        }
        else
        {
            UIManager.Instance.game1Panel.OpenGamePlayPanel(GetGameData(), GetGameData().gameId);
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void CallGame1PurchaseDataEvent()
    {
        //UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.GetGame1PurchaseData(GetGameData().gameId, Game1PurchaseDataResponse);
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
            UIManager.Instance.game1Panel.OpenTicketPurchasePanel(GetGameData(), response.result);
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
            if(LocalizationManager.TryGetTranslation(response.message, out translationMessage))
                UIManager.Instance.messagePopup.DisplayMessagePopup(translationMessage);
            else
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
#endif
        }
    }

    //private bool IsAllowedToPlayInHall()
    //{
    //    List<string> myCurrentHalls = UIManager.Instance.gameAssetData.HallList;
    //    List<string> hallListForPlay = GetGameData().halls;

    //    foreach(string hallName in myCurrentHalls)
    //    {
    //        if (hallListForPlay.Contains(hallName))
    //            return true;
    //    }

    //    return false;
    //}
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
