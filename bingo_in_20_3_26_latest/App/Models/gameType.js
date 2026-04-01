const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const gameType = new Schema({
    name: {
        type: 'string',
        default: ''
    },
    type: { // Game Type Slug  Like game_1 , game_2
        type: 'string',
        default: ''
    },
    pattern: {
        type: 'boolean',
        default: false
    },
    photo: {
        type: 'string',
        default: ''
    },
    row: {
        type: 'string'
    },
    columns: {
        type: 'string'
    },
    totalNoTickets: {
        type: 'string'
    },
    userMaxTickets: {
        type: 'string'
    },
    pickLuckyNumber: {
        type: 'array',
        default: []
    },
    rangeMin: {
        type: 'string'
    },
    rangeMax: {
        type: 'string'
    },
    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'gameType' });
mongoose.model('gameType', gameType);