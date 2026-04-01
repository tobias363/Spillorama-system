const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const newsSchema = new Schema({
    playerId: {
        type: 'string'
    },
    gameId: {
        type: 'string'
    },
    notification: {
        type: 'object',
        default: {}
    },
    flag: {
        type: 'boolean',
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { collection: 'notification', versionKey: false });
mongoose.model('notification', newsSchema);