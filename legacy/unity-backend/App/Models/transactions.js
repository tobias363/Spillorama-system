const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ChipsSchema = new Schema({
    transactionId: {
        type: 'string',
        default: ''
    },
    playerId: {
        type: 'string',
        required: true
    },
    playerName: {
        type: 'string',
    },
    category: { // debit/credit
        type: 'string',
        required: true
    },
    amtCategory: {
        type: 'string',
        required: true
    },
    defineSlug: {
        type: 'string',
    },
    gameId: { type: 'string' },
    gameNumber: { type: 'string' },
    gameName: { type: 'string' },
    gameMode: { type: 'string' },
    differenceAmount: { type: 'number' },
    gameType: { type: 'string' },
    gameStartDate: { type: Date, },
    groupHall: { type: "object" },
    groupHallId: { type: 'string' },
    hall: { type: "object" },
    hallId: { type: 'string' },
    variantGame: { type: 'string', default: "" },
    ticketColorType: { type: 'string', default: "" },
    ticketNumber: { type: 'string' },
    ticketId: { type: 'string' },
    ticketPrice: { type: 'number' },
    winningPrice: { type: 'number', default: 0 },
    patternId: { type: 'string' },
    patternName: { type: 'string' },
    status: { // success/fail
        type: 'string',
    },
    winningJackpotNumber: { type: 'number' },
    previousBalance: { type: 'number' },
    afterBalance: { type: 'number' },
    withdrawAmount: { type: 'number' },
    withdrawType: { type: 'string' },
    depositType: { type: 'object' },
    remark: { type: 'string' }, //remark on transaction
    voucherId: {
        type: 'string',
        default: ''
    },
    typeOfTransaction: {
        type: 'string',
    },
    typeOfTransactionTotalAmount: {
        type: 'number',
    },
    voucherCode: {
        type: 'string',
        default: ''
    },
    voucherAmount: {
        type: 'number',
        default: ''
    },
    isVoucherUse: {
        type: 'boolean',
        default: false
    },
    isVoucherApplied: {
        type: 'boolean',
        default: false
    },
    loyaltyId: {
        type: 'string',
        default: ''
    },
    loyaltyAmount: {
        type: 'number',
        default: ''
    },
    leaderboardId: {
        type: 'string',
        default: ''
    },
    leaderboardAmount: {
        type: 'number',
        default: ''
    },
    userType: {
        type: 'string',
        default: 'Online'
    },
    game1Slug: {
        type: 'string',
        default: ''
    },
    percentWin: {
        type: 'boolean'
    },
    isBotGame: {
        type: 'boolean',
        default: false
    },
    agentId: { type: 'string' },
    agentName: { type: 'string' },
    shiftId: { type: 'string' },
    paymentBy: { type: 'string' },  // Card/Cash
    otherData: {type : Schema.Types.Mixed, default : {}},
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'transactions' });

mongoose.model('transactions', ChipsSchema);



// 	user_id: { type: 'string' },
// 	username: { type: 'string' },
// 	gameId: { type: 'string' },  
// 	chips: { type: 'number' },
// 	bet_amount: { type: 'number' },
// 	receiverId:{ type: 'string' },
// 	providerId:{ type: 'string' },
// 	previousBalance: { type: 'number' },
// 	afterBalance: { type: 'number' },
// 	beforeBalance: { type: 'number' },
// 	category: { type: 'string' },
// 	gameNumber: { type: 'string' },
// 	type: { type: 'string' },   
// 	remark: { type: 'string' }, 
// 	isTournament:{ type: 'string' },
// 	receiverName:{ type: 'string' },	
// 	uniqId:{ type: 'string' },
// 	sessionId:{ type: 'string' },
// 	// updatedAt  		: { type : Date, default : Date.now },
// },{ timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }},