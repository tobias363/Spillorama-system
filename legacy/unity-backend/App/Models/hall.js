const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const HallSchema = new Schema({
    name: {
        type: 'string',
        required: true
    },
    number: {
        type: 'string',
        required: true
    },
    agents: {
        type: 'array',
        default: []
    },
    hallId: {
        type: 'string',
        default:''
    },
    ip: {
        type: 'string',
        default:''
    },
    address: {
        type: 'string',
        required: true
    },
    city: {
        type: 'string',
        required: true
    },
    groupHall: {
        type: 'object',
        default:{}
    },
    status: {
        type: 'string',
        required: true
    },
    isDeleted: {
        type: 'boolean',
        default: false,
    },
    products:{
        type: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'product'
        }],
        default: []
    }, 
    activeAgents: {  type: 'array', default: [] },
    hallCashBalance: { type: "number", default: 0 },  // store balance at the start od shift
    hallDropsafeBalance: { type: "number", default: 0 },
    //dailyDifference: { type: "number", default: 0 },
    isSettled: { type: "boolean", default: true },
    otherData : Schema.Types.Mixed, // currentShiftId
    controlDailyBalance:  {
        dailyBalanceDiff: {  type: "number", default: 0},
        hallCashBalanceDiff: {  type: "number", default: 0},
    }, // dailyBalanceDiff, hallCashBalanceDiff, date // Need to reset once settlement is done 
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'hall',minimize: false });
mongoose.model('hall', HallSchema);