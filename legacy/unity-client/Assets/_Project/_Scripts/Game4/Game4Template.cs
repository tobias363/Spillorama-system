using System;
using System.Collections.Generic;
using JetBrains.Annotations;
using UnityEngine;

[Serializable]
public class PatternThemeData
{
    public Color32 textColor;// = "#FFE83D";
    public Color32 backgroundColor;// = "#FFFFFF";
    public Color32 normalCellColor;// = "#790001";
    public Color32 filledCellColor;// = "#FFE83D";
    public Color32 extraText;// = "#FFE83D";
    public Color32 extraOutline;// = "#7C0002";
}

[Serializable]
public class TicketThemeData
{
    public Color32 backgroundColor;// = "#FFF2CE";
    public Color32 gridCellColor;// = "#FFD6A7";
    public Color32 markerColor;// = "#7E001B";
    public Color32 markerTextColor;// = "#FFD6A7";
    public Color32 normalTextColor;// = "#000000";
    public Color32 ticketHighlighCellColor;//FFE83D

    public Color32 addTicketColor;// = "#2E0000";
    public Color32 removeButtonBackgroundColor;// = "#E7D290";
    public Color32 removeButtonBorderColor;// = "#FF0000";
}

[Serializable]
public class WithdrawBallContainerThemeData
{
    public Sprite spriteBallContainer = null;

    public Color32 ballColor;// = "#FFBA00";
    public Color32 ballNumberColor;// = "#000000";
}

[Serializable]
public class BetPanelTheme
{
    public Sprite spriteBetPanel = null;
    public Color32 textColor;// = "#FFFFFF";

    public Color32 ticketThumbnailOutlineColor;//FFB82F
    public Sprite spriteBTicketThumbnailIcon = null;
    public Color32 ticketCounterTextColor;// = "#000000";
}

[Serializable]
public class Game4Theme
{
    public PatternThemeData patternThemeData = new PatternThemeData();
    public TicketThemeData ticketThemeData = new TicketThemeData();
    public WithdrawBallContainerThemeData withdrawBallContainerThemeData = new WithdrawBallContainerThemeData();
    public BetPanelTheme betPanelTheme = new BetPanelTheme();

    public Sprite spritePlayButton = null;
    public Sprite spriteBackground = null;
}