using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabChatHistoryData : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtName;
    [SerializeField] private TextMeshProUGUI txtTime;
    [SerializeField] private TextMeshProUGUI txtMessage;

    [Header("Image")]
    [SerializeField] private Image imgPanelImage;
    [SerializeField] private Image imgProfilePictureBorder;
    [SerializeField] internal Image imgProfilePicture;
    [SerializeField] private Image imgEmoji;

    internal ChatData Chat_Data;

    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(ChatData chatData)
    {
        Chat_Data = chatData;
        txtName.text = chatData.name;

        if (chatData.message != "")
            ChatMessage = chatData.message;
        else
            EmojiId = chatData.emojiId;

        if (chatData.profilePic != "")
            Utility.Instance.DownloadPlayerProfileImage(chatData.playerId, chatData.profilePic, imgProfilePicture);
        txtTime.text = Utility.Instance.GetDateTimeLocal(chatData.dateTime).ToString("hh:mm tt");
    }

    internal void Set_Data_For_Chat_History(ChatData chatData)
    {
        Chat_Data = chatData;
        txtName.text = chatData.name;

        if (chatData.message != "")
            ChatMessage = chatData.message;
        else
            EmojiId = chatData.emojiId;

        txtTime.text = Utility.Instance.GetDateTimeLocal(chatData.dateTime).ToString("hh:mm tt");
    }

    public void Change_Profile(Sprite img)
    {
        if (img != null)
            imgProfilePicture.sprite = img;
    }

    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public Sprite SpriteData
    {
        set
        {
            if(value)
                imgPanelImage.sprite = value;
        }
    }

    public Color32 ProfilePictureBorderColor
    {
        set
        {           
            imgProfilePictureBorder.color = value;
        }
    }

    public string ChatMessage
    {
        set
        {
            txtMessage.text = value;
            txtMessage.Open();
            imgEmoji.Close();
        }
    }

    public int EmojiId
    {
        set
        {
            imgEmoji.sprite = UIManager.Instance.GetEmoji(value);
            txtMessage.Close();
            imgEmoji.Open();
        }
    }
    #endregion
}
