const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const dailyTransactionsSchema = new Schema({
    playerId: {
        type: Schema.Types.ObjectId,
    },
    hallId: {
        type: Schema.Types.ObjectId,
    },
    date: { type: String, default: "" },
    purchase: { type: Number, default: 0 },
    cancel: { type: Number, default: 0 },
    finalPurchase: { type: Number, default: 0 },
    loss: { type: Number, default: 0 },
    winning: { type: Number, default: 0 },
    deposit: { type: Number, default: 0 },
    withdraw: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'dailyTransactions', versionKey: false });
mongoose.model('dailyTransactions', dailyTransactionsSchema);