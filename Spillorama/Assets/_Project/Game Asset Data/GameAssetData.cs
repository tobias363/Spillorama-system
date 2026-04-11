#if !UNITY_WEBGL
using I2.Loc;
#endif
using JetBrains.Annotations;
using System;
using System.Collections.Generic;
using UnityEngine;

public class GameAssetData : ScriptableObject
{
    public bool IsLoggedIn = false;
    public PlayerCredentials playerCredentials;
    public PlayerGameData playerGameData;
    public HomeListItem[] homeGameList;
    public List<HallData> hallDataList;
    public List<string> countryList;
    public MonthlyLimitData monthlyLimitData;
    public BlockingOptionData blockingOptionData;
    public Sprite defaultAvatar;
    public List<string> _hallList = new List<string>();
    public RegisterInfoText registerInfoText;
    public string userAgent;
    public int isVoiceOn;
    public int isSoundOn;
    public int selectedVoiceLanguage;

    public void SetPlayerData(PlayerCredentials creds)
    {
        playerCredentials = creds;
    }

    #region GetterSetter
    public bool IsUniqueIdPlayer
    {
        set
        {
            playerGameData._isUniqueIdPlayer = value;
        }
        get
        {
            return playerGameData._isUniqueIdPlayer;
        }
    }

    public string PlayerId
    {
        set
        {
            playerGameData._playerId = value;
        }
        get
        {
            return playerGameData._playerId;
        }
    }

    public string Points
    {
        set
        {
            playerGameData._points = value;
            UIManager.Instance.topBarPanel.Points = value;
            UIManager.Instance.selectPurchaseTypePanel.Points = value;
            UIManager.Instance.lobbyPanel.voucherPanel.Points = value;
        }
        get
        {
            return playerGameData._points;
        }
    }

    public string RealMoney
    {
        set
        {
            playerGameData._realMoney = value;
            UIManager.Instance.topBarPanel.RealMoney = value;
            UIManager.Instance.lobbyPanel.walletPanel.balancePanel.RealMoney = value;
            UIManager.Instance.selectPurchaseTypePanel.RealMoney = value;
        }
        get
        {
            return playerGameData._realMoney;
        }
    }

    public string TodaysBalance
    {
        set
        {
            playerGameData._todaysBalance = value;
            UIManager.Instance.topBarPanel.TodaysBalance = value;
            UIManager.Instance.lobbyPanel.walletPanel.balancePanel.TodaysBalance = value;
            UIManager.Instance.selectPurchaseTypePanel.TodaysBalance = value;
        }
        get
        {
            return playerGameData._todaysBalance;
        }
    }

    public bool EnableNotification
    {
        set
        {
            playerGameData._enableNotification = value;
        }
        get
        {
            return playerGameData._enableNotification;
        }
    }

    public string PreviousGameId
    {
        set
        {
            playerGameData._previousGameId = value;
        }
        get
        {
            return playerGameData._previousGameId;
        }
    }

    public List<string> HallList
    {
        get
        {
            return _hallList;
        }
        set
        {
            _hallList = value;
        }
    }
    #endregion
}

[Serializable]
public class PlayerCredentials
{

    public PlayerCredentials(string email, string password, bool remember, string hallname, string hallid)
    {
        emailUsername = email;
        this.password = password;
        isRemember = remember;
        hallName = hallname;
        hallId = hallid;
    }

    public string emailUsername = "";
    public string password = "";
    public bool isRemember = false;
    public string hallName = "";
    public string hallId = "";
    public string refreshToken = "";
    public string authToken = "";
}

[Serializable]
public class MonthlyLimitData
{
    public long minMonthlyUsageLimit = 0;
    public long maxMonthlyUsageLimit = 2000;
    public long incrementValue = 500;
    public long monthlyUsageLimit = 0;
}

[Serializable]
public class BlockingOptionData
{
    public List<int> list = new List<int>();
    public int index = 0;
}

[Serializable]
public class PlayerGameData
{
    public string _playerId = "";
    public string _username = "";
    public string _email = "";
    public string _nickname = "";
    public string _mobileNumber = "";
    public DateTime _dateOfBirth;
    public string _bankId = "";
    public string firebaseToken = "";
    public string Player_Hall_ID = "";
    public string authToken = "";
    public string refreshAuthToken = "";
    public bool canPlayGames;
    public bool isVerifiedByBankID;
    public bool isVerifiedByHall;
    public string _points;
    public string _realMoney;
    public string _todaysBalance;
    public string _previousGameId = "";

    public bool _enableNotification = true;
    public bool _isUniqueIdPlayer = false;
}