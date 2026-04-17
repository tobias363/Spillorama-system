const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const settlementSchema = new Schema({
    hallId: { type: Schema.Types.ObjectId, ref: "hall", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "agent", required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: "agentShift", required: true },
    date: { type: Date, required: true },
    
    // inAmountBingoNet: { type: Number,  default: 0},
    // outAmountBingoNet: { type: Number,  default: 0},
    // totalAmountBingoNet: { type: Number,  default: 0},

    game1Profit: { type: Number,  default: 0},
    game2Profit: { type: Number,  default: 0},
    game3Profit: { type: Number,  default: 0},
    game4Profit: { type: Number,  default: 0},
    game5Profit: { type: Number,  default: 0},
    allGameProfit: { type: Number, default: 0 },

    inAmountMetronia: { type: Number,  default: 0},
    outAmountMetronia: { type: Number,  default: 0},
    totalAmountMetronia: { type: Number,  default: 0},

    inAmountOkBingo: { type: Number,  default: 0},
    outAmountOkBingo: { type: Number,  default: 0},
    totalAmountOkBingo: { type: Number,  default: 0},

    inAmountFranco: { type: Number,  default: 0},
    outAmountFranco: { type: Number,  default: 0},
    totalAmountFranco: { type: Number,  default: 0},

    inAmountOtium: { type: Number,  default: 0},
    outAmountOtium: { type: Number,  default: 0},
    totalAmountOtium: { type: Number,  default: 0},

    inAmountNorskTippingDag: { type: Number,  default: 0},
    outAmountNorskTippingDag: { type: Number,  default: 0},

    inAmountNorskTotalt: { type: Number,  default: 0},
    outAmountNorskTotalt: { type: Number,  default: 0},
    totalAmountNorskTotalt: { type: Number,  default: 0},

    inAmountNorskRikstotoDag: { type: Number,  default: 0},
    outAmountNorskRikstotoDag: { type: Number,  default: 0},
    totalAmountNorskRikstotoDag: { type: Number,  default: 0},

    inAmountNorskRikstotoTotalt: { type: Number,  default: 0},
    outAmountNorskRikstotoTotalt: { type: Number,  default: 0},
    totalAmountNorskRikstotoTotalt: { type: Number,  default: 0},

    inAmountRekvisita: { type: Number,  default: 0},
    totalAmountRekvisita: { type: Number,  default: 0},

    inAmountSellProduct: { type: Number,  default: 0},
    totalAmountSellProduct: { type: Number,  default: 0},

    outAmountBilag: { type: Number,  default: 0},
    totalAmountBilag: { type: Number,  default: 0},

    outAmountBank: { type: Number,  default: 0},
    totalAmountBank: { type: Number,  default: 0},

    inAmountTransferredByBank: { type: Number,  default: 0},
    totalAmountTransferredByBank: { type: Number,  default: 0},

    inAmountAnnet: { type: Number,  default: 0},
    outAmountAnnet: { type: Number,  default: 0},
    totalAmountAnnet: { type: Number,  default: 0},

    dailyBalanceAtStartShift: { type: Number,  default: 0},
    dailyBalanceAtEndShift: { type: Number,  default: 0},
    dailyBalanceDifference: { type: Number,  default: 0},

    settlementToDropSafe: { type: Number,  default: 0},
    withdrawFromtotalBalance: { type: Number,  default: 0},
    totalDropSafe: { type: Number,  default: 0},

    shiftDifferenceIn: { type: Number,  default: 0},
    shiftDifferenceOut: { type: Number,  default: 0},
    shiftDifferenceTotal: { type: Number,  default: 0},

    settlmentNote: { type: String },

    billImages: { type: Array, default: [] },

    groupHall: { type: Object },
    hall: { type: Object },

    otherData: Schema.Types.Mixed,

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'settlement', versionKey: false });
mongoose.model('settlement', settlementSchema);