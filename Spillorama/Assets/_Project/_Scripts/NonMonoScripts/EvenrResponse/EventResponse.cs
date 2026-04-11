using System;
using System.Collections.Generic;

[Serializable]
public class EventResponse
{
    public string status = "";
    public string result = "";
    public string message = "";
    public string messageType = "";
    public int statusCode = 0;
}

[Serializable]
public class EventResponseLong : EventResponse
{
    public new long result;
}

[Serializable]
public class StartMiniGameBroadcast
{
    public string gameId = "", miniGameType = "";
    public long amount = 0, playerFinalWinningAmount = 0;
    public WinningTicketNumbers winningTicketNumbers;
    public AdminHallDisplayResult winningScreen;
}

[Serializable]
public class WinningTicketNumbers
{
    public List<WinnerField> physicalWinners;
    public List<WinnerField> onlineWinners;
    public List<WinnerField> uniqueWinners;
}

[Serializable]
public class WinnerField
{
    public string ticketNumber;
    public int winningAmount;
}

[Serializable]
public class EventResponse<T> where T : class
{
    public const string STATUS_FAIL = "fail";
    public const string STATUS_SUCCESS = "success";

    public string status;
    public T result;
    public string message;
    public string messageType = "";
    public int statusCode;
}

[Serializable]
public class EventResponseArray<T> : EventResponse<T> where T : class
{
    public new T[] result;
}

[Serializable]
public class EventResponseList<T> : EventResponse<T> where T : class
{
    public new List<T> result = new List<T>();
}

[Serializable]
public class ListJsonT<T> where T : class
{
    public List<T> list = new List<T>();

    public ListJsonT() { }
    public ListJsonT(List<T> list)
    {
        this.list = list;
    }
}

[Serializable]
public class RefreshAuthTokenResponse
{
    public string authToken = "";
    public string refreshAuthToken = "";
}

[Serializable]
public class LoginRegisterResponse
{
    public string playerId = "";
    public string username = "";

    public double points = 0;
    public double realMoney = 0;
    public string message;

    public string storeUrl = "";
    public bool enableNotification = true;

    public MonthlyLimitData monthlyLimitData = new MonthlyLimitData();
    public BlockingOptionData blockData = new BlockingOptionData();

    public List<string> hallList = new List<string>();

    public bool isUniqueIdPlayer = false;
}

[Serializable]
public class ImageUpload
{
    public string photoFront = "";
    public string photoBack = "";
}

[Serializable]
public class LoginResponse
{
    public string playerId = "";
    public string hall = "";
    public double points = 0;
    public string realMoney;
}
[Serializable]
public class ProfileData
{
    public string playerId;
    public string hall;
    public string hallName;
    public double points;
    public double realMoney;
}

[Serializable]
public class AppUpdateData
{
    public string storeUrl;
    public string message;
    public bool disable_store_link;
    public bool isUniqueIdPlayer = false;
    public bool screenSaver = false;
    public bool canPlayGames;
    public bool isVerifiedByBankID;
    public bool isVerifiedByHall;
    public string playerId;
    public string hall;
    public string hallName;
    public string points;
    public string realMoney;
    public string selectedLanguage;
    public string screenSaverTime = "";
    public string authToken = "";
    public string refreshAuthToken = "";
    public int isVoiceOn;
    public int isSoundOn;
    public int selectedVoiceLanguage;
    public List<ImageTime> imageTime = new List<ImageTime>();
    public List<ApprovedHalls> approvedHalls = new List<ApprovedHalls>();
}

[Serializable]
public class ApprovedHalls
{
    public string hallId = "";
    public string hallName = "";
    public double totalLimitAvailable = 0;
    public List<GroupHall> groupHall = new List<GroupHall>();
    public bool isSelected = false;
}

[Serializable]
public class GroupHall
{
    public string id = "";
    public string name = "";
}

[Serializable]
public class SwitchHallResponse
{
    public string playerId;
    public string hall;
    public string hallName;
    public double realMoney;
}

