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
  days: { //Added By Gilbert for marting bingo
    type: 'object',
    default: {}
  },
  totalNoTickets: {
    type: 'number'
  },
  totalNoPurchasedTickets: {
    type: 'number'
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
  isMasterGame: {
    type: 'boolean',
    default: false
  },
  isSubGame: {
    type: 'boolean',
    default: false
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
  isAllSubGamesCompleted: {
    type: 'boolean',
    default: false
  },
  stopGame: {     //Added By Gilbert for marting bingo
    type: 'boolean',
    default: false
  },
  isParent: {  //Added By Gilbert for marting bingo
    type: 'boolean',
    default: true
  },
  childGameList: { //Added By Gilbert for marting bingo
    type: 'array',
    default: []
  },
  isBotGame : {
    type : 'boolean',
    default: false
  },
  totalNumberOfGames : {
    type : 'number'
  },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, default: Date.now },
  otherData : Schema.Types.Mixed , // Added for Bot fields @chris
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'parentGame', versionKey: false });
mongoose.model('parentGame', GameSchema);