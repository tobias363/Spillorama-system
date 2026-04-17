const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const dailyScheduleSchema = new Schema({
    createrId: { type: 'string' },
    dailyScheduleId: { type: 'string', default: '' },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: Date.now },
    name: { type: 'string' },
    day: {
        type: 'string',
        default: 'sunday'
    },
    days: { 
        type: 'object',
        default: {}
    },
    groupHalls: {
        type: 'array',
        default: []
    },
    halls: {
        type: 'array'
    },
    allHallsId: {
        type: 'array'
    },
    masterHall: {
        type: 'object',
    },
    stopGame: {   
        type: 'boolean',
        default: false
    },
    status: {           // [ active/running/finish ]
        type: 'string',
        default: 'active'
    },
    isSavedGame: {   
        type: 'boolean',
        default: false
    },
    isAdminSavedGame: {
        type: 'boolean',
        default: false
    },
    innsatsenSales: {
        type: 'number',
        default: 0
    },
    startTime: { type: 'string', default: "" },
    endTime: { type: 'string', default: "" },
    specialGame:{
        type: 'boolean',
        default: false
    },
    otherData : Schema.Types.Mixed , // Added for close day @chris
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'dailySchedule', versionKey: false });
mongoose.model('dailySchedule', dailyScheduleSchema);