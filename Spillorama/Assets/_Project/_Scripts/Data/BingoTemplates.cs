using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable]
public class NewDailyScheduleCreated
{
    public List<string> halls;
}

[Serializable]
public class Hall
{
    public Hall() { }

    public Hall(string hallName)
    {
        this.name = hallName;
    }

    public string name = "";
}


[Serializable]
public class HallListData
{
    public List<HallData> hallList;
    public List<string> countryList;
    public Versions versions;
    public RegisterInfoText registerInfoText;
}

[Serializable]
public class RegisterInfoText
{
    public string en = "";
    public string nor = "";
}

[Serializable]
public class Versions
{
    public double android_version;
    public double ios_version;
    public double windows_version;
    public double webgl_version;
}

[Serializable]
public class HallData
{
    public string name = "";
    public string _id = "";
    public string hallId = "";
    public string status = "";
    public bool isCurrentHall;
}

[Serializable]
public class TestingDeviceData
{
    public string deviceName = "";
    public string deviceId = "";
}

[Serializable]
public class GameData
{
    public string gameNumber = "";
    public string gameId = "";
    public string gameName = "";
    public string namespaceString = "namespace";
    public string startingTime = "";
    public List<string> halls = new List<string>();
}

[Serializable]
public class Game1Data
{
    /// <summary> Parent Game ID </summary>
    public string gameId = "";
    public string gameName = "";
    public string gameType = "";
    public int purchasedTickets = 0;
    public int maxPurchaseTicket = 30;
    public string namespaceString = "Game1";

    public void SetGame1Data(string gameID, string GameName, string type, int puchased, int max)
    {
        gameId = gameID;
        gameName = GameName;
        gameType = type;
        purchasedTickets = puchased;
        maxPurchaseTicket = max;
        namespaceString = "Game1";
    }

}

[Serializable]
public class Game1Room
{
    public Game1 runningGame;
    public Game1 upcomingGame;
}

[Serializable]
public class Game1
{
    public string gameName, gameId, status, gameType;
    public List<Game1_TicketType> ticketTypes;
    public int purchasedTickets, maxPurchaseTicket, replaceAmount, luckyNumber;
    public bool isCancelAllowed;
    public bool isTestGame = false;
}

[Serializable]
public class Game1_Timer
{
    public string gameId;
    public int count;
}

[Serializable]
public class Game1_TicketType
{
    public string name;
    public int price;
}

[Serializable]
public class Game2Data
{
    /// <summary> Parent Game ID </summary>
    public string gameId = "";
    public string gameName = "";
    public string namespaceString = "Game2";
    public bool isBreak;
    public string startBreakTime;
    public string endBreakTime;
}

[Serializable]
public class Game3Data
{
    /// <summary> Parent Game ID </summary>
    public string gameId = "";
    public string gameName = "";
    public string namespaceString = "Game3";
    public bool isBreak;
    public string startBreakTime;
    public string endBreakTime;
}

[Serializable]
public class Game2PurchasedTicketsCount
{
    public int purchasedTicketsCount;
}

[Serializable]
public class GamePlanRoomData : GameData
{
    public bool buyButton = true;
    public bool cancelButton = false;
    public bool playButton = false;
}

[Serializable]
public class Game2PlanList
{
    public List<Game2UpcomingGames> upcomingGames = new List<Game2UpcomingGames>();
}

[Serializable]
public class Game2UpcomingGames
{
    public string name, id;
    public int purchasedTicket, maxTicket, luckyNumber, ticketPrice;
    public bool cancelButton;
}

[Serializable]
public class Game3PlanList
{
    public List<Game3UpcomingGames> upcomingGames = new List<Game3UpcomingGames>();
}

[Serializable]
public class Game3UpcomingGames
{
    public string name, id;
    public int purchasedTicket, maxTicket, luckyNumber, ticketPrice;
    public bool cancelButton;
}

[Serializable]
public class ChatData
{
    public string playerId = "";
    public string profilePic = "";
    public string name = "";
    public string message = "";
    public int emojiId = 0;
    public string dateTime = "";
}

