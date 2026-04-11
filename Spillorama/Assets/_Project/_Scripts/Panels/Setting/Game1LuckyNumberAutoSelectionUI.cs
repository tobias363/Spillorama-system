using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using BestHTTP.SocketIO;

public class Game1LuckyNumberAutoSelectionUI : MonoBehaviour
{

    #region Variables

    public List<Game1LuckyNumberAutoSelectionBtn> Lucky_Number_Btn_List;
    public Transform Content;

    #endregion

    private void OnValidate()
    {
        Lucky_Number_Btn_List.Clear();
        for (int i = 0; i < Content.childCount; i++)
        {
            if (Content.GetChild(i).gameObject.GetComponent<Game1LuckyNumberAutoSelectionBtn>() == null)
                Content.GetChild(i).gameObject.AddComponent<Game1LuckyNumberAutoSelectionBtn>();
            Lucky_Number_Btn_List.Add(Content.GetChild(i).gameObject.GetComponent<Game1LuckyNumberAutoSelectionBtn>());
            Lucky_Number_Btn_List[i].Selected = Lucky_Number_Btn_List[i].transform.GetChild(1).gameObject;
            Lucky_Number_Btn_List[i].Lucky_Number = i + 1;
            Content.GetChild(i).gameObject.name = $"Lucky_Number_{(i + 1)}";
            Content.GetChild(i).GetChild(2).gameObject.name = $"Lucky_Number_Txt";
            Content.GetChild(i).GetChild(2).gameObject.GetComponent<TMP_Text>().text = $"{(i + 1)}";
        }
    }

    public void Open_Game_1_Lucky_Number_Selection_UI()
    {
        int length = Lucky_Number_Btn_List.Count;
        for (int i = 0; i < length; i++)
            Lucky_Number_Btn_List[i].Selected.SetActive(false);
        if (UIManager.Instance.settingPanel.Game_1_Lucky_Number > 0)
            Lucky_Number_Btn_List[UIManager.Instance.settingPanel.Game_1_Lucky_Number - 1].Selected.SetActive(true);
        gameObject.SetActive(true);
    }

    public void Back_Btn()
    {
        SoundManager.Instance.MouseClick1();
        gameObject.SetActive(false);
    }

    public void Set_Lucky_Number(int lucky_Number)
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.Set_Auto_Lucky_Number_For_Game_1(lucky_Number, (Socket socket, Packet packet, object[] args) =>
        {
            print($"SetLuckyNumber response : {packet.ToString()}");
            EventResponse res = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

            if (res.status.ToLower() == "success")
            {
                UIManager.Instance.settingPanel.Set_Game_1_Lucky_Number_Selection_UI(lucky_Number, UIManager.Instance.settingPanel.Game_1_Lucky_Number_TG.isOn);
                gameObject.SetActive(false);
            }
            else
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(res.message);
            }

            //UIManager.Instance.settingPanel.Game_1_Lucky_Number = lucky_Number;

            UIManager.Instance.DisplayLoader(false);
        });
    }

}
