const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const SavedGameSchema = new Schema({
    gameTypeId: { type: 'string' }, // [ Which Types of Game Ex. [1, 2, 3, 4]]
    createrId: { type: 'string' },
    isAdminSave: { type: 'boolean', default: true },
    gameName: { type: 'string', default: '' },
    gameType: { type: 'string', default: '' },
    gameNumber: { // [ Auto Generate By System ]
        type: 'string'
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
    totalNoTickets: {
        type: 'string'
    },
    totalNoPurTi: {
        type: 'number'
    },
    day: {
        type: 'string'
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
    patternWinnerHistory: {
        type: 'array',
        default: []
    },
    purchasedTickets: {
        type: 'array',
        default: []
    },
    socketId: {
        type: 'string',
        default: ''
    },
    timerStart: {
        type: 'boolean',
        default: false
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
    trafficLightExtraOptions: {
        type: 'array',
        default: []
    },
    isMasterGame: {
        type: 'boolean',
        default: false
    },
    isSubGame: {
        type: 'boolean',
        default: false
    },
    mainGameName: {
        type: 'string'
    },
    day: {
        type: 'string',
        default: 'sunday'
    },
    days: { //Added By Gilbert for marting bingo
        type: 'object',
        default: {}
    },
    stopGame: {     //Added By Gilbert for marting bingo
        type: 'boolean',
        default: false
    },
    isParent: {  //Added By Gilbert for marting bingo
        type: 'boolean',
        default: false
    },
    childGameList: { //Added By Gilbert for marting bingo
        type: 'array',
        default: []
    },
    otherData: Schema.Types.Mixed, // Added for Bot fields @chris
    isBotGame: {
        type: 'boolean',
        default: false
    },
    totalNumberOfGames: {
        type: 'number'
    },
    startDate: { type: Date, default: Date.now() },
    endDate: { type: Date, default: Date.now() },
    graceDate: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'savedGame', versionKey: false });
mongoose.model('savedGame', SavedGameSchema);