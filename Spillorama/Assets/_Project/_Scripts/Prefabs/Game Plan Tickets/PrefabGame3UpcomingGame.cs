using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using I2.Loc;

public class PrefabGame3UpcomingGame : MonoBehaviour
{
    #region Variables

    [Header("Texts")]
    public TMP_Text Sub_Game_Name_Txt;
    public TMP_Text Tickets_Purchased_Txt;
    public TMP_Text Remaining_Tickets_Txt;
    public TMP_Text Ticket_Price_Txt;
    public TMP_Text Points_Txt;

    [Header("Buttons")]
    public Button Decrease_Remaining_Tickets_Btn;
    public Button Increase_Remaining_Tickets_Btn;
    public Button Submit_Btn, Cancel_Btn;

    public Game3UpcomingGames Sub_Game_Data;

    public int Remaining_Tickets, Number_Of_Tickets_To_Submit;

    [Header("Upcoming Game Popup Texts")]
    public TextMeshProUGUI subGameNameTxt;

    [Header("RectTransform")]
    public RectTransform mainRectTransform;

    [Header("GameObject")]
    public GameObject gameDetailsObj;
    public GameObject buyTicketsObj;


    #endregion

    #region Set Data

    internal void Set_Data(Game3UpcomingGames sub_Game_Data, bool isUpcomingGame = false)
    {
        Sub_Game_Data = sub_Game_Data;

        Sub_Game_Name_Txt.text = sub_Game_Data.name;

        if (isUpcomingGame)
            subGameNameTxt.text = sub_Game_Data.name;

        Ticket_Price_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("Price", sub_Game_Data.ticketPrice.ToString());

        if (isUpcomingGame)
            Tickets_Purchased_Txt.text = sub_Game_Data.purchasedTicket > 0 ? LocalizationManager.GetTranslation("Delete Purchased Tickets") + "(" + sub_Game_Data.purchasedTicket + ")" : LocalizationManager.GetTranslation("Tickets purchased");
        else
            Tickets_Purchased_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("TicketPurchased", sub_Game_Data.purchasedTicket.ToString());

        Remaining_Tickets = sub_Game_Data.maxTicket - sub_Game_Data.purchasedTicket;
        Number_Of_Tickets_To_Submit = 0;

        Remaining_Tickets_Txt.text = "0";

        if (Number_Of_Tickets_To_Submit > 0)
        {
            var localManager = Points_Txt.GetComponent<LocalizationParamsManager>();
            localManager.SetParameterValue("Tickets", Number_Of_Tickets_To_Submit.ToString());
            localManager.SetParameterValue("TotalCost", (Number_Of_Tickets_To_Submit * Sub_Game_Data.ticketPrice).ToString());
        }
        else
        {
            Points_Txt.text = LocalizationManager.GetTranslation("Buy Tickets");
        }

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

        print($"Buy Tickets : {Number_Of_Tickets_To_Submit}");
        Submit_Btn.interactable = false;

        UIManager.Instance.game3Panel.Set_Game_3_Purchase_Data(Sub_Game_Data.id, Number_Of_Tickets_To_Submit);

        EventManager.Instance.Game3Purchase("realMoney", "");

        //UIManager.Instance.selectPurchaseTypePanel.Open(GameSocketManager.SocketGame2);

        //UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByPoints.AddListener((string voucherCode) => {
        //    EventManager.Instance.Game3Purchase("points", voucherCode);
        //});

        //UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByRealMoney.AddListener((string voucherCode) => {
        //    EventManager.Instance.Game3Purchase("realMoney", voucherCode);
        //});

        //UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByTodaysBalance.AddListener((string voucherCode) => {
        //    EventManager.Instance.Game3Purchase("realMoney", voucherCode);
        //});
    }


    public void CloseButtonTap()
    {
        this.Close();
    }

    public void Cancel_Tickets_Btn()
    {
        print($"Cancel Tickets : {Sub_Game_Data.id}");
        EventManager.Instance.Game3CancelTickets(Sub_Game_Data.id);
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