[Serializable]
public class PlayerProfileSpriteData
{
    public string playerId = "";
    public Sprite sprite = null;
    public string profilePic = "";
    public string lastprofilePicUrl = "";
}

[Serializable]
public class Game2TicketForPurchaseResponse
{
    public int ownPurchasedTicketCount = 0;
    public bool autoPlay = false;
    public int luckyNumber = 0;
    public double ticketPrice = 0;
    public int totalTicketsPurchased = 0;
    public bool rocketLaunch = false;
    public int minimumTicket;
    public List<Game2TicketData> ticketList = new List<Game2TicketData>();
}

[Serializable]
public class UpdateGame2Tickets
{
    public string status = "";
    public List<Game2TicketData> result = new List<Game2TicketData>();
    public string message;
}

[Serializable]
public class BingoNumberData
{
    public int number = 0;
    public int nextNumber = 0;
    public string color = "";
    public string nextColor = "";
    public int totalWithdrawCount = 0;
    public bool isForPlayerApp;
}

[Serializable]
public class JackpotData
{
    public string type = "jackpot";
    public string number = "0";
    public double prize = 0;
}

[Serializable]
public class JackpotBroadcast
{
    public List<JackpotData> jackpotList = new List<JackpotData>();
}

[Serializable]
public class AdminHallDisplayGameHistory : AdminHallDisplayResult
{
    public string gameStatus = "Waiting";
    public List<BingoNumberData> withdrawNumberList = new List<BingoNumberData>();
    public List<AdminDashboardWinningData> winningList = new List<AdminDashboardWinningData>();
    public string gameName = "";
    public string gameId = "";
    public bool isGamePaused = false;
    public string pauseGameMessage;
    public string countDownDateTime;
    public int gameCount = 0, totalBallsDrawn = 0;
    public MinigameData minigameData;
    public BingoNumberData nextNumber;
    public AdminHallDisplayResult gameFinishAdminData;
    public JackPotData jackPotData;
    public PauseGameStats pauseGameStats;
    public List<WinningTicket> winningTickets;
    public NextGame nextGame;
    public string hallId = "";
    public bool isMinigameData;
}

[Serializable]
public class NextGame
{
    public string gameName = "";
    public int sequence = 0;
}

[Serializable]
public class PauseGameStats
{
    public bool isPausedBySystem;
    public bool isBingoAnnounced;
    public bool isWithoutAnnouncement;
}

[Serializable]
public class TvJackpotData
{
    public int draw = 57;
    public int winningAmount = 10;
    public bool isDisplay = true;
    public int tvScreenWinningAmount = 10;
    public bool isDisplayOnTVScreen = true;
}

[Serializable]
public class MinigameData
{
    public string gameName;
    public string playerId;
    public bool isMinigamePlayed;
    public bool isDisplayWheel;
    public bool isWofSpinStopped;
    public bool isMinigameActivated;
    public bool isMinigameFinished;
    public bool isForAdmin;
    public long wonAmount = 0;
    public int turnTimer = 10;
    public WinningTicketNumbers winningTicketNumbers;
    public List<long> prizeList = new List<long>();
    public bool showAutoTurnCount = false;
    public int remainingStopTimer = 0;
}

[Serializable]
public class BingoGame1History
{
    public string gameId = "";
    public string gameName = "";
    public bool editLuckyNumber = false;
    public bool isReplaceDisabled = false;
    public bool isGamePaused = false;
    public int luckyNumber = 0;
    public int activePlayers = 0;

    public int totalBetAmount = 0;
    public int totalWon = 0;
    public int totalWithdrawCount = 0;
    public int maxWithdrawCount = 0;
    public int replaceAmount = 0;
    public string gameStatus;
    public string pauseGameMessage;
    public int gameCount;
    public int disableBuyAfterBalls;
    public string countDownDateTime;
    public bool isTestGame = false;
    public List<PatternData> patternList = new List<PatternData>();
    public List<BingoNumberData> withdrawNumberList = new List<BingoNumberData>();
    public List<GameTicketData> ticketList = new List<GameTicketData>();
    public JackPotData jackPotData;
    public MinigameData minigameData;
}

