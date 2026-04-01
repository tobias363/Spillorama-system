const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const SlotMachineSchema = new Schema({
    machineName: { type: String, enum: ['Metronia', 'OK Bingo'], default: "" }, // Metronia, OkIntegration
    playerId: { type: String, default: "" },
    roomId: { type: String, default: "" },  // for Ok Bingo RoomId=bingoId
    hallId: { type: String, default: "" },
    username: { type: String, default: "" },
    customerNumber: { type: Number, default: "" },
    ticketNumber: { type: String, required: true },
    ticketId: { type: String, required: true },   // required for metronia
    uniqueTransaction: { type: String },
    balance: { type: Number, required: true, default: 0},
    totalBalanceAdded: { type: Number, default: 0 },
    isClosed: { type: Boolean, default: false },
    profit: { type: Number, default: 0 }, // Admin profit
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    otherData: Schema.Types.Mixed,
}, { versionKey: false });
mongoose.model('SlotMachine', SlotMachineSchema);