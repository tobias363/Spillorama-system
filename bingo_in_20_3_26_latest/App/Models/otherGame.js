const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const otherGameSchema = new Schema({
    treasureChestprizeList: {
        type: 'array',
        default: []
    },
    mysteryPrizeList: {
        type: 'array',
        default: []
    },
    wheelOfFortuneprizeList: {
        type: 'array',
        default: []
    },
    colordraftPrizeList: {
        type: 'array',
        default: []
    },
    slug: {
        type: 'string',
        default: ''
    },
    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'otherGame', versionKey: false });
mongoose.model('otherGame', otherGameSchema);