using I2.Loc;
using UnityEngine;

public class Constants : MonoBehaviour
{
    public const string BANK_ID = "ais";
    public const string EMAIL_REQUIRED = "The email is empty or invalid";

    public class ServerDetails
    {
        public static string ProductionBaseUrl = "https://bingoadmin.aistechnolabs.pro";
        public static string StagingUrl = "https://bingoadmin.aistechnolabs.pro";
        public static string InfogUrl = "https://spillorama.aistechnolabs.info";
        public static string DevelopmentUrl = "https://bingoadmin.aistechnolabs.in";//"http://192.168.1.228:3007";
        public static string NGRockUrl = "https://unuseable-branden-disgustedly.ngrok-free.dev";
        // public static string LocalURL = "http://localhost:3007";
        public static string LocalURL = "http://192.168.1.42:3002";
        //public static string LocalURL = "http://192.168.2.42:3007";//kp

        public static string BaseUrl
        {
            get
            {
                switch (GameSocketManager.Instance.server)
                {
                    case SERVER.Live:
                        return ProductionBaseUrl;
                    case SERVER.Staging:
                        return StagingUrl;
                    case SERVER.Info:
                        return InfogUrl;
                    case SERVER.Development:
                        return DevelopmentUrl;
                    case SERVER.NGRock:
                        return NGRockUrl;
                    case SERVER.Local:
                        return LocalURL;
                    case SERVER.Custom:
                        return PlayerPrefs.GetString("CUSTOM_URL");
                    case SERVER.DynamicWebgl:
                        return PlayerPrefs.GetString("DYNAMIC_WEBGL_URL", ProductionBaseUrl);
                }
                return StagingUrl;
            }
        }
    }

    public class EventStatus
    {
        public static string SUCCESS = "success";
        public static string RUNNING = "running";
        public static string OFFLINESUCCESS = "offline-success";
        public static string FAIL = "fail";
        public static string LOGOUT = "logout";
    }

    public class MessageType
    {
        public static string SomethingWentWrong = "Something Went Wrong";
    }

    public class BroadcastName
    {
        public const string ForceLogout = "ForceLogout";

        public const string GameChat = "GameChat";
        public const string GameOnlinePlayerCount = "GameOnlinePlayerCount";
        public const string RefreshGame2TicketStatus = "RefreshGame2TicketStatus";
        public const string Game2RocketLaunch = "Game2RocketLaunch";
        public const string Game2PurchasedTicketsCount = "game2PurchasedTicketsCount";
        public const string refreshUpcomingGames = "refreshUpcomingGames";
        public const string SubscribeRoom = "SubscribeRoom";
        public const string SubscribeRoomAdmin = "SubscribeRoomAdmin";
        public const string GameStartWaiting = "GameStartWaiting";
        public const string countDownToStartTheGame = "countDownToStartTheGame";
        public const string GameStart = "GameStart";
        public const string JackpotList = "JackpotList";
        public const string PatternChange = "PatternChange";
        public const string TicketCompleted = "TicketCompleted";
        public const string UpdateProfitAmount = "UpdateProfitAmount";
        public const string PatternWin = "PatternWin";
        public const string PatternCompleted = "PatternCompleted";
        public const string WithdrawBingoBall = "WithdrawBingoBall";
        public const string GameFinish = "GameFinish";
        public const string GameFinishAdmin = "GameFinishAdmin";
        public const string UpdatePlayerRegisteredCount = "UpdatePlayerRegisteredCount";
        public const string GameListRefresh = "GameListRefresh";
        public const string GameTerminate = "GameTerminate";
        public const string ActivateMiniGame = "ActivateMiniGame";
        public const string BingoWinning = "BingoWinning";
        public const string BingoWinningAdmin = "BingoWinningAdmin";
        public const string GameStartTimer = "StartTimer";
        public const string GameRefreshRoom = "RefreshRoom";
        public const string toggleGameStatus = "toggleGameStatus";
        public const string BingoAnnouncement = "BingoAnnouncement";
        public const string nextGameStartCountDownTime = "nextGameStartCountDownTime";
        public const string JackpotListUpdate = "JackpotListUpdate";
        public const string BreakTimeStart = "breakTimeStart";
        public const string TVScreenGameRefreshRoom = "adminRefreshRoom";
        public const string adminExtraGameNoti = "adminExtraGameNoti";

