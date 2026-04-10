const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ScheduleSchema = new Schema({
  createrId: { type: 'string' },
  isAdminSchedule: { type: 'boolean', default: true },
  scheduleName: { type: 'string', default: '' },
  scheduleType: { type: 'string', default: '' }, // [ Auto or Manual ]
  scheduleNumber: { // [ Auto Generate By System ]
    type: 'string'
  },
  luckyNumberPrize: {
    type: 'number'
  },
  status: { // [ active]
    type: 'string',
    default: 'active'
  },
  subGames: {
    type: 'array',
    default: []
  },
  manualStartTime: { type: 'string', default: "" },
  manualEndTime: { type: 'string', default: "" },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'schedules', versionKey: false });
mongoose.model('schedules', ScheduleSchema);