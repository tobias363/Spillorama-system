const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const SubGame5Schema = new Schema({
    createrId: { type: 'string' },
    gameType: { type: 'string', default: '' },
    gameNumber: { type: 'string' },
    parentGameId: { type: Schema.Types.ObjectId, require: true },
    earnedFromTickets: { type: 'number', default: 0 },
    totalWinning: { type: 'number', default: 0 },
    finalGameProfitAmount: { type: 'number', default: 0 },
    player: { type: 'object', default: {} },
    // ticketIdArray: { type: 'array', default: [] },
    withdrawNumberArray: { type: 'array', default: [] },
    winners: { type: 'array', default: [] },
    //rouletteHistory: { type: 'array', default: [] },
    history: {type: 'array', default: [] },
    groupHalls: { type: 'array', default: [] },
    halls: { type: 'array' },
    allPatternArray: { type: 'array', default: [] },
    status: { // [ Waiting/Running/Finished ]
        type: 'string',
        default: 'Waiting'
    },
    otherData: Schema.Types.Mixed,
    startDate: { type: Date, default: Date.now() },
    seconds: { type: 'number' },
    withdrawableBalls: { type: 'number' },
    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'subGame5', versionKey: false });
mongoose.model('subGame5', SubGame5Schema);