        public const string Game4Winner = "Game4Winner";

        public const string closePaymentPage = "closePaymentPage";
        public const string refreshPaymentPage = "refreshPaymentPage";
        public const string NotificationBroadcast = "NotificationBroadcast";
        public const string playerVerificationStatus = "playerVerificationStatus";
        public const string playerApprovedHalls = "playerApprovedHalls";
        public const string PlayerHallLimit = "PlayerHallLimit";
        public const string Game1Status = "Game1Status";
        public const string AvailableGames = "AvailableGames";
        public const string checkGameStatus = "checkGameStatus";
        public const string StartSpinWheel = "startSpinWheel";
        public const string StopSpinWheel = "stopSpinWheel";
        public const string OpenTreasureChest = "openTreasureChest";
        public const string SelectMysteryBall = "selectMysteryBall";
        public const string mysteryGameFinished = "mysteryGameFinished";
        public const string mysteryGameFinishedAdmin = "mysteryGameFinishedAdmin";

        public const string selectColorDraftIndex = "selectColorDraftIndex";
        public const string colordraftGameFinished = "colordraftGameFinished";
        public const string colordraftGameFinishedAdmin = "colordraftGameFinishedAdmin";
        public const string newDailyScheduleCreated = "newDailyScheduleCreated";


        public const string startSpinWheel = "startSpinWheel";
        public const string totalGameWinnings = "totalGameWinnings";
        public const string jackpotsWinnigs = "jackpotsWinnigs";
        public const string rouletteWinnigs = "rouletteWinnigs";
        public const string totalMinigameWinnings = "totalMinigameWinnings";

        public const string updateScreenSaver = "updateScreenSaver";
        public const string playerClaimWinner = "playerClaimWinner";
    }

    public class LanguageKey
    {

        public static string GetTranslation(string key)
        {
            string translation = LocalizationManager.GetTranslation(key);
            if (string.IsNullOrEmpty(translation))
            {
                // Handle case where translation is not found
                translation = "LngErr - " + key;
            }
            return translation;
        }

        // Login
        public static string LogsActivatedMessage => LocalizationManager.GetTranslation("Logs Activated!");
        public static string ExitGameMessage => LocalizationManager.GetTranslation("Exit Game");
        public static string UpdateMessage => LocalizationManager.GetTranslation("Update");
        public static string LoginMessage => LocalizationManager.GetTranslation("Login");
        public static string CancelMessage => LocalizationManager.GetTranslation("Cancel");
        public static string ContinueMessage => LocalizationManager.GetTranslation("Continue");
        public static string LogoutMessage => LocalizationManager.GetTranslation("Logout");
        public static string SamePlayerLoginConfirmationMessage => LocalizationManager.GetTranslation("Same player is already logged in from another device, are you sure you want to login?");
        public static string CantFetchMessage => LocalizationManager.GetTranslation("Can't fetch");
        // public static string PleaseEnterUsernamePhoneNumberMessage => LocalizationManager.GetTranslation("Please enter Username/Phone number/FirstName");
        public static string PleaseEnterUsernamePhoneNumberMessage => LocalizationManager.GetTranslation("Please enter Username/Phone number");
        public static string PleaseEnterPasswordMessage => LocalizationManager.GetTranslation("Please enter Password");
        public static string MinimumPasswordLengthMessage => LocalizationManager.GetTranslation("Minimum password length should be");
        public static string BankIdInvalidMessage => LocalizationManager.GetTranslation("Bank id is invalid");

