using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[System.Serializable]
public struct Tickets_Color
{
    public string name;
    public Color BG_Color, Block_Color, Large_BG_Color;
}

public class TicketColorManager : MonoBehaviour
{
    #region Variables

    public static TicketColorManager Instance;

    public List<Tickets_Color> Ticket_Colors;

    public Color One_to_go_Color;

    #endregion

    #region Unity Methods

    void Awake()
    {
        Instance = this;
    }

    #endregion

    internal Tickets_Color Get_Ticket_Color(string color)
    {
        int length = Ticket_Colors.Count;
        for (int i = 0; i < length; i++)
            if (Ticket_Colors[i].name == color)
                return Ticket_Colors[i];

        return Ticket_Colors[0];
    }

    internal Color Get_1_to_go_Color()
    {
        return One_to_go_Color;
    }

}
