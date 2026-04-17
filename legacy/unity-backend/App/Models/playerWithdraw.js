const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const WithdrawSchema = new Schema({
    playerId: {
        type: 'string',
        required: true
    },
    name: {
        type: 'string',
    },
    playerKr: {
        type: 'number',
        required: true
    },
    withdrawAmount: {
        type: 'number',
        required: true
    },
    status: {
        type: 'string',
        default: ' '
    },
    withdrawType: {   // For new flow it wil be Withdraw in Hall and Withdraw in Bank
        type: 'string',
        default: ' '
    },
    socketId: {
        type: 'string',
        default: ''
    },
    transactionId: {
        type: 'string',
        default: ''
    },
    hallId: {
        type: 'string'
    },
    hallName: {
        type: 'string'
    },
    bankAccountNumber: {
        type: 'string'
    },
    view: {
        type: 'boolean',
        default: false
    },
    customerNumber: { type: 'number' },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'Withdraw', versionKey: false });
mongoose.model('Withdraw', WithdrawSchema);