        // Signup
        public static string DatOfBirthInvalid => LocalizationManager.GetTranslation("Date of Birth is invalid");
        public static string DateInvalid => LocalizationManager.GetTranslation("Date is invalid");
        public static string PleaseEnterFirstName => LocalizationManager.GetTranslation("Please enter FirstName");
        public static string MinimumFirstNameLength => LocalizationManager.GetTranslation("Minimum FirstName length should be");
        public static string PleaseEnterLastName => LocalizationManager.GetTranslation("Please enter LastName");
        public static string PleaseEnterUsernameMessage => LocalizationManager.GetTranslation("Please enter Username");
        public static string MinimumUsernameLengthMessage => LocalizationManager.GetTranslation("Minimum username length should be");
        public static string InvalidUsernameFormatMessage => LocalizationManager.GetTranslation("User name is invalid only alphabets, numbers and underscore is allowed and must start with alphabet");
        public static string SpaceNotAllowedInPassword => LocalizationManager.GetTranslation("Space is not allowed in password");
        public static string PleaseEnterDateOfBirth => LocalizationManager.GetTranslation("Please enter Date of Birth");
        public static string PleaseEnterMobileNumber => LocalizationManager.GetTranslation("Please enter Mobile number");
        public static string MinimumMobileNumberLengthMessage => LocalizationManager.GetTranslation("Minimum mobile number length should be");
        public static string PleaseEnterEmailId => LocalizationManager.GetTranslation("Please enter email id");
        public static string InvalidEmailMessage => LocalizationManager.GetTranslation("Email is invalid");
        public static string PleaseSelectHall => LocalizationManager.GetTranslation("Please Select Hall");
        public static string PleaseSelectCountry => LocalizationManager.GetTranslation("Please Select Country");
        public static string PleaseSelectPEPIncomeUsedToPlay => LocalizationManager.GetTranslation("Please select atleast one option from What type of income will be used to play?");
        public static string PleaseSelectIsPlayerPEP => LocalizationManager.GetTranslation("Please select if you are PEP Player");
        public static string PleaseSelectIsPlayerNorwayResident => LocalizationManager.GetTranslation("Please select if you are Resident of Norway");
        public static string PleaseEnterPEPName => LocalizationManager.GetTranslation("Please enter name of PEP");
        public static string PleaseEnterRelationPEPName => LocalizationManager.GetTranslation("Please enter your relation to PEP");
        public static string PleaseSelectAddress => LocalizationManager.GetTranslation("Please select if you are residential of Norway");
        public static string PleaseInputCityName => LocalizationManager.GetTranslation("Please enter City Name");
        public static string PleaseInputZipCode => LocalizationManager.GetTranslation("Please enter Zip Code");
        public static string PleaseInputAddress => LocalizationManager.GetTranslation("Please enter Address");
        public static string PleaseUploadPhotoId => LocalizationManager.GetTranslation("Please upload photo id");
        public static string PleaseUploadFrontPhotoId => LocalizationManager.GetTranslation("Please upload front photo id");
        public static string PleaseUploadBackPhotoId => LocalizationManager.GetTranslation("Please upload back photo id");
        public static string FrontAndBackPhotoIdsSameMessage => LocalizationManager.GetTranslation("Both front and back photo ids are same");
        public static string SizeMustBeLessThan => LocalizationManager.GetTranslation("Size must be less than");


        // Forget Password
        public static string PleaseEnterEmailOrMobileNumberMessage => LocalizationManager.GetTranslation("Please enter email id or Mobile Number");
        public static string PleaseEnterEmailOrUsernameMessage => LocalizationManager.GetTranslation("Please enter email id or username");
        public static string InvalidEmailOrUsernameMessage => LocalizationManager.GetTranslation("Invalid email id or username");
        public static string InvalidEmailOrmobileNumberMessage => LocalizationManager.GetTranslation("Invalid email id or Mobile Number");

        // Profile
        public static string DeleteConfirmationMessage => LocalizationManager.GetTranslation("Are you sure you want to delete?");
        public static string MinimumCurrentPasswordLengthMessage => LocalizationManager.GetTranslation("Minimum current password length should be");
        public static string MinimumNewPasswordLengthMessage => LocalizationManager.GetTranslation("Minimum new password length should be");
        public static string MinimumConfirmNewPasswordLengthMessage => LocalizationManager.GetTranslation("Minimum confirm new password length should be");
        public static string NewPasswordMismatchMessage => LocalizationManager.GetTranslation("new password & confirm new password should be same");

        //Lobby
        public static string GameIsClosedMessage => LocalizationManager.GetTranslation("Game is Closed wait for it");
        public static string NoOngoingGameMessage => LocalizationManager.GetTranslation("There is no ongoing game. Please try again later");