[Serializable]
public class NextGameData
{
    public string gameId;
    public string countDownTime;
}

[Serializable]
public class JackPotData
{
    public bool isDisplay = false;
    public int draw;
    public int winningAmount;
    public int tvScreenWinningAmount = 10;
    public bool isDisplayOnTVScreen = false;
    public List<int> prizeArray = new List<int>();
}

[Serializable]
public class BingoGame2History
{
    public string gameId = "";
    public string subGameId = "";
    public int luckyNumber = 0;
    public int totalBetAmount = 0;
    public bool autoPlay = false;
    public int activePlayers = 0;
    public int totalWithdrawCount = 0;
    public int maxWithdrawCount = 21;
    public bool gameStarted = false;
    public bool disableCancelButton = false;
    public List<JackpotData> jackpotList = new List<JackpotData>();
    public List<BingoNumberData> withdrawNumberList = new List<BingoNumberData>();
    public List<GameTicketData> ticketList = new List<GameTicketData>();
    public bool isSoundPlay = false;
}

[Serializable]
public class BingoGame3History
{
    public string gameId = "";
    public string gameName = "";
    public string subGameId = "";
    public bool editLuckyNumber = false;
    public int luckyNumber = 0;
    public int activePlayers = 0;
    public int totalWithdrawCount = 0;
    public int totalBetAmount = 0;
    public int totalWon = 0;
    public int maxWithdrawCount = 0;
    public int gameCount = 0;
    public bool disableCancelButton;

    public List<JackpotData> jackpotList = new List<JackpotData>();
    public List<PatternData> patternList = new List<PatternData>();
    public List<BingoNumberData> withdrawNumberList = new List<BingoNumberData>();
    public List<GameTicketData> ticketList = new List<GameTicketData>();
    public JackPotData jackPotData;
    public bool isSoundPlay = false;
}

[Serializable]
public class Game3JackpotList
{
    public string GroupName;
    public List<PatternDatum> PatternData { get; set; }
}

[Serializable]
public class PatternDatum
{
    public string patternName, groupName, patternId, ballNumber, prize, patternType;
}

[Serializable]
public class Game3GameStart
{
    public int luckyNumber = 0;
}

[Serializable]
public class RefreshRoom
{
    /// <summary> Parent Game ID </summary>
    public string gameId;
}

[Serializable]
public class toggleGameStatus
{
    /// <summary> Parent Game ID </summary>
    public string gameId;
    public string status;
    public string message = "";
    public bool bySystem;
    public bool isPauseWithoutAnnouncement;
}

[Serializable]
public class BingoAnnouncementResponse
{
    /// <summary> Parent Game ID </summary>
    public string gameId;
    public string status;
    public string message = "";
    public bool bySystem;
}

[Serializable]
public class BingoGameFinishResponse
{
    public string gameId = "";
    public string message = "";
    public string winningAmount = "";
}

[Serializable]
public class BingoGame5FinishResponse
{
    public string gameId;
    public List<WinningPattern> winningPatterns;
    public int totalWonAmount;
    public bool isWon;
    public string winningAmount = "";
}

[Serializable]
public class WinningPattern
{
    public string ticketId;
    public PatternList pattern;
    public int wonAmount;
    public string ticketColor;
}

[Serializable]
public class GameTerminateResponse
{
    public string gameId = "";
    public string message = "";
}

[Serializable]
public class ActivateMiniGameResponse
{
    public string gameId = "", miniGameType = "", playerId = "";
    public bool isForAdmin;
}

[Serializable]
public class ActivateGame5JackpotMiniGameResponse
{
    public string gameId;
    public string playerId;
    public string ticketId;
    public string miniGameType;
    public string ticketColor;
    public List<int> ticket;
    public SpinDetails spinDetails;
    public List<RouletteData> rouletteData;
}

