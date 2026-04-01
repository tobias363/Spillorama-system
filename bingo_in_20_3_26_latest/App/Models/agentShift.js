const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const agentShiftSchema = new Schema({
    hallId: { type: Schema.Types.ObjectId, ref: "hall", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "agent", required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    dailyBalance: { type: Number, default: 0},
    totalDailyBalanceIn: { type: Number, default: 0},
    totalCashIn: { type: Number, default: 0},
    totalCashOut: { type: Number, default: 0},
    toalCardIn: { type: Number, default: 0},
    totalCardOut: { type: Number, default: 0},
    sellingByCustomerNumber: { type: Number, default: 0},
    hallCashBalance: { type: Number, default: 0 },
    hallDropsafeBalance: { type: Number, default: 0 },
    dailyDifference: { type: Number, default: 0 },
    controlDailyBalance: Schema.Types.Mixed , // dailyBalance, hallCashBalance, dailyBalanceDiff, hallCashBalanceDiff
    settlement: Schema.Types.Mixed,  // store data provided at settlement
    previousSettlement: Schema.Types.Mixed,  // store data provided at settlement
    isActive: { type: Boolean, default: false },
    isLogOut: {type: Boolean},
    isDailyBalanceTransferred: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'agentShift', versionKey: false });
mongoose.model('agentShift', agentShiftSchema);