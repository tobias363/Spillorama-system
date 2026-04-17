using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using BestHTTP.SocketIO;
using UnityEngine;
using UnityEngine.UI;

public class PrefabGame4ThemeButton : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Images")]
    [SerializeField] private Image imgThemeThumbnail;
    [SerializeField] private Image imgDownloadIcon;

    [Header("Data")]
    [SerializeField] private Game4Theme theme;
    [SerializeField] private int currentTheme;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnButtonTap()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.Game4Data(Game4DataResponse);

        if (currentTheme == 1)
        {
            UIManager.Instance.isGame4Theme1 = true;
        }
        else if (currentTheme == 2)
        {
            UIManager.Instance.isGame4Theme2 = true;
        }
        else if (currentTheme == 3)
        {
            UIManager.Instance.isGame4Theme3 = true;
        }
        else if (currentTheme == 4)
        {
            UIManager.Instance.isGame4Theme4 = true;
        }
        else if (currentTheme == 5)
        {
            UIManager.Instance.isGame4Theme5 = true;
        }
        else
        {
            UIManager.Instance.isGame4Theme1 = false;
            UIManager.Instance.isGame4Theme2 = false;
            UIManager.Instance.isGame4Theme3 = false;
            UIManager.Instance.isGame4Theme4 = false;
            UIManager.Instance.isGame4Theme5 = false;
        }

        //UIManager.Instance.game4Panel.game4GamePlayPanel.SetData(theme);
        //UIManager.Instance.game4Panel.game4ThemeSelectionPanel.Close();        
    }
    #endregion

    #region PRIVATE_METHODS
    private void Game4DataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Game4Data Response : " + packet.ToString());

        UIManager.Instance.DisplayLoader(false);

        try
        {
            EventResponse<Game4Data> game4DataResponse = JsonUtility.FromJson<EventResponse<Game4Data>>(Utility.Instance.GetPacketString(packet));

            if (game4DataResponse.status == Constants.EventStatus.SUCCESS)
            {
                if (Utility.Instance.IsSplitScreenSupported)
                {
                    if (UIManager.Instance.splitScreenGameManager.game4Panel.isActiveAndEnabled)
                        UIManager.Instance.splitScreenGameManager.game4Panel.Close();
                    UIManager.Instance.splitScreenGameManager.OpenGamePlay4(theme, game4DataResponse.result);
                    UIManager.Instance.game4Panel.Close();
                }
                else
                {
                    if (game4DataResponse.result.startBreakTime != null && game4DataResponse.result.endBreakTime != null)
                    {
                        UIManager.Instance.startBreakTime = DateTime.Parse(game4DataResponse.result.startBreakTime, CultureInfo.CurrentCulture);
                        UIManager.Instance.endBreakTime = DateTime.Parse(game4DataResponse.result.endBreakTime, CultureInfo.CurrentCulture);
                        if (BackgroundManager.Instance.checkBreakTime != null)
                        {
                            StopCoroutine(BackgroundManager.Instance.checkBreakTime);
                        }
                        BackgroundManager.Instance.checkBreakTime = StartCoroutine(BackgroundManager.Instance.CheckBreakTime());
                        // BackgroundManager.Instance.StopBreakCheck();
                        // BackgroundManager.Instance.StartBreakCheck();
                    }
                    UIManager.Instance.isBreak = game4DataResponse.result.isBreak;
                    bool IsGameRunning = game4DataResponse.result.status.Equals("running");
                    UIManager.Instance.game4Panel.game4GamePlayPanel.SetData(theme, game4DataResponse.result, IsGameRunning);
                    UIManager.Instance.game4Panel.game4ThemeSelectionPanel.Close();
                }
            }

            else
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(game4DataResponse.message);
            }
        }
        catch (Exception e)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(e.Message + "\n" + e.StackTrace);
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