        //General
        public static string NoInternetConnectionMessage => LocalizationManager.GetTranslation("No Internet Connection");
        public static string InternetIssueMessage => LocalizationManager.GetTranslation("Internet issue.");
        public static string ReconnectWithServerMessage => LocalizationManager.GetTranslation("Trying to reconnect with server");
        public static string LoadingMessage => LocalizationManager.GetTranslation("Loading");
        public static string DownloadingMessage => LocalizationManager.GetTranslation("Downloading");
        public static string OkMessage => LocalizationManager.GetTranslation("Ok");
        public static string YesMessage => LocalizationManager.GetTranslation("Yes");
        public static string NoMessage => LocalizationManager.GetTranslation("No");

        //Games
        public static string GameFinishMessage => LocalizationManager.GetTranslation("Game Finish");
        public static string SelectAtLeastOneTicketMessage => LocalizationManager.GetTranslation("Select at least one ticket to go further");
        public static string TicketNotAvailableMessage => LocalizationManager.GetTranslation("Ticket not available");
        public static string LuckyNumberNotSelectedMessage => LocalizationManager.GetTranslation("You haven't selected lucky number yet. If you press continue, then system will select lucky number on your behalf.");
        public static string CancelConfirmationMessage => LocalizationManager.GetTranslation("Are you sure you want to cancel?");
        public static string BetterLuckMessage => LocalizationManager.GetTranslation("Better luck next time");
        public static string CongratulationsMessage => LocalizationManager.GetTranslation("Congratulations! You have won");
        public static string TicketNumberMessage => LocalizationManager.GetTranslation("on ticket number");
        public static string JackpotMessage => LocalizationManager.GetTranslation("in Jackpot");
        public static string TotalGameWinningMessage => LocalizationManager.GetTranslation("in Total Game Winning");
        public static string SpinText => LocalizationManager.GetTranslation("Spin");
        public static string RemainingSpinsMessage => LocalizationManager.GetTranslation("Remaining Spins");
        public static string InRouletteMessage => LocalizationManager.GetTranslation("in Roulette");
        public static string StartMessage => LocalizationManager.GetTranslation("Start");
        public static string OpenMessage => LocalizationManager.GetTranslation("Open");
        public static string ClosedMessage => LocalizationManager.GetTranslation("Closed");
        public static string PreOrderForTodaysGame => LocalizationManager.GetTranslation("Pre Order for todays game");
        public static string PlayNowGame => LocalizationManager.GetTranslation("Play");
        public static string Bingo => LocalizationManager.GetTranslation("BINGO");

