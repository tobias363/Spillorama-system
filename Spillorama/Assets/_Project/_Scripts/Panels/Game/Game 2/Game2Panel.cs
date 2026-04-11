using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Game2Panel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    [Header("Panels")]
    public Game2TicketPurchasePanel game2TicketPurchasePanel;
    public Game2GamePlayPanel game2PlayPanel;

    [Header("Image")]
    [SerializeField] private Image imgBackground;
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] internal GameData gameData = new GameData();
    private int _luckyNumber;

    public Game2Data Game_2_Data;

    [Header("Blind Purchase")]
    public string Sub_Game_ID_For_Blind_Purchase;
    public int Blind_Ticket_Count;
    public int Sub_Game_Lucky_Number_For_Blind_Purchase;

    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);
    }

    private void OnDisable()
    {
        if (game2TicketPurchasePanel)
            game2TicketPurchasePanel.Close();
        game2PlayPanel.Close();
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void OpenTicketBuyPanel(GameData gameData)
    {
        GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);

        this.gameData = gameData;
        Reset();
        this.Open();

        if (game2TicketPurchasePanel)
            game2TicketPurchasePanel.OpenPanel(gameData);
    }

    public void OpenTicketBuyPanel(string sub_Game_ID)
    {
        GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);
        Reset();
        this.Open();

        if (game2TicketPurchasePanel)
            game2TicketPurchasePanel.OpenPanel(sub_Game_ID);
    }

    public void OpenGamePlayPanel(GameData gameData, string gameId)
    {
        if (GameId != gameData.gameId)
            GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);

        this.gameData = gameData;
        Reset();
        this.Open();
        game2PlayPanel.OpenPanel(gameData, gameId);
        if (BackgroundManager.Instance.checkBreakTime != null)
        {
            StopCoroutine(BackgroundManager.Instance.checkBreakTime);
        }
        BackgroundManager.Instance.checkBreakTime = StartCoroutine(BackgroundManager.Instance.CheckBreakTime());
        // BackgroundManager.Instance.StopBreakCheck();
        // BackgroundManager.Instance.StartBreakCheck();
    }

    public void ClosePanel()
    {
        Transform transformLobbyPanel = UIManager.Instance.lobbyPanel.transform;
        this.transform.SetParent(transformLobbyPanel.parent);
        this.transform.SetSiblingIndex(transformLobbyPanel.GetSiblingIndex() + 1);
        Utility.Instance.StretchAllZero(this.GetComponent<RectTransform>());
        this.Close();
    }
    #endregion

    #region Blind Purcahse

    internal void Set_Blind_Purchase_Data(string sub_Game_ID, int ticket_Count, int lucky_Number)
    {
        Sub_Game_ID_For_Blind_Purchase = sub_Game_ID;
        Blind_Ticket_Count = ticket_Count;
        Sub_Game_Lucky_Number_For_Blind_Purchase = lucky_Number == 0 ? Random.Range(1, 22) : lucky_Number;
    }

    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        if (game2TicketPurchasePanel)
            game2TicketPurchasePanel.Close();
        game2PlayPanel.Close();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public int LuckyNumber
    {
        set
        {
            _luckyNumber = value;

            if (game2TicketPurchasePanel)
                game2TicketPurchasePanel.LuckyNumber = value;
            game2PlayPanel.LuckyNumber = value;
        }
        get
        {
            return _luckyNumber;
        }
    }

    public int GameBackgroundId
    {
        set
        {
            PlayerPrefs.SetInt("Game_Background", value);
            imgBackground.sprite = UIManager.Instance.GetBackgroundSprite(value);
        }
    }

    public string GameId
    {
        get
        {
            return Game_2_Data.gameId;
            //return gameData.gameId;
        }
    }
    #endregion
}
