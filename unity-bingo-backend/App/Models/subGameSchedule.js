const { date } = require('joi');
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const subGameScheduleSchema = new Schema({
    name: { 
        type: 'string' 
    },
    type: { 
        type: 'string', 
        default: 'single' 
    },
    scheduleType: {
        type: 'string',
        default: 'single'
    },
    subGames: {
        type: 'array',
        default: []
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'subGameSchedule', versionKey: false });
mongoose.model('subGameSchedule', subGameScheduleSchema);