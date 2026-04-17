using UnityEngine;

public partial class Game1GamePlayPanel
{
    public void Chat_Open_Close_Btn()
    {
        switch (Chat_Panel_State)
        {
            case 0:
                LeanTween.cancel(chatPanel.gameObject);
                LeanTween.move(
                    Chat_Panel_RT,
                    new Vector2(0f, Chat_Panel_RT.anchoredPosition.y),
                    0.25f
                );

                LeanTween.cancel(Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(
                    Tickets_ScrollRect_RT.gameObject,
                    Set_Ticket_Scroll_Rect_RT,
                    new Vector2(200f, -30f),
                    new Vector2(200f, -400f),
                    0.25f
                );
                LeanTween.cancel(Elvis_Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(
                    Elvis_Tickets_ScrollRect_RT.gameObject,
                    Set_Elvis_Ticket_Scroll_Rect_RT,
                    new Vector2(200f, -30f),
                    new Vector2(200f, -400f),
                    0.25f
                );

                Chat_Open_Close_Icon.eulerAngles = new Vector3(0f, 0f, 180f);
                Chat_Open_Open_Text.SetActive(false);
                Chat_Open_Close_Text.SetActive(true);
                Chat_Panel_State = 1;
                if (Upcoming_Game_Purchase_UI.activeSelf)
                {
                    LeanTween.cancel(Upcoming_Game_Purchase_UI);
                    LeanTween.move(
                        Upcoming_Game_Purchase_UI.GetComponent<RectTransform>(),
                        new Vector2(
                            (-Chat_Panel_RT.rect.width / 2f) + 100f,
                            Upcoming_Game_Purchase_UI.GetComponent<RectTransform>().anchoredPosition.y
                        ),
                        0.25f
                    );
                }

                if (Panel_Game_Header.activeSelf)
                {
                    LeanTween.cancel(Panel_Game_Header);
                    LeanTween
                        .move(
                            Panel_Game_Header.GetComponent<RectTransform>(),
                            new Vector2(
                                Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x - 80,
                                Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y
                            ),
                            0.25f
                        )
                        .setOnComplete(() =>
                        {
                            RectTransform rectTransform =
                                Panel_Game_Header.GetComponent<RectTransform>();
                            rectTransform.offsetMin = new Vector2(0f, rectTransform.offsetMin.y);
                            rectTransform.offsetMax = new Vector2(0f, rectTransform.offsetMax.y);
                        });
                }
                break;
            case 1:
                LeanTween.cancel(chatPanel.gameObject);
                LeanTween.move(
                    Chat_Panel_RT,
                    new Vector2(Chat_Panel_RT.rect.width * 3f, Chat_Panel_RT.anchoredPosition.y),
                    0.25f
                );
                LeanTween.cancel(Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(
                    Tickets_ScrollRect_RT.gameObject,
                    Set_Ticket_Scroll_Rect_RT,
                    new Vector2(200f, -400f),
                    new Vector2(200f, -30f),
                    0.25f
                );
                LeanTween.cancel(Elvis_Tickets_ScrollRect_RT.gameObject);
                LeanTween.value(
                    Elvis_Tickets_ScrollRect_RT.gameObject,
                    Set_Elvis_Ticket_Scroll_Rect_RT,
                    new Vector2(200f, -400f),
                    new Vector2(200f, -30f),
                    0.25f
                );
                Chat_Open_Close_Icon.eulerAngles = Vector3.zero;
                Chat_Open_Open_Text.SetActive(true);
                Chat_Open_Close_Text.SetActive(false);
                Chat_Panel_State = 0;
                if (Upcoming_Game_Purchase_UI.activeSelf)
                {
                    LeanTween.cancel(Upcoming_Game_Purchase_UI);
                    LeanTween.move(
                        Upcoming_Game_Purchase_UI.GetComponent<RectTransform>(),
                        new Vector2(
                            100f,
                            Upcoming_Game_Purchase_UI.GetComponent<RectTransform>().anchoredPosition.y
                        ),
                        0.25f
                    );
                }

                if (Panel_Game_Header.activeSelf)
                {
                    LeanTween.cancel(Panel_Game_Header);
                    LeanTween
                        .move(
                            Panel_Game_Header.GetComponent<RectTransform>(),
                            new Vector2(
                                Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.x + 80f,
                                Panel_Game_Header.GetComponent<RectTransform>().anchoredPosition.y
                            ),
                            0.25f
                        )
                        .setOnComplete(() => { });
                }

                break;
        }
    }

    void Set_Ticket_Scroll_Rect_RT(Vector2 size)
    {
        Tickets_ScrollRect_RT.offsetMin = new Vector2(size.x, Tickets_ScrollRect_RT.offsetMin.y);
        Tickets_ScrollRect_RT.offsetMax = new Vector2(size.y, Tickets_ScrollRect_RT.offsetMax.y);
    }

    void Set_Elvis_Ticket_Scroll_Rect_RT(Vector2 size)
    {
        Elvis_Tickets_ScrollRect_RT.offsetMin = new Vector2(
            size.x,
            Elvis_Tickets_ScrollRect_RT.offsetMin.y
        );
        Elvis_Tickets_ScrollRect_RT.offsetMax = new Vector2(
            size.y,
            Elvis_Tickets_ScrollRect_RT.offsetMax.y
        );
    }
}
