using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Game3Panel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Panels")]
    public Game3TicketPurchasePanel game3TicketPurchasePanel;
    public Game3GamePlayPanel game3GamePlayPanel;

    [Header("Image")]
    [SerializeField] private Image imgBackground;

    public Game3Data Game_3_Data;

    [Header("Blind Purchase")]
    public string Sub_Game_ID_For_Purchase;
    public int Puchase_Ticket_Count;

    #endregion

    #region PRIVATE_VARIABLES
    private GameData gameData = new GameData();
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);
        UIManager.Instance.isGame3 = true;
    }

    private void OnDisable()
    {
        UIManager.Instance.isGame3 = false;
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OpenTicketPurchasePanel(GameData gameData)
    {
        GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);

        this.gameData = gameData;
        Reset();
        this.Open();

        if (game3TicketPurchasePanel)
            game3TicketPurchasePanel.OpenPanel(gameData);
    }

    public void OpenGamePlayPanel(GameData gameData, string gameID)
    {
        if (GameId != gameData.gameId)
            GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);

        this.gameData = gameData;
        Reset();
        this.Open();
        game3GamePlayPanel.OpenPanel(gameData, gameID);
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

    #region PRIVATE_METHODS
    private void Reset()
    {
        if (game3TicketPurchasePanel)
            game3TicketPurchasePanel.Close();
        game3GamePlayPanel.Close();
    }

    internal void Set_Game_3_Purchase_Data(string sub_Game_ID, int ticket_Count)
    {
        Sub_Game_ID_For_Purchase = sub_Game_ID;
        Puchase_Ticket_Count = ticket_Count;
    }

    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
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
            return gameData.gameId;
        }
    }
    #endregion
}