        //Notifications 
        public static string GameStartReminderMessage => LocalizationManager.GetTranslation("gameStartReminder");
        public static string GameFinishTitleMessage => LocalizationManager.GetTranslation("gameFinish");
        public static string RefundTicketsMessage => LocalizationManager.GetTranslation("Refund Tickets");
        public static string GameStartReminderTitleMessage => LocalizationManager.GetTranslation("Game Start Reminder");
        public static string CancelTicketsMessage => LocalizationManager.GetTranslation("cancelTickets");
        public static string PatternWinMessage => LocalizationManager.GetTranslation("Pattern Win");
        public static string PatternWinLowercaseMessage => LocalizationManager.GetTranslation("patternWin");
        public static string RefundTicketsTitleMessage => LocalizationManager.GetTranslation("refundTickets");
        public static string PurchasedTicketsMessage => LocalizationManager.GetTranslation("purchasedTickets");
        public static string WinningMessage => LocalizationManager.GetTranslation("winning");
        public static string PurchasedTicketsTitleMessage => LocalizationManager.GetTranslation("Purchased Tickets");
        public static string CancelTicketsTitleMessage => LocalizationManager.GetTranslation("Cancel Tickets");
        public static string GameStartByAdminMessage => LocalizationManager.GetTranslation("gameStartByAdmin");
        public static string GamePausedByAdminMessage => LocalizationManager.GetTranslation("Checking the claimed tickets");
        public static string GameResumedByAdminMessage => LocalizationManager.GetTranslation("Game has been Resumed");
        public static string FrontUploadImg => LocalizationManager.GetTranslation("You have not uploaded any front image. Please upload front image.");
        public static string BackUploadImg => LocalizationManager.GetTranslation("You have not uploaded any back image. Please upload back image.");
        public static string DeleteTicketsConfirmationMessage => LocalizationManager.GetTranslation("Are you sure you want to delete these Tickets?");
        public static string DeleteTicketConfirmationMessage => LocalizationManager.GetTranslation("Are you sure you want to delete this Ticket?");
        public static string ReplaceTicketConfirmationMessage => LocalizationManager.GetTranslation("Are you sure you want to replace this Ticket?");
        public static string PatternCompletedMessage => LocalizationManager.GetTranslation("Pattern Completed!");
        public static string FullHouseCompletedMessage => LocalizationManager.GetTranslation("Full House Completed!");
        public static string PendingMessage => LocalizationManager.GetTranslation("Pending");
        public static string SuccessMessage => LocalizationManager.GetTranslation("Success");
        public static string RejectedMessage => LocalizationManager.GetTranslation("Rejected");
        public static string RefundedMessage => LocalizationManager.GetTranslation("Refunded");
        public static string PleaseSelectGameType => LocalizationManager.GetTranslation("Please Select Game Type");
        public static string PleaseSelectSubGameType => LocalizationManager.GetTranslation("Please Select Sub Game Type");
        public static string PleaseSelectDay => LocalizationManager.GetTranslation("Please Select Day");
        public static string SelectDays => LocalizationManager.GetTranslation("Select Days");
        public static string Days => LocalizationManager.GetTranslation("Days");
        public static string ChooseAll => LocalizationManager.GetTranslation("Choose All");
        public static string Everything => LocalizationManager.GetTranslation("Everything");
        public static string Processing => LocalizationManager.GetTranslation("Processing");
        public static string NoCameraDetected => LocalizationManager.GetTranslation("No camera detected on this device");
        public static string CameraNotRunning => LocalizationManager.GetTranslation("Camera not running on this device");
        public static string WonMessage => LocalizationManager.GetTranslation("Won");
        public static string ForceLogoutMessage => LocalizationManager.GetTranslation("You are logged off due to login from another device.");
    }


    public class InputData
    {
        public static int minimumUsernameLength = 3;
        public static int mobileNumberLength = 8;
        public static int minimumNicknameLength = 3;
        public static int minimumPasswordLength = 6;
        public static int minimumSurnameLength = 3;
    }

    public class StringClass
    {
        public static string currencySymbol = "kr";
    }

    #region Enums
    public enum SERVER
    {
        Live,
        Staging,
        Info,
        Development,
        NGRock,
        Local,
        Custom,
        DynamicWebgl
    }

    public enum GAME_STATUS
    {
        Waiting,
        Running,
        Finished
    }

    public enum TRANSACTION_TYPE
    {
        gameJoined,
        gameWon
    }

    public enum NOTIFICATION_TYPE
    {
        refundTickets,
        gameStartReminder,
        gameStartByAdmin,
        gameDeletedByAdmin,
        winning
    }

    public enum Game1SubTypes
    {
        elvis,
        mystery,
        oneThreeFive,
        trafficeLight,
        tvExtra,
        jackpot,
        innstanten,
        oddsen,
        lykkehjulet,
        spillernesSpill,
        kvikkisFullBong,
        superNils,
        oneThousandSpills,
        fargekladden,
        skattekisten,
        ballX10,
        fiveHundredSpills,
        fiveHundredX5,
        extra,
        jocker,
        twoThousandFiveHundredInFull,
        fourThousandInFull,
        finale
    }

    public enum Game1TicketTypes
    {
        smallWhite,
        largeWhite,
        smallYellow,
        largeYellow,
        smallPurple,
        largePurple,
        smallBlue,
        largeBlue,
        red,
        green,
        blue,
        elvis1,
        elvis2,
        elvis3,
        elvis4,
        elvis5
    }
    #endregion
}

public class PlayerLoginConstans
{
    public const int RememberMeEnabled = 1;
    public const int RememberMeDisabled = 0;

    public const string EMAILUSERNAME = "EMAILUSERNAME";
    public const string PASSWORD = "PASSWORD";
    public const string REMEMBER_CREDENTIALS = "REMEMBER_CREDENTIALS";
    public const string PLAYER_ID = "playerID";
    public const string HALL_ID = "HallID";
    public const string HALL_Name = "HallName";
}