const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const DepositSchema = new Schema({
    playerId: {
        type: 'string',
        default: ''
    },
    playerName: {
        type: 'string',
        default: ''
    },
    orderNumber: {
        type: 'string',
        default: ''
    },
    amount: {
        type: 'number',
        default: ''
    },
    walletAmount: {  // Current wallet amount of the player when doing deposit
        type: 'number',
        default: 0
    },
    currencyCode: {
        type: 'string',
    },
    transactionID: {
        type: 'string',
        default: ''
    },
    status: {
        type: 'string',
        default: ''
    },
    responseCode: {
        type: 'string',
    },
    errorType: {
        type: 'string',
    },
    errorSection: {
        type: 'string',
    },
    message: {
        type: 'string',
        default: ''
    },
    batchNumber: {
        type: 'string',
        default: ''
    },
    executionTime: {
        type: Date,
        default: Date.now()
    },
    operation: {
        type: 'string',
        default: ''
    },
    responseSource: {
        type: 'string',
    },
    hallId: {
        type: 'string'
    },
    hallName: {
        type: 'string'
    },
    issuerId: {
        type: 'string',
    },
    checkoutID: {
        type: 'string',
    },
    customerId: {
        type: 'string',
    },
    paymentBy: {
        type: 'string',
    },
    actionTakenBy: {
        type: 'object',
    },
    view: {
        type: 'boolean',
        default: false
    },
    otherData: Schema.Types.Mixed,
    customerNumber: { type: 'number' },
    expiryDate: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'DepositMoney' });
mongoose.model('DepositMoney', DepositSchema);