const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const GameSchema = new Schema({
    gameTypeId: { type: 'string' }, // [ Which Types of Game Ex. [1, 2, 3, 4]]
    createrId: { type: 'string' },
    gameName: { type: 'string', default: '' },
    gameType: { type: 'string', default: '' },
    gameNumber: { // [ Auto Generate By System ]
        type: 'string'
    },
    sequence: {
        type: 'number'
    },
    ticketPrice: {
        type: 'number'
    },
    luckyNumberPrize: {
        type: 'number'
    },
    notificationStartTime: {
        type: 'string'
    },
    totalEarning: {
        type: 'number',
        default: 0
    },
    day: {
        type: 'string',
        default: 'sunday'
    },
    totalNoTickets: {
        type: 'number'
    },
    totalNoPurchasedTickets: {
        type: 'number',
        default : 0
    },
    columns: {
        type: 'string'
    },
    minTicketCount: {
        type: 'number'
    },
    gameMode: { // [ Auto or Manual ]
        type: 'string'
    },
    jackPotNumber: {
        type: 'array'
    },
    seconds: {
        type: 'number'
    },
    seconds2: {
        type: 'number'
    },
    status: { // [ active/running/finish ]
        type: 'string',
        default: 'active'
    },
    history: {
        type: 'array',
        default: []
    },
    withdrawNumberList: {
        type: 'array',
        default: []
    },
    betMultiplier: {
        type: 'number'
    },
    patternNamePrice: {
        type: 'array',
        default: []
    },
    currentPatternList: {
        type: 'array',
        default: []
    },
    betAmount: {
        type: 'array',
        default: []
    },
    players: {
        type: 'array',
        default: []
    },
    ticketIdArray: {
        type: 'array',
        default: []
    },
    winners: {
        type: 'array',
        default: []
    },
    betData: {
        type: 'object'
    },
    patternGroupNumberPrize: {
        type: 'object'
    },
    allPatternArray: {
        type: 'array',
        default: []
    },
    trafficLightExtraOptions: {
        type: 'array',
        default: []
    },
    patternWinnerHistory: {
        type: 'array',
        default: []
    },
    purchasedTickets: {
        type: 'array',
        default: []
    },
    subGames: {
        type: 'array',
        default: []
    },
    groupHalls: {
        type: 'array',
        default: []
    },
    halls: {
        type: 'array'
    },
    allHallsId: {
        type: 'array'
    },
    masterHall: {
        type: 'object',
    },
    socketId: {
        type: 'string',
        default: ''
    },
    timerStart: {
        type: 'boolean',
        default: false
    },
    isNotificationSent: {
        type: 'boolean',
        default: false
    },
    isGraceTimeCheck: {
        type: 'boolean',
        default: false
    },
    isAdminGameStart: {
        type: 'boolean',
        default: false
    },
    isManualNotiSent: {
        type: 'boolean',
        default: false
    },
    parentGameId: {
        type: Schema.Types.ObjectId,
    },
    isMasterGame: {
        type: 'boolean',
        default: false
    },
    isSubGame: {
        type: 'boolean',
        default: false
    },
    withdrawNumberArray: {
        type: 'array',
        default: []
    },
    jackpotWinners: {
        type: 'array',
        default: []
    },
    multipleWinners: {
        type: 'array',
        default: []
    },
    wofWinners: {
        type: 'array',
        default: []
    },
    tChestWinners: {
        type: 'array',
        default: []
    },
    mystryWinners: {
        type: 'array',
        default: []
    },
    ticketSold: {
        type: 'number',
        default: 0
    },
    earnedFromTickets: {
        type: 'number',
        default: 0
    },
    totalWinning: {
        type: 'number',
        default: 0
    },
    finalGameProfitAmount: {
        type: 'number',
        default: 0
    },
    luckyNumberBonusWinners: {
        type: 'array',
        default: []
    },
    isAllSubGamesCompleted: {
        type: 'boolean',
        default: false
    },
    stopGame: {     //Added By Gilbert for marting bingo
        type: 'boolean',
        default: false
    },  
    ticketsWinningPrices: {
        type: 'array',
        default: []
    },
    adminWinners: {
        type: 'array',
        default: []
    },
    mainGameName: {
        type: 'string'
    },
    isChild:{
        type:'boolean',
        default:false
    },
    rocketLaunch:{
        type : 'boolean',
        deafult: false
    },
    disableTicketPurchase: {
        type: 'boolean',
        deafult: false
    },
    winningType : {
        type : "string",
        default : ""
    },
    startDate: { type: Date }, //, default: Date.now 
    endDate: { type: Date, default: Date.now },
    specialGame:  {
        type: 'boolean',
        deafult: false
    },
    otherData     : Schema.Types.Mixed , // Added for game 1 @chris
    ticketIdForBalls: {type: 'object'},  // Added for game 1 @chris
    jackpotDraw: { type: 'number', default: 51 },
    jackpotPrize: { type: 'object' },
    colorDraftWinners: {type: 'array', default: [] },
    isBotGame: {
        type: 'boolean',
        default: false
    },
    totalNumberOfGames: {
        type: 'number'
    },
    countDownTime: {
        type: 'number',
        default: 3
    },
    countDownDateTime: {
        type: Date, 
        default: Date.now
    },
    days: { //Added By Gilbert for marting bingo
        type: 'object',
        default: {}
    },
    removeForSpecailGame:{
        type: 'object',
        default: {}
    },
    isChangeforSpecailGame:{
        type: 'boolean',
        default: false
    },
    lastCreaterId: { 
        type: 'string' 
    },
    graceDate: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }













    // 	roomId: {
    // 	type: 'string',
    // 	required: true
    // },
    // isTournamentTable    : { type: 'boolean', default : false }, // if is Tournament Room So Set True.
    // tournamentType    : { type: 'string', default : '-' }, // sng / regular
    // tournament    : { type: 'string', default : '' }, // Tournament Id
    // gameType      : { type: 'string', default: 'texas' }, // texas / omaha
    // tableType     : { type: 'string', default: 'normal' }, // normal / fast table
    // isCashGame    : { type: 'boolean', default : true }, // true / false
    // currencyType  : { type: 'string', default: 'cash' }, // btc/ doller/ cash
    // otherData     : Schema.Types.Mixed , // Store Some other Data
    // gameTotalChips:{type: 'number',
    // default: 0},
    // gameNumber: {
    // 	type: 'string'
    // },
    // smallBlind: {
    // 	type: 'number',
    // 	default: 0
    // },
    // bigBlind: {
    // 	type: 'number',
    // 	default: 0
    // },
    // status: {
    // 	type: 'string',
    // 	default: ''
    // },
    // pot: {
    // 	type: 'number',
    // 	default: 0
    // },
    // roundName: {
    // 	type: 'string',
    // 	default: ''
    // },
    // betName: {
    // 	type: 'string',
    // 	default: ''
    // },
    // bets: {
    // 	type: 'array',
    // 	default: []
    // },
    // roundBets: {
    // 	type: 'array',
    // 	default: []
    // },
    // deck: {
    // 	type: 'array',
    // 	default: []
    // },
    // board: {
    // 	type: 'array',
    // 	default: []
    // },
    // history: {
    // 	type: 'array',
    // 	default: []
    // },
    // players: {
    // 	type: 'array',
    // 	default: []
    // },
    // winners: {
    // 	type: 'array',
    // 	default: []
    // },
    // sidePotAmount:{
    // 	type: 'array',
    // 	default: []
    // },
    // playerSidePot:{
    // 	type: 'array',
    // 	default: []
    // },
    // gamePot:{
    // 	type: 'array',
    // 	default: []
    // },
    // gameRevertPoint :{
    // 	type: 'array',
    // 	default: []
    // },
    // gameMainPot: {
    // 	type: 'number',
    // 	default: 0
    // },
    // rakePercenage: {
    // 	type: 'number',
    // 	default: 0
    // },
    // rakeDistribution:{
    // 	type: 'array',
    // 	default: []
    // },
    // rakeCap:{
    // 	type: 'array',
    // 	default: []
    // },
    // winnerDetails:{
    // 	type: 'array',
    // 	default: []
    // },
    // adminExtraRakePercentage: {
    // 	type: 'number',
    // 	default: 0
    // },
    // groupId: {
    // 	type: 'string',
    // },
}, { collection: 'game', versionKey: false });
mongoose.model('game', GameSchema);