const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const SubGameSchema = new Schema({
    gameTypeId: { type: 'string' }, // [ Which Types of Game Ex. [1, 2, 3, 4]]
    createrId: { type: 'string' },
    subGame: { type: 'string', default: 'subGame' },
    gameName: { type: 'string', default: '' },
    gameType: { type: 'string', default: '' },
    gameNumber: { // [ Auto Generate By System ]
        type: 'string'
    },
    parentGameId: {
        type: Schema.Types.ObjectId,
        require: true
    },
    patternNamePrice: {
        type: 'array',
        default: []
    },
    totalEarning: {
        type: 'number',
        default: 0
    },
    totalWinning: { type: 'number', default: 0 },
    finalGameProfitAmount: { type: 'number', default: 0 },
    ticketPrice: {
        type: 'number'
    },
    luckyNumberPrize: {
        type: 'number'
    },
    day: {
        type: 'string'
    },
    notificationStartTime: {
        type: 'string'
    },
    totalNoTickets: {
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
    currentPatternList: {
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
    groupHalls: {
        type: 'array',
        default: []
    },
    halls: {
        type: 'array'
    },
    betData: {
        type: 'object'
    },
    otherData: Schema.Types.Mixed,
    startDate: { type: Date, default: Date.now() },
    graceDate: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'subGame', versionKey: false });
mongoose.model('subGame', SubGameSchema);