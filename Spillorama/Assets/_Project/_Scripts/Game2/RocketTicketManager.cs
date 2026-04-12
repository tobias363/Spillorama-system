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

    #region Unity Methods

    void Awake()
    {
        Instance = this;
    }

    #endregion

    #region Update Rocket

    internal void SetUp_Rocket_Tickets(int total, int bought)
    {
        purchasedTicketsCountTxt.text = bought.ToString();
    }

    internal void Update_Rocket_Tickets(int bought)
    {
        purchasedTicketsCountTxt.text = bought.ToString();
    }

    #endregion

}