[Serializable]
public class PlayerApprovedHallsResponse
{
    public List<ApprovedHalls> approvedHalls = new List<ApprovedHalls>();
}

[Serializable]
public class ImageTime
{
    public string id = "";
    public string time = "";
    public string image = "";
}

[Serializable]
public class ModifyScreenSaverData
{
    public bool screenSaver = false;
    public string screenSaverTime = "";
    public List<ImageTime> imageTime = new List<ImageTime>();
}

[Serializable]
public class PlayerProfile
{
    public string playerId = "";
    public string email = "";
    public string username = "";
    public string surname = "";
    public string nickname = "";
    public string bankId = "";
    public string mobile = "";
    public string dob;
    public string profilePic = "";
    public string frontId = "";
    public string backId = "";
    public int customerNumber = 0;
    public HallData hall = new HallData();
    public bool isVerifiedByBankID;
    public bool isVerifiedByHall;
    public bool isBankIdReverificationNeeded;
    public string idExpiryDate;
}

[Serializable]
public class FaqDetails
{
    public string _id;      //5f477d5c3304924b2234e783",
    public string queId;    //BingoFAQ-1",
    public string question; //What is Game Name ..?",
    public string answer;   //Bingo Game"
}

[Serializable]
public class TitleDescription
{
    public string title;       //Terms & Condition,
    public string description; //Hello this is Bingo game Terms of Services
}

[Serializable]
public class HomeListItem
{
    public string name;        //Game 1",
    public string photo;       //1597325160411.jpg",
    public bool pattern;       // true,
    public int row;            //3",
    public int columns;        //3",
    public int totalNoTickets; //20",
    public int userMaxTickets; //5",
    public int rangeMin;       //1",
    public int rangeMax;       //26",

    public string updatedAt;   //2020-08-28T06:19:13.321Z",
    public string createdAt;   //2020-08-28T06:19:13.321Z",
    public string _id;         //5f48a1f68bb33f51a37c2dae",
    public int __v;            //0
}

[Serializable]
public class TransactionHistory
{
    public string date = "";
    public float amount = 0;
    public string type = "";
    public string id = "";
    public string purchasedFrom = "";
    public string dateAndTime = "";
    public string status = "";
    public string uniqueReference = "";
}

[Serializable]
public class VerifyPasswordResponse
{
    public string bankAccountNumber = "";
}

[Serializable]
public class NotificationsData
{
    public string notificationType = "";
    public string message;
    public string notificationDateAndTime;
    public string ticketMessage = "";
    public string price;
    public string date;
}

[Serializable]
public class LeaderboardData
{
    public string nickname = "";
    public double points = 0;
}

[Serializable]
public class GameStatisticsResponse
{
    public GameStatistics game1;
    public GameStatistics game2;
    public GameStatistics game3;
    public GameStatistics game4;
    public GameStatistics game5;
}

[Serializable]
public class GameStatistics
{
    public int totalGamePlayed = 0;
    public int totalGameWon = 0;
    public int totalGameLost = 0;
    public int totalJackpotWon = 0;
}

[Serializable]
public class LastHourPL
{
    public double totalBet = 0;
    public double totalwinn = 0;
    public double totalloss = 0;
    public double lossProfit = 0;
}

[Serializable]
public class GetCardDetailsResponse
{
    public bool cardSaved = false;
    public string cardHolderName = "";
    public string cardNumber = "";
    public string cardExpiry = "";
    public string cvv = "";
}

[Serializable]
public class Game1PurchaseDataResponse
{
    public List<Game1TicketType> ticketTypeList = new List<Game1TicketType>();
    public int playerMaxQty = 0;
}

[Serializable]
public class Game1PurchasedTicketsList
{
    public List<Game1TicketSubTypeBuyData> list = new List<Game1TicketSubTypeBuyData>();
}

[Serializable]
public class Game1TicketSubTypeBuyData
{
    public string ticketType = "";
    public string ticketName = "";
    public int ticketQty = 0;

    public Game1TicketSubTypeBuyData() { }

    public Game1TicketSubTypeBuyData(string name, int qty)
    {
        ticketType = "";
        ticketName = name;
        ticketQty = qty;
    }

}

