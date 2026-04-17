const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const TicketSchema = new Schema({
    gameId: {
        type: 'string'
    },
    ticketId: {
        type: 'string'
    },
    dailyScheduleId : {
        type: 'string',
        default : ''
    },
    subGame1Id: {
        type: 'string',
        default: ''
    },
    tickets: {
        type: 'array',
        defaultsTo: []
    },
    isPurchased: {
        type: "boolean",
        default: false
    },
    isCancelled: {
        type: "boolean",
        default: false
    },

    hallName: {
        type: 'string'
    },
    groupHallName: {
        type: 'string'
    },
    hallId: {
        type: 'string'
    },
    groupHallId: {
        type: 'string'
    },
    supplier: {
        type: 'string'
    },
    developer: {
        type: 'string'
    },
    playerIdOfPurchaser: {
        type: 'string'
    },
    winningCombinations: {
        type: 'object',
        defaultsTo: {}
    },
    ticketColorType: {
        type: "string",
        default: ''
    },
    ticketColorName: {
        type: "string",
        default: ''
    },
    ticketPrice: {
        type: 'number',
        default: 0,
    },
    ticketParentId: {
        type: 'string',
        default: '',
    },
    isPlayerWon:{
        type: 'boolean',
        default: false
    },
    isTicketSubmitted:{
        type: 'boolean',
        default: false
    },
    playerNameOfPurchaser: {
        type: 'string',
        default: '',
    },
    isWonByFullhouse: {
        type: 'boolean',
        default: false
    },
    winningStats: {
        type: 'object',
        default:{finalWonAmount:0}
    },
    bonusWinningStats: {
        type: 'object'
    },
    userType: {
        type: 'string',
        default: 'Online'
    },
    ticketPurchasedFrom: {
        type: 'string',
        default: ''
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
    colorDraftWinners: {type: 'array', default: [] },
    gameType:{
        type: "string",
        default: ''
    },
    gameName:{
        type: "string",
        default: ''
    },
    luckyNumber: {
        type: 'string',
        default: 0
    },
    luckyNumberWinningStats: {
        type: 'object'
    },
    uniquePlayerId: {
        type: "string",
        default: ''
    },
    playerTicketType: {
        type: "string",
        default: ''
    },
    totalWinningOfTicket: {
        type: 'number',
        default: 0,
    },
    isAgentTicket: {
        type: 'boolean',
        default: false
    },
    agentId: {
        type: "string",
        default: ''
    },
    betAmount: {
        type: 'number',
        default: 0,
    },
    isOriginalTicket: {
        type: 'boolean',
        default: false
    },
    isPhysicalTicket: {
        type: 'boolean',
        default: false
    },
    parentGameId: {
        type: Schema.Types.ObjectId
    },
    totalReplaceAmount: {
        type: 'number',
        default: 0
    },
    userTicketType: {
        type: 'string',
        default: 'Web'
    },
    otherData: {
        type: Schema.Types.Mixed,
        default : {}
    },
    gameStartDate: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'Ticket' });
mongoose.model('Ticket', TicketSchema);