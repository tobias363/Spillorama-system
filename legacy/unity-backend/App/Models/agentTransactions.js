const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const agentTxSchema = new Schema({
    shiftId: { type: Schema.Types.ObjectId, ref: "agentShift", required: true },
    hallId: { type: Schema.Types.ObjectId, ref: "hall", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "agent", required: true },
    agentName: {type: String, required: true},
    playerId: {type: String, required: true },
    playerName: {type: String, required: true },
    category: { type: String, required: true }, // debit/credit
    amount: { type: Number, default: 0},
    typeOfTransaction: {type: String },
    groupHall: { type: Object },
    hall: { type: Object },
    paymentBy: { type: String },  // Card/Cash
    previousBalance: { type: Number },
    afterBalance: { type: Number },
    userType: {type: String},
    otherData: {type: Schema.Types.Mixed},
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'agentTransaction', versionKey: false });
mongoose.model('agentTransaction', agentTxSchema);