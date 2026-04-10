const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const HallReportSchema = new Schema({
    createrId: { type: 'string' },
    hallId: { type: 'string' },
    stationery: { type: 'number' },
    coffeeServed: { type: 'number' },
    coffeeBill: { type: 'number' },
    transferToBank: { type: 'number' },
    cardPayment: { type: 'number' },
    cashDepositInBingoBank: { type: 'number' },
    comment: { type: 'string' },
    date: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'hallReport', versionKey: false });
mongoose.model('hallReport', HallReportSchema);