[Serializable]
public class SpinDetails
{
    public int totalSpins;
    public int playedSpins;
    public int currentSpinNumber;
    public List<SpinHistory> spinHistory;
}

[Serializable]
public class RouletteData
{
    public int number;
    public string color;
}

[Serializable]
public class adminExtraGameNotiResponce
{
    public string gameType;
    public adminExtraWinner winner;
    public string message;
}

[Serializable]
public class adminExtraWinner
{
    public List<string> ticketNumbers;
}

[Serializable]
public class Game4Data
{
    public string status;
    public string gameId = "";
    public List<Game4PatternData> patternList = new List<Game4PatternData>();
    public List<GameTicketData> ticketList = new List<GameTicketData>();
    public List<string> parsedTicketList = new List<string>();

    public BetData betData;
    public int ticketPrice = 1;
    public int totalAmountOfTickets;
    public string first18BallTime = "1";
    public string last15BallTime = "1";
    public bool isBreak;
    public string startBreakTime;
    public string endBreakTime;
    public bool isSoundPlay = true;
    public Game4PlayResponse response;
}

[Serializable]
public class Game5Data
{
    public string gameId;
    public List<PatternList> patternList = new List<PatternList>();
    public List<TicketList> ticketList;
    public List<int> coins;
    public List<BingoNumberData> withdrawBalls;
    public List<int> rouletteData;
    public string status;
    public int totalWithdrawableBalls = 17;
    public int maximumBetAmount;
    public int BallDrawTime = 2;
    public MiniGameData miniGameData;
    public bool isSoundPlay = true;
}


[Serializable]
public class MiniGameData
{
    public string gameType;
    public string ticketId;
    public bool isMiniGameActivated;
    public bool isMiniGamePlayed;
    public bool isMiniGameFinished;
    public int autoTurnMoveTime;
    public int autoTurnReconnectMovesTime;
    public bool isMiniGameSpinning;
    public int rouletteSpinRemaningTime;
    public Game5MiniGameData gameData;
}

[Serializable]
public class Game5MiniGameData
{
    public List<int> wofPrizeList;
    public WofWinnings wofWinnings;
    public List<RouletteData> roulettePrizeList;
    public SpinDetails spinDetails;
}

[Serializable]
public class MiniWofGameData
{
    public List<int> prizeList;
    public WofWinnings wofWinnings;
}

[Serializable]
public class WofWinnings
{
    public int wofSpins;
    public int playedSpins;
}

[Serializable]
public class TicketList
{
    public string id;
    public List<int> ticket;
    public string color;
    public string ticketId;
    public string hallName;
    public string supplierName;
    public string developerName;
    public int price;
}

[Serializable]
public class PatternList
{
    public string multiplier;
    public List<int> pattern;
    public string extraWinningsType;
}

[Serializable]
public class BetData
{
    public List<int> ticket1Multiplier = new List<int>();
    public List<int> ticket2Multiplier = new List<int>();
    public List<int> ticket3Multiplier = new List<int>();
    public List<int> ticket4Multiplier = new List<int>();
}

[Serializable]
public class Game4WinningTicketData
{
    public string ticketId = "";
    public List<string> winningPatternIdList = new List<string>();
    public List<int> row1L_2L_winningPattern;
    public double winningAmount = 0;
}

[Serializable]
public class Game4PlayResponse
{
    public List<string> currentTicketIdList = new List<string>();
    public List<int> withdrawNumberList = new List<int>();
    public long winningPrize = 0;
    public List<GameTicketData> ticketList = new List<GameTicketData>();
    public List<Game4WinningTicketData> winningTicketList = new List<Game4WinningTicketData>();
    public string miniGameId = "";

    public double points = 0;
    public double realMoney = 0;
    public double todaysBalance = 0;

    public double pointsAfterWinning = 0;
    public double realMoneyAfterWinning = 0;
    public bool extraGamePlay = false;
    public int ballsShouldBeWithdrawn = 0;
    public bool isSoundPlay = false;

}

[Serializable]
public class Sound
{
    public string name;

    public AudioClip clip;

