const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const errorSchema = new Schema({
    playerId: {
        type: 'string',
    },
    gameId: {
        type: 'string',
    },
    action: {
        type: 'string',
    },
    amtCategory: {
        type: 'string',
    },
    amount: {
        type: 'number',
    },
    remark: {
        type: 'string',
    },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'Error' });
mongoose.model('Error', errorSchema);