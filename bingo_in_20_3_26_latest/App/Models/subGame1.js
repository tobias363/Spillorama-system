const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const SubGameSchema = new Schema({
    gameName: {
        type: 'string'
    },
    patternRow: {
        type: 'array'
    },
    ticketColor: {
        type: 'array'
    },
    allPatternRowId: {
        type: 'array'
    },
    subGameId: {
        type: 'string'
    },
    gameType: {
        type: 'string'
    },
    status: { type: 'string' },
    creationDateTime: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'subGame1', versionKey: false });
mongoose.model('subGame1', SubGameSchema);