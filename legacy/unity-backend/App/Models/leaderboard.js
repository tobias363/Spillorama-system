const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const LeaderboardSchema = new Schema({
    place: {
        type: 'string',
        required: true
    },
    points: {
        type: 'number',
        required: true
    },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'Leaderboard' });
mongoose.model('Leaderboard', LeaderboardSchema);