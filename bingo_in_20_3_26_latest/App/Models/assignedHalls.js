const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const assignedHallSchema = new Schema({
    groupHallId: { type: 'string', default: '' },
    groupHallName: { type: 'string', default: '' },
    hallId: { type: 'string', default: '' },
    hallName: { type: 'string', default: '' },
    dailyScheduleId: { type: 'string', default: '' },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    status: {type: 'string', default: 'active'}
}, { collection: 'assignedHalls', versionKey: false });
mongoose.model('assignedHalls', assignedHallSchema);