    [Range(0f, 1f)]
    public float volume = 1;

    public bool loop = false;

    [HideInInspector]
    public AudioSource source;
}

[Serializable]
public class Game4PatternSpriteData
{
    public string patternId = "";
    public string patternName = "";
    public Sprite patternSprite = null;
    public Color32 Color32;
}

[Serializable]
public class NotificationBroadcast
{
    public string notificationType = "";
    public string message = "";
}

[Serializable]
public class ForceLogoutBroadcast
{
    public string playerId = "";
    public string message = "";
}

[Serializable]
public class refreshPaymentPage
{
    public string url;
}
[Serializable]
public class PlayerVerification
{
    public bool canPlayGames;
    public bool isVerifiedByBankID;
    public bool isVerifiedByHall;
    public bool isBankIdReverificationNeeded;
    public string idExpiryDate;
}

[Serializable]
public class VoucherData
{
    public string id = "";
    public string expiryDate = "";
    public string voucherCode = "";
    public float percentageOff = 0;
    public int redeemPoints = 0;
    public bool redeemed = false;
}

[Serializable]
public class TicketColorData
{
    public string name = "default";
    public Color32 colorTextLabels;
    public Color32 colorTicket;
    public Color32 colorGrid;
    public Color32 colorGridMarker;
    public Color32 colorNormalText;
    public Color32 colorMarkerText;
    public Color32 colorLuckyNumberText;
}

[Serializable]
public class GameListRefresh
{
    public int gameType = 0;
}


[Serializable]
public class AdminDashboardWinningData
{
    public string id = "";
    public string displayName = "";
    public int winnerCount = 0;
    public double prize = 0;
    public List<WinningTicket> winningTickets;
}
[Serializable]
public class WinningTicket
{
    public List<string> numbers;
    public string patternName;
    //public List<int> snumbers = new List<int>();
}
[Serializable]
public class AdminHallDisplayResult
{
    public int totalWithdrawCount = 0;
    public int fullHouseWinners = 0;
    public int patternsWon = 0;
    public List<Winner> winners;
}

[Serializable]
public class Winner
{
    //public string lineType;
    //public List<HallSpecificWinner> hallSpecificWinners;
    //public List<PlayerTypeSpecificWinner> playerTypeSpecificWinners;
    //public int count;

    public string lineType;
    public int finalWonAmount;
    public List<PlayerIdArray> playerIdArray;
    public int count;
    public List<string> halls;
}

[Serializable]
public class PlayerIdArray
{
    public string playerId;
    public string userType;
    public string hallName;
    public string ticketNumber;
    public string playerName;
    public int wonAmount;
}

[Serializable]
public class HallSpecificWinner
{
    public string hallName;
    public int count;
}

[Serializable]
public class PlayerTypeSpecificWinner
{
    public string userType;
    public int count;
}

[Serializable]
public class GameTimer
{
    public int remainingTime, totalSeconds;
}

[Serializable]
public class BreakTime
{
    public bool isBreak;
    public string startBreakTime;
    public string endBreakTime;
    public string gameType;
}
[Serializable]
public class CheckBreakTime
{
    public bool isBreak;
    public string startBreakTime;
    public string endBreakTime;
}

[Serializable]
public class ClaimWinningResponse
{
    public List<Ticket> ticket = new List<Ticket>();
    public string ticketNumber = "";
    public int totalWithdrawCount = 0;
    public List<UnclaimedWinners> unclaimedWinners = new List<UnclaimedWinners>();
    public List<ClaimWinner> winners = new List<ClaimWinner>();
    public string hallId = "";
}

[Serializable]
public class ClaimWinner
{
    public string lineType = "";
    public int wonAmount = 0;
    public bool showPrize = false;
    public bool isWinningDistributed = false;
}

[Serializable]
public class Ticket
{
    public int Number = 0;
    public bool show = false;
}

[Serializable]
public class UnclaimedWinners
{
    public string lineType = "";
    public int withdrawBall = 0;
    public int withdrawBallCount = 0;
    public int totalWithdrawCount = 0;
}