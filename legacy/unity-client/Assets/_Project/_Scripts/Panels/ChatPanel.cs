using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Video;

public class ChatPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTotalOnlinePlayer;

    [Header("Input")]
    [SerializeField] private TMP_InputField inputTextMessage;

    [Header("Sprite")]
    [SerializeField] private Sprite spriteChatHistoryTheme1;
    [SerializeField] private Sprite spriteChatHistoryTheme2;

    [Header("Sprite")]
    [SerializeField] private Color32 colorProfilePictureBorderTheme1;
    [SerializeField] private Color32 colorProfilePictureBorderTheme2;

    [Header("Game Object")]
    [SerializeField] private GameObject emojiPanel;

    [Header("Prafab")]
    [SerializeField] private PrefabChatHistoryData prefabChatHistoryData;

    [Header("Transform")]
    [SerializeField] private Transform transformTextMessageContainer;
    [SerializeField] private Transform transformEmojiContainer;

    [Header("ScrollRect")]
    [SerializeField] private ScrollRect scrollRectChatPanel;

    [Header("ContentSizeFitter")]
    [SerializeField] private ContentSizeFitter contentSizeFitterChat;

    private Socket _chatSocket;

    private GameData gameData;

    public string Game_Namespace;
    public string Parent_Game_ID;
    public bool Is_Sub_Game;

    List<PrefabChatHistoryData> Chat_History_List = new List<PrefabChatHistoryData>();
    List<string> Chat_Player_ID_List = new List<string>();

    #endregion

    #region UNITY_CALLBACKS
    private void Start()
    {
        InstantiateEmojis();
    }

    private void OnEnable()
    {
        txtTotalOnlinePlayer.text = "0";
        CloseEmojiPanel();
        //ClearTextMessages();

        if (Utility.Instance.IsStandAloneVersion())
            this.GetComponent<RectTransform>().SetTop(60);
    }

    public void InitiateChatFeature(GameData gameData)
    {
        ClearTextMessages();
        this.gameData = gameData;
        print($"Chat");
        Is_Sub_Game = false;
        EventManager.Instance.GameChatHistory(gameData.namespaceString, gameData.gameId, GameChatHistoryResponse);
        DisableBroadcast();
        EnableBroadcasts();
    }

    public void InitiateChatFeatureSubGame(string parent_Game_ID, string game_NameSpace)
    {
        ClearTextMessages();
        Game_Namespace = game_NameSpace;
        //print($"Chat NameSpace : {Game_Namespace}");
        Parent_Game_ID = parent_Game_ID;
        Is_Sub_Game = true;
        EventManager.Instance.GameChatHistory(Game_Namespace, Parent_Game_ID, GameChatHistoryResponse);
        DisableBroadcast();
        EnableBroadcasts();
    }

    private void OnDisable()
    {
        DisableBroadcast();
        ClearTextMessages();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OpenEmojiPanel()
    {
        emojiPanel.SetActive(true);
    }

    public void CloseEmojiPanel()
    {
        emojiPanel.SetActive(false);
    }

    public void SendTextMessage()
    {
        if (inputTextMessage.text != "")
        {
            //AddTextMessage(inputTextMessage.text);
            if (Is_Sub_Game)
            {
                print($"Chat NameSpace : {Game_Namespace} || Parent : {Parent_Game_ID}");
                EventManager.Instance.SendGameChat(Game_Namespace, Parent_Game_ID, inputTextMessage.text, 0, SendMessageResponse);
            }
            else
                EventManager.Instance.SendGameChat(gameData.namespaceString, gameData.gameId, inputTextMessage.text, 0, SendMessageResponse);
            inputTextMessage.text = "";
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void EnableBroadcasts()
    {
        if (GameSocketManager.socketManager == null) return;

        if (Is_Sub_Game)
        {
            GameSocketManager.socketManager.GetSocket("/" + Game_Namespace).On(Constants.BroadcastName.GameChat, GameChatReceived);
            GameSocketManager.socketManager.GetSocket("/" + Game_Namespace).On(Constants.BroadcastName.GameOnlinePlayerCount, GameOnlinePlayerCountReceived);
        }
        else
        {
            GameSocketManager.socketManager.GetSocket("/" + gameData.namespaceString).On(Constants.BroadcastName.GameChat, GameChatReceived);
            GameSocketManager.socketManager.GetSocket("/" + gameData.namespaceString).On(Constants.BroadcastName.GameOnlinePlayerCount, GameOnlinePlayerCountReceived);
        }
    }

    private void DisableBroadcast()
    {
        if (GameSocketManager.socketManager == null) return;

        if (Is_Sub_Game)
        {
            GameSocketManager.socketManager.GetSocket("/" + Game_Namespace).Off(Constants.BroadcastName.GameChat);
            GameSocketManager.socketManager.GetSocket("/" + Game_Namespace).Off(Constants.BroadcastName.GameOnlinePlayerCount);
        }
        else
        {
            if (gameData != null)
            {
                GameSocketManager.socketManager.GetSocket("/" + gameData.namespaceString).Off(Constants.BroadcastName.GameChat);
                GameSocketManager.socketManager.GetSocket("/" + gameData.namespaceString).Off(Constants.BroadcastName.GameOnlinePlayerCount);
            }
        }
    }

    private void InstantiateEmojis()
    {
        foreach (Transform emoji in transformEmojiContainer)
        {
            Destroy(emoji.gameObject);
        }

        for (int i = 0; i < UIManager.Instance.EmojiCount; i++)
        {
            GameObject newGameObject = new GameObject();
            Image img = newGameObject.AddComponent<Image>();
            Button btn = newGameObject.AddComponent<Button>();
            newGameObject.AddComponent<AISButtonSound>();

            img.sprite = UIManager.Instance.GetEmoji(i);

            int emojiId = i;
            btn.onClick.AddListener(() => { SendEmoji(emojiId); });

            newGameObject.transform.SetParent(transformEmojiContainer);
            newGameObject.transform.localScale = Vector3.one;
        }
    }

    private void ClearTextMessages()
    {
        foreach (Transform message in transformTextMessageContainer)
        {
            Destroy(message.gameObject);
        }
    }

    private void SendEmoji(int emojiId)
    {
        //AddEmojiMessge(emojiId);
        if (Is_Sub_Game)
            EventManager.Instance.SendGameChat(Game_Namespace, Parent_Game_ID, "", emojiId, SendMessageResponse);
        else
            EventManager.Instance.SendGameChat(gameData.namespaceString, gameData.gameId, "", emojiId, SendMessageResponse);
        CloseEmojiPanel();
    }

    private void AddTextMessage(string message)
    {
        PrefabChatHistoryData data = Instantiate(prefabChatHistoryData, transformTextMessageContainer);
        data.ChatMessage = message;
        data.SpriteData = GetHistoryPanelTheme();
        data.ProfilePictureBorderColor = GetProfilePictureBorderColor();
        RefreshPanel();
    }

    private void AddEmojiMessge(int emojiId)
    {
        PrefabChatHistoryData data = Instantiate(prefabChatHistoryData, transformTextMessageContainer);
        data.EmojiId = emojiId;
        data.SpriteData = GetHistoryPanelTheme();
        data.ProfilePictureBorderColor = GetProfilePictureBorderColor();
        RefreshPanel();
    }

    private void RefreshPanel()
    {
        Utility.Instance.RefreshContentSizeFitter(contentSizeFitterChat, scrollRectChatPanel);
    }

    private Sprite GetHistoryPanelTheme()
    {
        if (transformTextMessageContainer.childCount % 2 == 0)
            return spriteChatHistoryTheme2;
        else
            return spriteChatHistoryTheme1;
    }

    private Color32 GetProfilePictureBorderColor()
    {
        if (transformTextMessageContainer.childCount % 2 == 0)
            return colorProfilePictureBorderTheme2;
        else
            return colorProfilePictureBorderTheme1;
    }

    private void AddNewChat(ChatData chatData)
    {
        PrefabChatHistoryData data = Instantiate(prefabChatHistoryData, transformTextMessageContainer);
        data.SetData(chatData);
        RefreshPanel();
    }

    private void Add_New_Chat_For_Chat_History(ChatData chatData)
    {
        PrefabChatHistoryData data = Instantiate(prefabChatHistoryData, transformTextMessageContainer);
        data.Set_Data_For_Chat_History(chatData);
        Chat_History_List.Add(data);
        RefreshPanel();
    }

    private void GameChatHistoryResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"GameChatHistory Response: {packet}");
        EventResponse<GameChatHistoryResponse> response = JsonUtility.FromJson<EventResponse<GameChatHistoryResponse>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            Chat_History_List.Clear();
            Chat_Player_ID_List.Clear();
            foreach (ChatData chatData in response.result.history)
                Add_New_Chat_For_Chat_History(chatData);

            for (int i = Chat_History_List.Count - 1; i > -1; i--)
            {
                if (!Chat_Player_ID_List.Contains(Chat_History_List[i].Chat_Data.playerId))
                {
                    Chat_Player_ID_List.Add(Chat_History_List[i].Chat_Data.playerId);
                    StartCoroutine(Utility.Instance.DownloadPlayerProfileImageCall(Chat_History_List[i].Chat_Data.playerId, Chat_History_List[i].Chat_Data.profilePic, Chat_History_List[i].imgProfilePicture, true));
                }
            }

            txtTotalOnlinePlayer.text = response.result.onlinePlayerCount.ToString();
        }
    }

    private void SendMessageResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"SendMessageResponse: {packet}");
        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.FAIL)
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
    }

    internal void UpdatePlayerProfile(string playerID)
    {
        PrefabChatHistoryData chat;
        for (int i = 0; i < transformTextMessageContainer.childCount; i++)
        {
            chat = transformTextMessageContainer.GetChild(i).gameObject.GetComponent<PrefabChatHistoryData>();
            if (chat.Chat_Data.playerId == playerID)
                chat.Change_Profile(Utility.Instance.GetPlayerProfileImage(playerID));
        }
    }

    #endregion

    #region BROADCAST_RECEIVER
    private void GameOnlinePlayerCountReceived(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"GameOnlinePlayerCountReceived: {packet}");
        OnlinePlayerCount data = JsonUtility.FromJson<OnlinePlayerCount>(Utility.Instance.GetPacketString(packet));
        txtTotalOnlinePlayer.text = data.onlinePlayerCount.ToString();

        if (UIManager.Instance.game1Panel.game1GamePlayPanel.gameObject.activeSelf)
            UIManager.Instance.game1Panel.game1GamePlayPanel.TotalRegisteredPlayerCount = data.onlinePlayerCount;
        else if (UIManager.Instance.game2Panel.game2PlayPanel.gameObject.activeSelf)
            UIManager.Instance.game2Panel.game2PlayPanel.TotalRegisteredPlayerCount = data.onlinePlayerCount;
        else if (UIManager.Instance.game3Panel.game3GamePlayPanel.gameObject.activeSelf)
            UIManager.Instance.game3Panel.game3GamePlayPanel.TotalRegisteredPlayerCount = data.onlinePlayerCount;
    }

    private void GameChatReceived(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"GameChatReceived: {packet}");
        ChatData data = JsonUtility.FromJson<ChatData>(Utility.Instance.GetPacketString(packet));
        AddNewChat(data);
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public Socket ChatSocket
    {
        set
        {
            _chatSocket = value;
        }
        get
        {
            return _chatSocket;
        }
    }
    #endregion
}