[Serializable]
public class GetLuckyNumber
{
    public bool isLuckyNumberEnabled;
    public int luckyNumber;
}

[Serializable]
public class Game1TicketType
{
    public string ticketType = "";
    public string ticketName = "";
    public int currentQty = 0;
    public int minQty = 1;
    public int maxQty = 2;
    public double price = 0;
}

[Serializable]
public class Game1TicketView
{
    public int ticketPrice;
    public string id, ticketNumber, ticketColor;
    public List<int> ticketCellNumberList;
}

[Serializable]
public class Game1TicketPurchase
{
    public string ticketName = "";
    public int ticketQty = 0;

    public Game1TicketPurchase() { }
    public Game1TicketPurchase(string name, int qty)
    {
        ticketName = name;
        ticketQty = qty;
    }

}


[Serializable]
public class GetGame3PurchaseDataResponse
{
    public int minQty = 1;
    public int maxQty = 2;
    public double price = 0;
}

[Serializable]
public class GameChatHistoryResponse
{
    public List<ChatData> history = new List<ChatData>();
    public int onlinePlayerCount = 0;
}

[Serializable]
public class OnlinePlayerCount
{
    public int onlinePlayerCount = 0;
}

[Serializable]
public class PlayerRegisteredCount
{
    public int playerRegisteredCount = 0;
}

[Serializable]
public class RefreshGame2TicketStatusData
{
    public bool isPurchased = false;
    public string playerIdOfPurchase = "";
    public List<string> ticketIdList = new List<string>();
}

[Serializable]
public class PlayerDataResponse
{
    public string playerId;
    public string points;
    public string realMoney;
}

[Serializable]
public class Game2RocketLaunchData
{
    /// <summary> Sub Game ID </summary>
    public string gameId = "";
}

[Serializable]
public class WheelOfFortuneData
{
    public List<long> prizeList = new List<long>();
    public string redMultiplierValue;
    public string blackMultiplierValue;
    public string greenMultiplierValue;
    public bool isGamePaused = false;
}

[Serializable]
public class WheelOfFortuneFinishedResponse
{
    public bool isWinningInPoints = true;
    public double points = 0;
    public double realMoney = 0;
}

[Serializable]
public class TreasureChestData
{
    public List<long> prizeList = new List<long>();
    public bool showAutoTurnCount = false;
    public bool isGamePaused = false;
}

[Serializable]
public class SelectTreasureChestResponse
{
    public bool isWinningInPoints = true;
    public long winningPrize = 0;
    public long actualTChestWinningPrize = 0;
    public double points = 0;
    public double realMoney = 0;
}


[Serializable]
public class SelectColorDraftIndex
{
    public string gameId = "";
    public int selectedIndex = 1;
    public string color = "";
    public long amount = 0;
    public string miniGameType = "";
    public int turnCount = 0;
    public bool isGameOver = false;
}

[Serializable]
public class selectMysteryBallResponse
{
    public string gameId;
    public int selectedNumber;
    public int turnCount;
    public bool isHigherNumber;
    public List<int> lastSelectedNumbers;
    public string miniGameType;
}

[Serializable]
public class MysteryGameData
{
    public List<long> prizeList = new List<long>();
    public int middleNumber = 45454;
    public int resultNumber = 54545;
    public bool showAutoTurnCount = false;
    public float autoTurnFirstMoveTime = 20;
    public float autoTurnOtherMovesTime = 10;
    public float autoTurnMoveTime = 10;
    public float autoTurnReconnectMovesTime = 0;
    public ReconnectMysteryGameData mysteryGameData;
    public bool isGamePaused = false;
}

[Serializable]
public class ReconnectMysteryGameData
{
    public List<MysteryGameHistory> history;
    public int turnCounts;
}

[Serializable]
public class MysteryGameHistory
{
    public string playerId;
    public bool isWon;
    public string isJocker;
    public int baseNumber;
    public int selectedNumber;
    public bool isHigherNumber;
}

