const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const hallCashAndSafeTransactionSchema = new Schema({
    transactionId: {type: String },
    hallId: { type: Schema.Types.ObjectId, ref: "hall", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "agent", required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: "agentShift" },
    settlementId: { type: Schema.Types.ObjectId, ref: "settlement" },
    type: { type: String },  // "Add Hall Cash", "Add Daily Balance", "Deduct Daily Balance", "Add Hall Safe Balance" ( "Deduct Hall Cash As Added in DropSafe" ),  "Deduct Hall Safe Balance" ( "Add Hall Cash As Deducted From DropSafe" ) and "ControlDailyBalance"
    category: { type: String, required: true }, //debit/credit
    amount: { type: Number, default: 0},
    previousBalance: { type: Number, default: 0},
    afterBalance: { type: Number, default: 0},
    groupHall: { type: Object },
    hall: { type: Object },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'hallCashSafeTransaction', versionKey: false });
mongoose.model('hallCashSafeTransaction', hallCashAndSafeTransactionSchema);