using UnityEngine;
using UnityEngine.UI;
using TMPro;
using I2.Loc;

public class PrefabGame2UpcomingGames : MonoBehaviour
{
    #region Variables

    [Header("Texts")]
    public TMP_Text Sub_Game_Name_Txt;
    public TMP_Text Tickets_Purchased_Txt;
    public TMP_Text Remaining_Tickets_Txt;
    public TMP_Text Ticket_Price_Txt;
    public TMP_Text Points_Txt;

    [Header("Upcoming Game Popup Texts")]
    public TextMeshProUGUI subGameNameTxt;

    [Header("Buttons")]
    public Button Decrease_Remaining_Tickets_Btn;
    public Button Increase_Remaining_Tickets_Btn;
    public Button Submit_Btn, Cancel_Btn;

    [Header("Serializable Class")]
    public Game2UpcomingGames Sub_Game_Data;

    [Header("Integer")]
    public int Remaining_Tickets;
    public int Number_Of_Tickets_To_Submit;

    [Header("RectTransform")]
    public RectTransform mainRectTransform;
    public RectTransform buyMoreBoardsPopup;

    [Header("GameObject")]
    public GameObject gameDetailsObj;
    public GameObject buyTicketsObj;

    #endregion

    #region Set Data

    internal void Set_Data(Game2UpcomingGames sub_Game_Data, bool isUpcomingGame = false)
    {
        Sub_Game_Data = sub_Game_Data;

        Sub_Game_Name_Txt.text = sub_Game_Data.name;

        if (isUpcomingGame)
            subGameNameTxt.text = sub_Game_Data.name;
        //Sub_Game_Name_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("name", sub_Game_Data.name.ToString());
        Ticket_Price_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("Price", sub_Game_Data.ticketPrice.ToString());

        if (isUpcomingGame)
            Tickets_Purchased_Txt.text = sub_Game_Data.purchasedTicket > 0 ? LocalizationManager.GetTranslation("Delete Purchased Tickets") + "(" + sub_Game_Data.purchasedTicket + ")" : LocalizationManager.GetTranslation("Tickets purchased");
        else
            Tickets_Purchased_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("TicketPurchased", sub_Game_Data.purchasedTicket.ToString());

        Remaining_Tickets = sub_Game_Data.maxTicket - sub_Game_Data.purchasedTicket;
        Number_Of_Tickets_To_Submit = 0;

        Remaining_Tickets_Txt.text = "0";

        var localManager = Points_Txt.GetComponent<LocalizationParamsManager>();
        localManager.SetParameterValue("Tickets", Number_Of_Tickets_To_Submit.ToString());
        localManager.SetParameterValue("TotalCost", (Number_Of_Tickets_To_Submit * Sub_Game_Data.ticketPrice).ToString());

        Decrease_Remaining_Tickets_Btn.interactable = false;
        Increase_Remaining_Tickets_Btn.interactable = Remaining_Tickets > 0;
        Submit_Btn.interactable = false;
        if (isUpcomingGame)
            Cancel_Btn.interactable = sub_Game_Data.cancelButton;
    }

    #endregion

    #region Buy Tickets

    public void Update_Remaining_Tickets(int direction)
    {
        if (direction > 1)
        {
            Number_Of_Tickets_To_Submit = 0;
        }

        Number_Of_Tickets_To_Submit += direction;
        Remaining_Tickets_Txt.text = Number_Of_Tickets_To_Submit.ToString();

        Decrease_Remaining_Tickets_Btn.interactable = Number_Of_Tickets_To_Submit != 0;
        Increase_Remaining_Tickets_Btn.interactable = Number_Of_Tickets_To_Submit < Remaining_Tickets;

        Submit_Btn.interactable = Number_Of_Tickets_To_Submit != 0;

        if (Number_Of_Tickets_To_Submit <= 0 || Number_Of_Tickets_To_Submit > Remaining_Tickets)
            Submit_Btn.interactable = false;

        //Points_Txt.text = Number_Of_Tickets_To_Submit == 0 ? "" : $"{Number_Of_Tickets_To_Submit * Sub_Game_Data.ticketPrice} kr";
        //Points_Txt.text = Number_Of_Tickets_To_Submit == 0 ? "Buy Tickets" : $"Buy {Number_Of_Tickets_To_Submit} for {Number_Of_Tickets_To_Submit * Sub_Game_Data.ticketPrice} kr";
        Points_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("Tickets", Number_Of_Tickets_To_Submit.ToString());
        Points_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("TotalCost", (Number_Of_Tickets_To_Submit * Sub_Game_Data.ticketPrice).ToString());

    }

    public void Buy_Tickets()
    {
        if (Number_Of_Tickets_To_Submit <= 0 || Number_Of_Tickets_To_Submit > Remaining_Tickets)
            return;

        Submit_Btn.interactable = false;
        UIManager.Instance.game2Panel.Set_Blind_Purchase_Data(Sub_Game_Data.id, Number_Of_Tickets_To_Submit, Sub_Game_Data.luckyNumber);

        // TODO: Replace with Spillorama REST endpoint for Game2 blind purchase
        Debug.LogWarning("[Game2] Buy_Tickets: Spillorama endpoint not yet implemented");
        Submit_Btn.interactable = true;
    }

    public void Open_Choose_Tickets_Btn()
    {
        // Spillorama: namespace handled by SpilloramaSocketManager
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();
        UIManager.Instance.game2Panel.OpenTicketBuyPanel(Sub_Game_Data.id);
    }

    public void CloseButtonTap()
    {
        this.Close();
    }

    public void Cancel_Tickets_Btn()
    {
        UIManager.Instance.topBarPanel.miniGamePlanPanel.Close();
        // TODO: Replace with Spillorama REST endpoint for Game2 cancel tickets
        Debug.LogWarning("[Game2] Cancel_Tickets_Btn: Spillorama endpoint not yet implemented");
    }

    public void UpcomingGameBuyTicketButton()
    {
        if (buyTicketsObj.activeSelf)
        {
            mainRectTransform.sizeDelta = new Vector2(mainRectTransform.sizeDelta.x, 92f);
            gameDetailsObj.SetActive(true);
            buyTicketsObj.SetActive(false);
        }
        else
        {
            mainRectTransform.sizeDelta = new Vector2(mainRectTransform.sizeDelta.x, 352f);
            gameDetailsObj.SetActive(false);
            buyTicketsObj.SetActive(true);
        }
    }

    #endregion

}