[Serializable]
public class MysteryGameFinishedResponse
{
    public bool isWinningInPoints = true;
    public long winningPrize = 0;
    public double points = 0;
    public double realMoney = 0;
}

[Serializable]
public class MysteryGameFinishedBroadcastResponse
{
    public string gameId;
    public long amount;
    public long playerFinalWinningAmount;
    public string miniGameType;

}

[Serializable]
public class ColorDraftGameData
{
    public bool showAutoTurnCount = false;
    public int autoTurnMoveTime;
    public int autoTurnReconnectMovesTime;
    public ReconnectColorDraftGameData miniGameData;
    public bool isGamePaused = false;
}

[Serializable]
public class ReconnectColorDraftGameData
{
    public List<ColorDraftHistory> history;
    public int turnCounts;
}

[Serializable]
public class ColorDraftHistory
{
    public string playerId;
    public int selectedIndex;
    public string color;
    public long amount;
}

[Serializable]
public class colordraftGameFinished
{
    public string gameId;
    public string miniGameType;
    public double amount;
    public double playerFinalWinningAmount;
}

[Serializable]
public class startSpinWheelData
{
    public string gameId;
    public string ticketId;
    public int freeSpins;
    public string miniGameType;
}


[Serializable]
public class startRouletteWheelData
{
    public string gameId;
    public string ticketId;
    public string playerId;
    public RouletteSpinDetails spinDetails;
    public string miniGameType;
    public int rouletteStopAt;
    public bool isMinigameOver;
}

[Serializable]
public class RouletteSpinDetails
{
    public int totalSpins;
    public int playedSpins;
    public int currentSpinNumber;
    public List<SpinHistory> spinHistory;
}

[Serializable]
public class SpinHistory
{
    public int spinCount;
    public int rouletteBall;
    public int wonAmount;
}

[Serializable]
public class Game5MiniGameWinData
{
    public string gameId;
    public string ticketId;
    public string playerId;
    public int totalWonAmount;
    public string ticketColor;
    public List<int> ticket;
}

[Serializable]
public class Game4ThemesData
{
    public string assetBundleUrl = "";
    public uint version = 1;
}

[Serializable]
public class ApplyVoucherCodeResponse
{
    public double discount = 0;
    public double payableAmount = 0;
    public float percentageOff = 0;
}

[Serializable]
public class AdminHallExternalCallData
{
    public string token = ""; // consider this as roomId
    public string identifier = ""; //consider this as namespace
    public string displayMessage = "";
    public bool isDisplay = true; //consider this as namespace
    public string deviceType = "";
    public string language = "";
    public string hallId = "";
}

[Serializable]
public class GameType
{
    public string name, img;
    public GameType() { }
    public GameType(string gamename, string imgpath)
    {
        name = gamename;
        img = imgpath;
    }
}

[Serializable]
public class GameTypeList
{
    public List<GameType> gameList;
}

[Serializable]
public class AvailableGamesResult
{
    public GameStatusData game_2;
    public GameStatusData game_3;
    public GameStatusData game_4;
    public GameStatusData game_5;
}

[Serializable]
public class GameStatusData
{
    public string status;
    public string date;
    public string hall;
}

[Serializable]
public class IsHallClosed
{
    public bool isClosed;
}
[Serializable]
public class ConfirmationMessage
{
    public string en;
    public string nor;
}

[Serializable]
public class ExistingBlockRule
{
    public string hallId;
    public string hallName;
    public List<GameTypes> gameTypes;
    public List<int> days;
    public string endDate;
    public string ruleId;
}
[Serializable]
public class AvailableBlockRule
{
    public string hallId;
    public string hallName;
    public List<GameTypes> gameTypes;
    public List<int> days;
    public DateTime endDate;
    public string ruleId;
}
[Serializable]
public class GameTypes
{
    public string name;
    public List<string> subTypes;
}
[Serializable]
public class SettingResult
{
    public List<AvailableBlockRule> availableBlockOptions;
    public List<ExistingBlockRule> existingBlockRules;
    public ConfirmationMessage confirmationMessage;
}