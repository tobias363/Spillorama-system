using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;

public class RocketTicketManager : MonoBehaviour
{
    #region Variables

    public static RocketTicketManager Instance;

    public GameObject Rocket_Ticket_Prefab;
    public Transform Rocket_Ticket_Parent;

    public Color Ticket_Normal_Color, Ticket_Bought_Color;

    [Header("Text")]
    public TextMeshProUGUI purchasedTicketsCountTxt;
    #endregion

    #region PRIVATE_VARIABLES
    private List<RocketTicket> Rocket_Ticket_List;
    private RocketTicket Ticket;
    private int Total;
    #endregion

    #region Unity Methdos

    void Awake()
    {
        Instance = this;
    }

    #endregion

    #region Update Rocket

    internal void SetUp_Rocket_Tickets(int total, int bought)
    {
        Debug.Log("SetUp_Rocket_Tickets : " + total + " : " + bought);

        purchasedTicketsCountTxt.text = bought.ToString();

        /*Total = total;

        int length = Rocket_Ticket_List.Count;
        for (int i = 0; i < length; i++)
            Destroy(Rocket_Ticket_List[i].gameObject);

        Rocket_Ticket_List.Clear();

        for (int i = 0; i < total; i++)
        {
            Ticket = Instantiate(Rocket_Ticket_Prefab, Rocket_Ticket_Parent).GetComponent<RocketTicket>();
            Ticket.Ticket_Img.color = i < bought ? Ticket_Bought_Color : Ticket_Normal_Color;
            Ticket.Ticket_Number_Txt.color = i < bought ? Ticket_Normal_Color : Ticket_Bought_Color;
            Ticket.Ticket_Number_Txt.text = $"{i + 1}";
            Rocket_Ticket_List.Add(Ticket);
        }*/
    }

    internal void Update_Rocket_Tickets(int bought)
    {
        purchasedTicketsCountTxt.text = bought.ToString();

        /*for (int i = 0; i < Total; i++)
        {
            Rocket_Ticket_List[i].Ticket_Img.color = i < bought ? Ticket_Bought_Color : Ticket_Normal_Color;
            Rocket_Ticket_List[i].Ticket_Number_Txt.color = i < bought ? Ticket_Normal_Color : Ticket_Bought_Color;
        }*/
    }

    #endregion

}
